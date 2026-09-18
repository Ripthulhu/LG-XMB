# Background music

LG-XMB loops your own MP3 while Home is visible. It doesn't include or download
a recording. Music starts off, with volume set to 25%.

## Add a recording

Open the installed app once on a rooted TV so its helper can prepare the music
path. Copy your MP3 to:

```text
/media/internal/lg-xmb/background.mp3
```

Use that exact lowercase filename. The directory must be traversable and the
file readable by the media player: `0755` for this directory and `0644` for the
MP3. Don't recursively change permissions on shared TV directories.

Enable **Settings → Background music → On**. Select **Retry playback** after
adding a missing file or when autoplay was blocked.

The developer app reads the file through `user-music.mp3`, a fixed link created
by its helper. The recording remains outside the app, survives updates and isn't
removed on uninstall. Setup doesn't read, overwrite or change ownership of it.
An unexpected existing link or file is left alone and logged.

For a bind-mounted Home, the copied payload also needs this fixed music link.
The capture bootstrap's automatic Home-payload repair covers sound effects,
not the music link. See [Home replacement](HOME-TAKEOVER.md).

## Replace a recording

Turn music off, replace `background.mp3`, then turn it on. To avoid a partial
file during upload, copy it as `background.mp3.new` and rename it when complete.
Retry starts the current file from the beginning.

Music releases its player when launching an app or starting a live HDMI preview.
On return during the same session, it resumes from the previous position.
Missing, unreadable or unsupported files leave the menu usable.

Under `com.webos.app.home`, the TV may create an audio pipeline without connecting
it to the speakers. `connectMusicAudio` in `app/tv-bridge.js` connects that pipeline
when music starts. A “playing” state alone doesn't prove audible output.

## Desktop preview

Place a disposable MP3 at `app/user-music.mp3` for the local preview. Git and the
packager exclude it. Don't commit recordings.

```sh
npm run test:music
```

Run the preview server first. The test uses generated audio and synthetic native
calls. TV file access and HDMI/audio handoff still need an on-device check.
