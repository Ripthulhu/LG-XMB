# Menu categories

The bar contains Settings, Photo, Music, Video, TV, Apps, Browser and Network.
Home starts in **TV** and remembers the selected row separately for each category.
Changing categories doesn't launch an app.

| Category | Shortcuts |
| --- | --- |
| Settings | Launcher settings and native TV Settings |
| Photo | LG Gallery+ and Media Player |
| Music | Music and Media Player |
| Video | Media Player |
| TV | Live TV, LG Channels and physical inputs reported by the TV |
| Apps | Home Hub and other discovered apps |
| Browser | Web Browser |
| Network | Homebrew Channel and LG Apps |

Media Player opens the same native media browser from each category. These
aren't separate photo, music or video players implemented by LG-XMB.
Other installed apps, including Plex, start under Apps.
Curated shortcuts are excluded from the discovered Apps list to avoid duplicates.

Input names are read from the TV where its service permits it. Refreshing a name
keeps the physical input ID and selection unchanged. Cached and live previews
are selected by that input ID, not by the category's position in the bar.
Apps and inputs can appear in one or more categories chosen from their long-press
menu. For example, HDMI 2 can sit under Video for a DVD player. The same menu lets
you choose a plain XMB icon. These choices survive inventory refreshes and restarts.

Hold OK on an item for [sorting, information and other options](ITEM-OPTIONS.md).
Sort order is local to LG-XMB and doesn't reorder LG's launcher.

## Code and tests

`app/catalog.js` defines the curated entries. `app/app.js` handles installed-app
discovery and navigation. Use category IDs and item IDs in tests rather than
assuming a fixed row number.

```sh
node --test tests/catalog.test.cjs
node tests/catalog-browser.cjs
```

The browser test uses synthetic TV, media and renderer objects. It checks menu
behaviour, not whether a particular native app is installed or launchable.
