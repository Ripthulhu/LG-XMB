# Item options

Hold OK or Enter for 650 ms to open the selected item's options. A short press
opens the item on release. A long press doesn't also launch it.

A pointer hold works too. Right-click, the keyboard Context Menu key and F2 open
the panel without waiting for the hold timer.

## Actions

| Action | Behaviour |
| --- | --- |
| Sort By | Default order, Name A–Z or Name Z–A for this category |
| Start / Open | Launch the app or input, or open a launcher setting |
| Delete | Ask for confirmation, then request native app removal if permitted |
| Information | Show native metadata; absent fields say “Not reported” |

Use Up and Down to select an action, OK to confirm, and Back or Left to return.
Back closes a submenu before closing the panel. Live previews stop while the
panel is open. The background animation continues.

Sort order is saved per category. Removing an app removes its shortcuts from
all categories, including both Plex entries. An empty category shows a
non-launching “No apps” row. A later installed-app refresh restores shortcuts
for a reinstalled app.

## Deleting an app

Delete is offered only for an app whose native metadata explicitly says it's
removable and identifies a supported installation path. System apps, HDMI
inputs, this launcher, Developer Mode and Homebrew Channel are protected.
Unknown or refused metadata leaves Delete disabled.

The confirmation starts on **Cancel**. Confirming causes a fresh metadata check
before the uninstall request. The held key used to open options can't confirm
that deletion.

A sent uninstall request isn't cancelled by closing the panel. The app observes
its result for up to 45 seconds and doesn't retry automatically. The TV may
still finish after observation times out; check the installed apps before
trying again.

## Implementation

`app/app-manager.js` reads `com.webos.applicationManager/getAppInfo` and checks
the returned ID. Developer apps use `com.webos.appInstallService/dev/remove`;
store apps use `com.webos.appInstallService/remove`.

The subscription uses `{id, subscribe:true}`. Status `21` is intermediate,
`31` means completion, and `25` or a reported error means failure. An initial
subscription acknowledgement isn't confirmation that the app was removed.
There is no filesystem deletion or root fallback.

`app/menu-order.js` stores sorting in `lg-xmb-menu-order-v1` and removed shortcuts
in `lg-xmb-deleted-apps-v1`. A storage failure doesn't prevent startup, but those
choices then might not survive a restart.

## Tests

```sh
node --test tests/item-options.test.cjs tests/catalog.test.cjs
node tests/item-options-browser.cjs
node tests/item-options-style-browser.cjs
```

The browser tests use synthetic native replies. Check deletion permissions and
completion on the TV under the actual installed identity. Presentation details
are in [ITEM-OPTIONS-STYLING.md](ITEM-OPTIONS-STYLING.md).
