# Item options

Hold OK/Enter for **650 ms** on the main XMB to open the right-hand options panel.
A short press launches on release; the hold, its repeats and its release do not
launch anything. A pointer hold on a row also opens the panel. Right-click,
keyboard Context Menu and F2 provide immediate alternatives. This does not bind
a new system-wide remote key or implement a gamepad API.

The panel slides from the right in 220 ms, dims the underlying scene, and leaves
the waves running. Reduced motion disables the slide. There is no backdrop blur,
new WebGL pass, or renderer/simulation modification.

## Actions

* **Sort By**: Default order, Name A–Z or Name Z–A for the current category. The
  selected item and existing row objects are retained. The choice is local to
  LG-XMB and persists per category; it does not reorder LG's native launcher.
* **Start**: normal application or HDMI launch. Launcher settings use **Open**.
* **Delete**: explicit confirmation with **Cancel initially focused**, followed
  by a fresh native metadata check and an uninstall-service request.
* **Information**: name, application ID, reported version, developer, type,
  installation class and description. Missing fields say “Not reported”.

Use Up/Down to select, OK to activate and Back/Left to return. Back closes a
submenu first. Holding OK never confirms deletion as a side effect of opening
the panel. Live previews are stopped while the panel is open and normal preview
behavior resumes after closing it; opening Start does not briefly restart one.

## Uninstall boundary

`app/app-manager.js` uses a separate, narrowly scoped bridge. It does not change
the existing TV bridge or privileged helper. It reads
`luna://com.webos.applicationManager/getAppInfo` and checks the exact returned ID.
An app is eligible only with `removable: true`, no system flag, and an exact
known installation path under the developer or cryptofs application root.

Home, the developer launcher, native/system IDs, HDMI inputs, Developer Mode and
Homebrew Channel (including its recovery service) are protected independently of
metadata. No filesystem deletion, force flag, shell execution, permission
change or automatic root fallback is used.

Confirmed developer applications use `com.webos.appInstallService/dev/remove`;
store applications use `com.webos.appInstallService/remove`. Both subscribe with
`{id, subscribe:true}`. An initial successful subscription is NOT successful
uninstallation: status **31** is completion; **21** is intermediate; **25** or a
reported error is failure. The timeout is bounded to 45 seconds and never
retries the write. The TV may continue an operation after observation times out.

These are firmware interfaces, not guaranteed public third-party TV APIs. An
ordinary developer installation may be denied. The Home takeover's actual
permissions and returned metadata still require on-TV validation. Refused or
incomplete metadata leaves Delete disabled with a reason; Info and Start remain
usable. Unknown install roots are not guessed.

Closing/hiding before dispatch cancels the fresh metadata request. After the
uninstall is sent, closing the panel does not pretend to undo it: the module
keeps observing its bounded subscription and reconciles a late success even
while Home is hidden. There is no spontaneous retry on wake or relaunch.

All shortcuts for a successfully deleted app are removed, including Plex in
both Music and Video. The neighbouring row is selected, and an empty category
has a non-launching “No apps” row. Explicitly deleted shortcuts are remembered
in `lg-xmb-deleted-apps-v1`; a later successful installed-app enumeration restores
them if the app was reinstalled. This is menu state, not usage history. Sort
choices use the separate `lg-xmb-menu-order-v1` key; existing preferences stay
unchanged. Local storage refusal does not prevent startup or native removal,
but persistent sort/removal bookkeeping then cannot be guaranteed.

## Tests and sources

```
node --test tests/item-options.test.cjs tests/catalog.test.cjs tests/menu-sounds.test.cjs
node tests/item-options-browser.cjs
```

The focused browser suite uses actual app/menu code and CSS, a storage fixture,
and synthetic TV replies/media/wave objects. It cannot establish native
uninstall permission, perceptual TV latency or HDMI recovery. Product CSP is
unchanged; only the source-injection browser harness bypasses it.

Wire protocol references:

* LG webOS OSE installer documentation (not itself a commercial-TV guarantee):
  https://www.webosose.org/docs/reference/ls2-api/com-webos-appinstallservice/#remove
* Homebrew Channel's TV implementation of dev/remove, completion/error handling:
  https://github.com/webosbrew/webos-homebrew-channel/blob/1a2b969e992617c9ba4b8a891542cb93a9e07b0a/services/service.ts
* Homebrew Channel protection follows its recovery warning and its own disabled
  uninstall action, rather than offering destructive removal from this launcher:
  https://github.com/webosbrew/webos-homebrew-channel/blob/1a2b969e992617c9ba4b8a891542cb93a9e07b0a/CHANGELOG.md

No Sony sound, texture or icon files are included. This change is AI-assisted;
review the code and run the C5 checks before publishing it.
