# Date & time and item-options presentation

## Date & time

Open **Settings → Date & time**. The editor reads the native clock once and shows
its time zone. It edits day, month, year, hour, minute and second (24-hour time).
Left/Right changes field; Up/Down changes its value; number keys allow direct
entry. OK moves to Apply. Clicking the +/− controls works with a pointer.
Back closes without applying the edited values.

**Apply date & time** sends exactly one request through PalmServiceBridge:

```text
luna://com.webos.service.systemservice/time/setSystemTime
{"utc": <integer Unix seconds>}
```

No shell command is executed, no root fallback is added, and no permission or
Home-manifest changes are made. The endpoint is the one provided for this TV.
A root-shell success does not establish permission for the packaged application;
a service refusal is shown without disabling other launcher features.

The UI converts local calendar fields using the time zone reported by
`time/getSystemTime`, not a hard-coded offset or the development computer's
zone. It validates calendar dates and round-trips the conversion. Nonexistent
spring-forward times are rejected; the repeated autumn hour exposes a first/
second occurrence choice. The editor supports 2000–2099, subject to the TV's
native time service accepting that range. Compatibility beyond 2038 on older
32-bit firmware is not established.

The native API gets seconds, **not JavaScript milliseconds**. The OSE reference
has inconsistent wording for this parameter (its example uses Unix seconds);
this implementation follows the supplied TV command and tests its exact value.

Nothing writes on open or while editing. Apply checks for duplicate submissions,
then reads the time back. A successful acknowledgement with a different read-back
value is reported as a mismatch, not as a verified clock update. Read-back uses
a ten-second tolerance to allow request/processing time. Automatic/network time
and timezone preferences are deliberately unchanged; they can override a manual
value. The top-bar clock and currently selected background are refreshed after
an accepted change without reconfiguring renderer quality or simulation.

Reads are cancelled on close/hide. A sent write cannot be undone by closing the
panel: it finishes independently, but cannot reopen or overwrite a later dialog.
Timeouts explicitly leave the result uncertain and do not automatically retry.
Desktop preview does not set either the computer's or TV's clock.

## Item-options opening

The previous panel performed its render/focus/visibility changes together with
its opening transform. Native metadata could arrive while it was moving and
change the status text and Delete state. It also had a full-height shadow and
a partially transparent surface blending over the animated background.

Changes:

- Populate the panel during the existing 650 ms hold, without opening it,
  playing sounds, or calling native services. Reuse the four main action nodes.
- Keep the shell translated outside the viewport with a persistent transform
  layer. Add layout/style/paint containment. Do not animate visibility, opacity,
  dimensions, or shadows. There is no frame-by-frame JS animation.
- Allow a presented frame for focus/layout and preview cleanup before starting
  the 220 ms CSS slide. Query app metadata only when that slide completes, with
  a bounded fallback when transition events are absent.
- Use an opaque panel and a thin border instead of the old 93%-opaque panel and
  blurred shadow. The right pane no longer shows the moving wave through it.
  The surrounding dimmer remains a flat translucent rectangle.
- Back/close cancels scheduled work; Start/lifecycle closes immediately; reduced
  motion bypasses the staging and transition. Confirm/Delete cannot fire from
  the held opening key. Input during the brief opening stage is ignored except
  Back/Left, which can close it.

The waveform, particles, brightness, audio mapping, shaders, helper, media
lifecycle implementation and app identity are unchanged. No extra WebGL pass,
readback or production dependency is added. Persistent compositor layers trade
some retained UI memory for avoiding layer churn; their allocation and cost are
driver-dependent. This is not a zero-memory-overhead claim.

## Evidence and limits

An isolated Chromium 144 trace used the actual before/after item-options module
and stylesheet, with a synthetic metadata reply 50 ms after the request. In the
interior of the opening transition (excluding a 2 ms boundary margin), the old
panel had one Layout and two Paint events; the revised panel had zero of each.
The revised metadata request occurred after the transition rather than during it.
Both animations kept approximately 217 ms of slide time. This demonstrates
removal of a mid-slide repaint path, not a C5 frame-rate measurement.

Focused browser suites run the actual controller and panels at 720p and 1080p,
with native/media/renderer fixtures. Their stylesheet and catalog baseline were
verified against GitHub blob IDs at 9929efd. The actual WebGL workload, native
clock writes, Magic Remote delivery and C5 GPU scheduling remain on-TV checks.
The complete repository test suite was not run.

Sources consulted:

- https://www.webosose.org/docs/reference/ls2-api/com-webos-service-systemservice/
- https://webostv.developer.lge.com/develop/references/system-service
- https://web.dev/articles/animations-guide

The OSE service reference is a protocol reference, not evidence of identical
permissions on commercial TV firmware. AI-assisted change; review before merge.
