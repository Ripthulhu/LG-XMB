// SPDX-License-Identifier: GPL-3.0-only
// Host-side IPC checks. Does not load Gum, inject a process, or contact a TV.
#define HOME_HOOK_TEST
#define HOME_HOOK_BUILD_ID "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
#define HOME_HOOK_DIRECTORY "/tmp/lg-xmb-native-test"
#define HOME_HOOK_UINPUT_PATH HOME_HOOK_DIRECTORY "/uinput"
#include "home-hook.c"
#include <assert.h>

static int forwarded;
static unsigned char written_events[128];
static size_t written_size;
static int write_calls;
static size_t write_limit = sizeof(written_events);
static int pass_lginput(struct uinput_info *info, int key, int state) {
    (void)info; (void)key; (void)state;
    forwarded++;
    return 19;
}
static int pass_micom(int fd, uint16_t type, uint16_t code, int32_t value) {
    (void)fd; (void)type; (void)code; (void)value;
    forwarded++;
    return 23;
}
static ssize_t pass_write(int fd, const void *buffer, size_t size) {
    (void)fd;
    write_calls++;
    if (size > write_limit) size = write_limit;
    assert(written_size + size <= sizeof(written_events));
    memcpy(written_events + written_size, buffer, size);
    written_size += size;
    return size;
}

static void lease(const char *id, unsigned long long stamp) {
    FILE *file = fopen(HOME_HOOK_DIRECTORY "/lease", "w");
    assert(file);
    assert(fchmod(fileno(file), 0600) == 0);
    fprintf(file, "LGXMB_HOME 1 %s %llu\n", id, stamp);
    assert(fclose(file) == 0);
}

