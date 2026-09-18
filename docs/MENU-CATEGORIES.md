# Menu categories

The bar contains Settings, Photo, Music, Video, TV, Apps, Browser and Network.
Home starts in **TV** and remembers the selected row separately for each category.
Changing categories doesn't launch an app.

| Category | Shortcuts |
| --- | --- |
| Settings | Launcher settings and native TV Settings |
| Photo | LG Gallery+ and Media Player |
| Music | Music, Media Player and Plex |
| Video | Media Player and Plex |
| TV | Live TV, LG Channels and HDMI 1–4 |
| Apps | Home Hub and other discovered apps |
| Browser | Web Browser |
| Network | Homebrew Channel and LG Apps |

Media Player opens the same native media browser from each category. These
aren't separate photo, music or video players implemented by LG-XMB.
Plex uses the curated LG store ID `cdp-30`; availability can differ on another TV.
Curated shortcuts are excluded from the discovered Apps list to avoid duplicates.

HDMI names are read from the TV where its service permits it. Refreshing a name
keeps the physical input ID and selection unchanged. Cached and live previews
are selected by that input ID, not by the category's position in the bar.

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
