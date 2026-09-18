# Date and time

Open **Settings → Date & time** to edit the TV clock. The panel reads the native
clock and time zone before enabling edits.

Left and Right select a field. Up and Down change its value. Number keys enter
a value directly; pointer users can use the +/− controls. OK moves to **Apply
date & time**. Back closes without submitting the edits.

The editor uses 24-hour time and supports dates from 2000 through 2099. The TV's
native service may accept a narrower range. Automatic time synchronisation
stays unchanged and can override a manual value.

## Applying a change

Nothing is written while opening or editing the panel. Apply sends one request
to `com.webos.service.systemservice/time/setSystemTime` with an integer Unix
`utc` value in **seconds**, not JavaScript milliseconds.

The conversion uses the TV's reported time zone. Invalid dates and nonexistent
daylight-saving times are rejected. For a repeated autumn hour, choose its
first or second occurrence.

After an acknowledgement, the panel reads the clock back with a ten-second
tolerance. A different result is reported as a mismatch. A timeout leaves the
outcome uncertain and doesn't trigger another write.

Closing the panel cancels pending reads, but can't undo a write already sent.
The desktop preview doesn't set the computer's clock or connect to a TV.

## Code and tests

`app/system-time.js` handles the native calls and time conversion.
`app/date-time-settings.js` implements the editor. There is no shell command,
permission change or automatic root fallback. A service refusal leaves the
rest of Home usable.

```sh
node --test tests/system-time.test.cjs
node tests/date-time-options-browser.cjs
```

Browser tests use synthetic service replies. Native write permission and the
TV's accepted date range need testing on its actual firmware. For the shared
options-panel layout, see [ITEM-OPTIONS-STYLING.md](ITEM-OPTIONS-STYLING.md).