int main(void) {
    assert(geteuid() == 0); // Ownership validation is part of the test.
    assert(mkdir(HOME_HOOK_DIRECTORY, 0700) == 0);
    assert(chmod(HOME_HOOK_DIRECTORY, 0700) == 0);
    struct sockaddr_un address = {.sun_family = AF_UNIX};
    strcpy(address.sun_path, HOME_HOOK_DIRECTORY "/control.sock");
    int receiver = socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    assert(receiver >= 0 && bind(receiver, (struct sockaddr *)&address, sizeof(address)) == 0);
    assert(chmod(address.sun_path, 0600) == 0);
    control_fd = socket(AF_UNIX, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    assert(control_fd >= 0);
    process_id = getpid();
    process_birth = read_process_birth();
    assert(process_birth > 0);
    active = 1;

    assert(!consume_home(773, 1)); // No lease: stock Home retains its full press.
    assert(!consume_home(773, 2));
    assert(!consume_home(773, 0));
    lease(HOME_HOOK_BUILD_ID, monotonic_ms());
    assert(!consume_home(28, 1)); // OK, arrows, pointer and wheel are not Home.
    assert(!consume_home(103, 1));
    assert(!consume_home(773, 3));
    assert(!consume_home(773, 2)); // Unpaired repeat/release must pass.
    assert(!consume_home(773, 0));
    errno = EACCES;
    assert(consume_home(773, 1));
    assert(errno == EACCES);
    char message[256];
    ssize_t length = recv(receiver, message, sizeof(message) - 1, 0);
    assert(length > 0);
    message[length] = 0;
    assert(strstr(message, "LGXMB_HOME 1 HOME " HOME_HOOK_BUILD_ID " ") == message);
    assert(strstr(message, " 773 1 "));
    assert(consume_home(773, 1) && consume_home(773, 2));
    assert(recv(receiver, message, sizeof(message), 0) < 0 && errno == EAGAIN);
    assert(unlink(HOME_HOOK_DIRECTORY "/lease") == 0);
    assert(consume_home(773, 0)); // Finish swallowed sequence after helper exit.
    assert(!consume_home(773, 0) && !consume_home(773, 1));

    lease("different-build", monotonic_ms());
    assert(!consume_home(773, 1));
    lease(HOME_HOOK_BUILD_ID, monotonic_ms() - 2000);
    assert(!consume_home(773, 1));
    lease(HOME_HOOK_BUILD_ID, monotonic_ms() + 10000);
    assert(!consume_home(773, 1));
    lease(HOME_HOOK_BUILD_ID, monotonic_ms());
    assert(chmod(HOME_HOOK_DIRECTORY "/lease", 0666) == 0);
    assert(!consume_home(773, 1));
    assert(chmod(HOME_HOOK_DIRECTORY "/lease", 0600) == 0);
    assert(chmod(address.sun_path, 0666) == 0);
    assert(!consume_home(773, 1));
    assert(chmod(address.sun_path, 0600) == 0);
    assert(chmod(HOME_HOOK_DIRECTORY, 0777) == 0);
    assert(!consume_home(773, 1));
    assert(chmod(HOME_HOOK_DIRECTORY, 0700) == 0);

    assert(announce_route("micom"));
    length = recv(receiver, message, sizeof(message) - 1, 0);
    assert(length > 0);
    message[length] = 0;
    char *stamp = strrchr(message, ' ');
    assert(stamp && strtoull(stamp + 1, NULL, 10) <= monotonic_ms());
    assert(strstr(message, "LGXMB_HOME 1 READY " HOME_HOOK_BUILD_ID " ") == message);
    assert(strstr(message, " micom "));

    original_lginput = pass_lginput;
    original_micom = pass_micom;
    struct keybind_info bindings[2] = {{.code = 773}, {.code = 28}};
    struct uinput_info info = {.fd = 1, .keybinds = bindings};
    assert(home_lginput(&info, 0, 1) == 0 && home_lginput(&info, 0, 0) == 0);
    assert(home_lginput(&info, 1, 1) == 19 && forwarded == 1);
    assert(home_micom(1, 0, 773, 1) == 23 && forwarded == 2);
    assert(home_micom(1, 1, 773, 1) == 0 && home_micom(1, 1, 773, 0) == 0);
    while (recv(receiver, message, sizeof(message), 0) >= 0) {}

    original_write = pass_write;
    int uinput = open(HOME_HOOK_UINPUT_PATH, O_CREAT | O_RDWR, 0600);
    assert(uinput >= 0);
    struct input_event32 batch[] = {{.type = 1, .code = 28, .value = 1},
        {.type = 1, .code = 773, .value = 1}, {.type = 0},
        {.type = 1, .code = 773, .value = 2}, {.type = 1, .code = 773, .value = 0}};
    write_limit = 8;
    assert(home_write(uinput, batch, sizeof(batch)) == 8);
    assert(recv(receiver, message, sizeof(message), 0) < 0 && errno == EAGAIN);
    write_limit = sizeof(written_events);
    written_size = 0;
    assert(home_write(uinput, batch, sizeof(batch)) == sizeof(batch));
    assert(written_size == 2 * sizeof(batch[0]));
    assert(!memcmp(written_events, &batch[0], sizeof(batch[0])));
    assert(!memcmp(written_events + sizeof(batch[0]), &batch[2], sizeof(batch[0])));
    written_size = 0;
    assert(home_write(-1, batch, sizeof(batch)) == sizeof(batch));
    assert(written_size == sizeof(batch) && !memcmp(written_events, batch, sizeof(batch)));
    written_size = 0;
    write_calls = 0;
    struct input_event32 navigation[] = {{.type = 1, .code = 103, .value = 1}, {.type = 0}};
    assert(home_write(uinput, navigation, sizeof(navigation)) == sizeof(navigation));
    assert(write_calls == 1 && !memcmp(written_events, navigation, sizeof(navigation)));
    close(uinput);
    assert(unlink(HOME_HOOK_UINPUT_PATH) == 0);
    while (recv(receiver, message, sizeof(message), 0) >= 0) {}

    // Full queues fail open without blocking LG's input thread.
    while (send_control("fill")) {}
    assert(!consume_home(125, 1) && !consume_home(125, 0));
    while (recv(receiver, message, sizeof(message), 0) >= 0) {}
    assert(consume_home(125, 1) && consume_home(125, 0));
    assert(consume_home(774, 1) && consume_home(774, 0));
    close(receiver);
    assert(!consume_home(773, 1)); // Stale socket inode is not a live helper.
    close(control_fd);
    assert(unlink(address.sun_path) == 0);
    assert(unlink(HOME_HOOK_DIRECTORY "/lease") == 0);
    assert(rmdir(HOME_HOOK_DIRECTORY) == 0);
    puts("Home hook IPC checks passed");
    return 0;
}
