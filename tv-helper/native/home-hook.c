// SPDX-License-Identifier: GPL-3.0-only
// LG input ABIs and ezinject entry points adapted from sundermann/inputhookpp.
// See NOTICE.md. This version only forwards Home presses to the root helper.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#ifndef HOME_HOOK_BUILD_ID
#error HOME_HOOK_BUILD_ID must identify the reviewed source and dependencies
#endif
#ifndef HOME_HOOK_DIRECTORY
#define HOME_HOOK_DIRECTORY "/tmp/lg-xmb-home-button"
#endif
#ifndef HOME_HOOK_UINPUT_PATH
#define HOME_HOOK_UINPUT_PATH "/dev/uinput"
#endif

static int control_fd = -1;
static pid_t process_id;
static unsigned long long process_birth;
static pthread_mutex_t home_mutex = PTHREAD_MUTEX_INITIALIZER;
static unsigned char swallowed[3];
static int active;

static unsigned long long monotonic_ms(void) {
    struct timespec now;
    // Include suspend time: a lease from before standby must expire.
    if (clock_gettime(CLOCK_BOOTTIME, &now)) return 0;
    return (unsigned long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int secure_runtime(void) {
    struct stat info;
    return lstat(HOME_HOOK_DIRECTORY, &info) == 0 && S_ISDIR(info.st_mode) &&
        info.st_uid == 0 && (info.st_mode & 0777) == 0700;
}

static int send_control(const char *message) {
    struct sockaddr_un address = {.sun_family = AF_UNIX};
    struct stat info;
    if (control_fd < 0 || !secure_runtime()) return 0;
    strcpy(address.sun_path, HOME_HOOK_DIRECTORY "/control.sock");
    if (lstat(address.sun_path, &info) || !S_ISSOCK(info.st_mode) ||
        info.st_uid != 0 || (info.st_mode & 0777) != 0600) return 0;
    size_t size = strlen(message);
    return sendto(control_fd, message, size, MSG_DONTWAIT | MSG_NOSIGNAL,
        (struct sockaddr *)&address, sizeof(address)) == (ssize_t)size;
}

static int lease_current(unsigned long long now) {
    char content[128], expected[96], *end;
    struct stat info;
    if (!now || !secure_runtime()) return 0;
    int fd = open(HOME_HOOK_DIRECTORY "/lease", O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) return 0;
    int secure = fstat(fd, &info) == 0 && S_ISREG(info.st_mode) &&
        info.st_uid == 0 && info.st_nlink == 1 && !(info.st_mode & 0022);
    ssize_t size = secure ? read(fd, content, sizeof(content) - 1) : -1;
    close(fd);
    if (size <= 0 || size == sizeof(content) - 1) return 0;
    content[size] = 0;
    snprintf(expected, sizeof(expected), "LGXMB_HOME 1 %s ", HOME_HOOK_BUILD_ID);
    size_t prefix = strlen(expected);
    if (strncmp(content, expected, prefix) || content[prefix] < '0' || content[prefix] > '9') return 0;
    errno = 0;
    unsigned long long stamp = strtoull(content + prefix, &end, 10);
    return !errno && !strcmp(end, "\n") && stamp <= now && now - stamp < 2000;
}

// A failed first press passes through completely, including its later release.
// Once a press was swallowed, consume its repeats/release even if the lease dies.
static int consume_home(int code, int state) {
    int index = code == 125 ? 0 : code == 773 ? 1 : code == 774 ? 2 : -1;
    if (index < 0 || state < 0 || state > 2 ||
        !__atomic_load_n(&active, __ATOMIC_ACQUIRE) || getpid() != process_id) return 0;
    int saved_errno = errno;
    pthread_mutex_lock(&home_mutex);
    int consume = swallowed[index];
    if (state == 0) swallowed[index] = 0;
    else if (state == 1 && !consume) {
        unsigned long long now = monotonic_ms();
        if (lease_current(now)) {
            char message[192];
            snprintf(message, sizeof(message), "LGXMB_HOME 1 HOME %s %ld %llu %d 1 %llu\n",
                HOME_HOOK_BUILD_ID, (long)process_id, process_birth, code, now);
            consume = swallowed[index] = send_control(message);
        }
    }
    pthread_mutex_unlock(&home_mutex);
    errno = saved_errno;
    return consume;
}

struct keybind_info { int unknown1[4]; int code; int unknown2[9]; };
struct uinput_info { int fd; struct keybind_info *keybinds; };
struct input_event32 { uint64_t time; uint16_t type, code; int32_t value; };
static int (*original_lginput)(struct uinput_info *, int, int);
static int (*original_micom)(int, uint16_t, uint16_t, int32_t);
static ssize_t (*original_write)(int, const void *, size_t);

static int home_lginput(struct uinput_info *info, int key, int state) {
    if (info && info->keybinds && key >= 0 && key < 1024 &&
        consume_home(info->keybinds[key].code, state)) return 0;
    return original_lginput(info, key, state);
}

static int home_micom(int fd, uint16_t type, uint16_t code, int32_t value) {
    if (type == 1 && consume_home(code, value)) return 0;
    return original_micom(fd, type, code, value);
}

static ssize_t home_write(int fd, const void *buffer, size_t size) {
    // Native input writes are small. Unknown/large writes keep the original
    // path, and pointer/wheel batches never need a syscall or lease lookup.
    if (!size || size > 4096 || size % sizeof(struct input_event32)) return original_write(fd, buffer, size);
    int has_home = 0;
    for (size_t offset = 0; offset < size; offset += sizeof(struct input_event32)) {
        struct input_event32 event;
        memcpy(&event, (const char *)buffer + offset, sizeof(event));
        if (event.type == 1 && (event.code == 125 || event.code == 773 || event.code == 774)) {
            has_home = 1;
            break;
        }
    }
    if (!has_home) return original_write(fd, buffer, size);
    char path[48], target[64];
    int saved_errno = errno;
    snprintf(path, sizeof(path), "/proc/self/fd/%d", fd);
    ssize_t count = readlink(path, target, sizeof(target) - 1);
    if (count >= 0) target[count] = 0;
    errno = saved_errno;
    if (count < 0 || strcmp(target, HOME_HOOK_UINPUT_PATH)) return original_write(fd, buffer, size);
    // Process in order so a short write never consumes a later Home press.
    // Unrelated events, including SYN_REPORT, keep their bytes and ordering.
    size_t offset = 0;
    while (offset < size) {
        struct input_event32 event;
        memcpy(&event, (const char *)buffer + offset, sizeof(event));
        if (event.type == 1 && consume_home(event.code, event.value)) {
            offset += sizeof(event);
            continue;
        }
        ssize_t written = original_write(fd, (const char *)buffer + offset, sizeof(event));
        if (written < 0) return offset ? (ssize_t)offset : written;
        offset += written;
        if (written != sizeof(event)) break;
    }
    return offset;
}

static unsigned long long read_process_birth(void) {
    char content[1024], *position;
    FILE *file = fopen("/proc/self/stat", "r");
    if (!file) return 0;
    char *result = fgets(content, sizeof(content), file);
    fclose(file);
    if (!result || !(position = strrchr(content, ')'))) return 0;
    position += 2;
    // The first token after the comm field is field 3; starttime is field 22.
    for (int field = 3; field < 22; field++) {
        position = strchr(position, ' ');
        if (!position) return 0;
        position++;
    }
    return strtoull(position, NULL, 10);
}

static int announce_route(const char *route) {
    char message[192];
    snprintf(message, sizeof(message), "LGXMB_HOME 1 READY %s %ld %llu %s %llu\n",
        HOME_HOOK_BUILD_ID, (long)process_id, process_birth, route, monotonic_ms());
    return send_control(message);
}

#ifndef HOME_HOOK_TEST
#include "ezinject_module.h"
#undef MAX
#include <gum/gum.h>

static const char *installed_routes[2];
static unsigned int route_count;

static void *announce_ready(void *unused) {
    (void)unused;
    const struct timespec interval = {0, 500000000};
    for (;;) {
        for (unsigned int i = 0; i < route_count; i++) announce_route(installed_routes[i]);
        nanosleep(&interval, NULL);
    }
    return NULL;
}

int lib_loginit(log_config_t *config) { (void)config; return -1; }
int lib_preinit(struct injcode_user *user) { user->persist = true; return 0; }

int lib_main(int argc, char **argv) {
    (void)argc; (void)argv;
    static int initialized;
    if (initialized || geteuid() != 0) return -1;
    initialized = 1;
    process_id = getpid();
    process_birth = read_process_birth();
    if (!process_birth) return -1;
    control_fd = socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (control_fd < 0) return -1;
    gum_init();
    GumInterceptor *interceptor = gum_interceptor_obtain();
    if (!interceptor) { close(control_fd); control_fd = -1; return -1; }
    gpointer lginput = gum_find_function("lginput_uinput_send_button");
    gpointer micom = gum_find_function("MICOM_FuncWriteKeyEvent");
    gpointer target = NULL;
    int lginput_installed = 0, micom_installed = 0, write_installed = 0;
    if (lginput && gum_interceptor_replace(interceptor, lginput, home_lginput, NULL,
        (gpointer *)&original_lginput) == GUM_REPLACE_OK) {
        lginput_installed = 1;
        installed_routes[route_count++] = "lginput";
    }
    if (micom && gum_interceptor_replace(interceptor, micom, home_micom, NULL,
        (gpointer *)&original_micom) == GUM_REPLACE_OK) {
        micom_installed = 1;
        installed_routes[route_count++] = "micom";
    }
    // An existing hook on a known symbol is not a reason to wrap write too.
    if (!lginput && !micom) {
        target = gum_find_function("write");
        if (target && gum_interceptor_replace(interceptor, target, home_write, NULL,
            (gpointer *)&original_write) == GUM_REPLACE_OK) {
            write_installed = 1;
            installed_routes[route_count++] = "write";
        }
    }
    pthread_t thread;
    unsigned int required = !!lginput + !!micom;
    if (!required) required = 1;
    if (route_count != required || pthread_create(&thread, NULL, announce_ready, NULL)) {
        if (lginput_installed) gum_interceptor_revert(interceptor, lginput);
        if (micom_installed) gum_interceptor_revert(interceptor, micom);
        if (write_installed) gum_interceptor_revert(interceptor, target);
        close(control_fd);
        control_fd = -1;
        return -1;
    }
    __atomic_store_n(&active, 1, __ATOMIC_RELEASE);
    pthread_detach(thread);
    return 0;
}
#endif
