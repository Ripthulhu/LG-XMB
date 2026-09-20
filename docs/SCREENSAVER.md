# Screensaver

Open **Settings → Appearance → Screensaver**.

- **Start after:** Off, 30 seconds, 1, 2, 5 or 10 minutes. The default is 2 minutes.
- **Background brightness:** 0%, 10%, 25%, 50%, 75% or 100%. The default is 25%.
- **Preview screensaver:** try it immediately, including when the timer is Off.

After the idle delay, the menu fades out over 1.2 seconds. Waves or wallpaper
stay visible at the selected brightness. This is a percentage of your normal
background brightness; 0% is black, and 100% leaves the background unchanged.

Move the cursor or use the remote to bring the menu back in about 160 ms. The
first button press, click or wheel gesture only wakes it. Your selection and
any open menu stay in place. Stationary cursor notifications don't reset the timer.
Reduced motion skips the fades.

Music keeps playing. Live HDMI previews stop while the screensaver is active
and resume on wake. The screensaver runs only inside Home; returning from
another app or full-screen HDMI starts a fresh idle interval.

## webOS screensaver

This is Home's idle effect. It does not replace or disable the TV's system
screensaver, which can still take over later. Turning this setting Off only
disables Home's effect.

The app manifest deliberately leaves the system screensaver policy at its
default. LG's documented options do not register a custom screensaver:

- `enablePigScreenSaver: false` makes the system screensaver cover the whole
  screen instead of leaving a playing video preview visible.
- `screenSaverProperties.preferredType: 2` adds system dimming and extends the
  system timeout to 30 minutes.
- Type `3` also needs `useGalleryMode: true` and changes the picture mode to
  Gallery.

These would change the TV's behavior independently of Home's brightness and
idle settings. See LG's [manifest reference](https://webostv.developer.lge.com/develop/references/appinfo-json)
and [screensaver guide](https://webostv.developer.lge.com/develop/guides/screensaver).

Home does not use private screensaver APIs or an undocumented
`handlesScreenSaver` manifest flag.
