# Compatibility

The first target is webOS 22–26. Choose by the installed platform, not the TV's
purchase year. LG publishes the [engine mapping](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine):

| Platform | Chromium | Project status |
| --- | --- | --- |
| webOS 22 | 87 | Target; not TV-tested by this compatibility change |
| webOS 23 | 94 | Target; not TV-tested by this compatibility change |
| webOS 24 | 108 | Target; not TV-tested by this compatibility change |
| webOS 25 | 120 | Existing 0.1.11 C5 test record: webOS 10.3.1; new changes need retesting |
| webOS 26 | 132 | Target; not TV-tested by this compatibility change |

The manifest remains 1920×1080. There is no 720p package variant yet. A desktop
720p layout check is not validation on a Full HD TV; see LG's
[app resolution requirements](https://webostv.developer.lge.com/develop/specifications/app-resolution).

## What is independent

The menu, app launching, live previews, cached capture, Home assignment and each
background control need separate verification. In particular, the C5 helper's
process paths, service definitions and capture geometry are not generic webOS
contracts. The current helper still reports all controls as supported; do not
interpret that as a cross-model capability check.

On webOS 26 Re:New, test Luna calls from the packaged app under LG's
[ACG model](https://webostv.developer.lge.com/develop/guides/acg-guide).
The shell diagnostic below does not change the manifest or test app permissions.

## Read-only diagnostic

On a TV where SSH already works, use a POSIX shell on your computer:

```sh
ssh YOUR_EXISTING_TV_CONNECTION '/usr/bin/python3 -I -B -' < tools/tv-diagnostics.py
```

Replace `YOUR_EXISTING_TV_CONNECTION` with your configured SSH host alias or
user and host. Do not enable root or change SSH settings for this command.
It needs Python 3.7 or newer and the TV's existing `luna-send`.

The command reads the SDK version and the shapes of Home, preload and video
status responses. It reports missing commands and failures independently,
bounds each native response, and omits raw app lists and video data. It does not
load the controller, repair permissions, create caches, assign Home, stop
services or capture a picture. Module availability is checked without importing
OpenCV or NumPy. No report is uploaded automatically.

`ok` means a read returned the expected shape in that shell context. It does not
mean the corresponding feature is safe to enable. `service_refused` deliberately
does not guess whether the cause is a permission, a missing method or firmware
behavior. SDK versions are reported verbatim, not inferred from a model name.

## Startup lifecycle

The `init.d` entry is now a symlink to the packaged `app/helper-startup.py`,
following [Homebrew's startup guidance](https://www.webosbrew.org/develop/guides/startup-script/).
Recovery accepts only that exact root-owned link or a reviewed legacy copy.
Tests cover migration, dangling links, changed/foreign entries and app removal;
CI also checks that the IPK contains the executable startup entry.

Deleting the app breaks the link, not the TV's Home assignment. Restore settings
before uninstalling; see [removal and leftovers](INSTALLATION.md#removal-and-leftovers).
The new startup/recovery path still needs an actual C5 install, reboot, upgrade
and removal test before release. The earlier 0.1.11 test record does not cover it.

## Before broad distribution

Outstanding: per-feature helper profiles, safe new-install defaults in the
controller itself, capture/controller isolation, and verified geometry outside
the C5. Keep the helper C5-only until those changes are tested.

Before Homebrew submission, make the corresponding source publicly reachable
and verify the package source URL. Do not submit a private source URL to the
open-source repository pool.

For each claimed platform, record the model, installed SDK/firmware, app commit,
installation method and whether root was used. Test cold start, remote/pointer
navigation, app launch/return, helper absence, Home/Back behavior, standby/resume,
upgrade and removal. Test live HDMI, capture, Home assignment and restoration
only as separate, deliberate checks with an independent recovery route.
