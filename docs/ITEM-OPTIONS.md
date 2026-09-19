# Item options

Hold OK or Enter for 650 ms to open the selected item's options. A short press
opens the item on release. A long press doesn't also launch it.

A pointer hold works too. Right-click, the keyboard Context Menu key and F2 open
the panel without waiting for the hold timer.

## Actions

| Action | Behaviour |
| --- | --- |
| Sort By | Default order, Recently used, Name A–Z or Name Z–A for this category |
| Start / Open | Launch the app or input, or open a launcher setting |
| Hide app | Hide its shortcuts across all categories without uninstalling it |
| Show hidden apps | List hidden apps; select one to restore its shortcuts |
| Delete | Ask for confirmation, then request native app removal if permitted |
| Information | Show native metadata; absent fields say “Not reported” |

Use Up and Down to select an action, OK to confirm, and Back or Left to return.
Back closes a submenu before closing the panel. Live previews stop while the
panel is open. The background animation continues. In Information, Up and Down
scroll the text, including long descriptions; Back returns to the actions.

Sort order is saved per category. Removing an app removes its shortcuts from
all categories, including both Plex entries. An empty category shows a
non-launching “No apps” row. A later installed-app refresh restores shortcuts
for a reinstalled app.

Hidden apps stay installed and retain their category assignments and recent-use
history. Their visibility is saved locally and survives app-list refreshes and
restarts. Show hidden apps is available from any item's options, including the
“No apps” row. It remains reachable when every app in a category is hidden.
Launcher settings and HDMI inputs cannot be hidden. If saving fails, the app
stays in its previous state and the menu reports the error.

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

`app/app-categories.js` stores hidden IDs and display names in
`lg-xmb-hidden-apps-v1`. Hiding and restoring make no native install/remove calls.

## Tests

```sh
node --test tests/item-options.test.cjs tests/catalog.test.cjs
node tests/item-options-browser.cjs
node tests/item-information-scroll-browser.cjs
node tests/item-options-style-browser.cjs
```

The browser tests use synthetic native replies. Check deletion permissions and
completion on the TV under the actual installed identity. Presentation details
are in [ITEM-OPTIONS-STYLING.md](ITEM-OPTIONS-STYLING.md).

Recently used sorts successful opens from this launcher, newest first. Apps shared
across categories share their last-use order. Inputs and launcher settings are
included; unused items retain their default order. The last 1,000 distinct IDs
are stored locally in `lg-xmb-recent-items-v1`, without timestamps or network
requests. Opening apps outside this launcher does not update the order.
