# Background

Open **Settings → Appearance → Background**. **Theme** shows the selected waves;
**Wallpaper** shows your image. Brightness runs from **Normal** to **-5** and
affects the background, leaving the menu text and icons white.

## Add a wallpaper

Open the installed app once so its helper prepares the image path. Using your
usual root SSH connection, create `/media/internal/lg-xmb` if needed and copy a JPEG to:

```text
/media/internal/lg-xmb/wallpaper.jpg
```

Use that exact lowercase filename. A 1920 × 1080 image fits the interface;
other proportions are cropped to fill the screen. Keep the directory mode
`0755` and the file mode `0644`. Don't change permissions on shared directories.

Select **Wallpaper**. After replacing the file, use **Reload wallpaper**. For a
clean upload, copy the new image under a temporary name before renaming it into
place. A missing or unreadable image keeps the current background.

The image stays outside the installed app and survives updates. Setup creates
only a fixed `user-wallpaper.jpg` link; it doesn't read, replace or delete your
picture. It also prepares that link in a matching
[Home replacement](HOME-TAKEOVER.md) payload. Unexpected files or links are left
alone and reported in the helper log.

## Desktop preview

Place your JPEG at `app/user-wallpaper.jpg`, then select **Wallpaper** in the
preview. Git and the packager exclude that file. No wallpaper is bundled.
