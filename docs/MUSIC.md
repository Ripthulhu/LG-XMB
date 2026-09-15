# Background music

LG-XMB does not include or download a recording. Supply your own MP3.

## On a rooted TV

1. Install LG-XMB and open Home once. Setup creates the music directory and one
   app-relative link. Preparing music is optional: failure cannot block the helper.
2. In Dev Manager's file browser or your existing root file-transfer connection,
   copy the MP3 to `/media/internal/lg-xmb/background.mp3` (exact lowercase name).
3. Open **Settings → Background music → On**. Set volume as desired. Music is
   initially off, with 25% volume selected. After copying a missing file, select
   **Retry playback** or toggle Off and On.

The directory must be traversable and the MP3 readable by the media player:
`0755` for the music directory, `0644` for the file. Do not recursively change
permissions on shared TV directories or private helper settings. If the directory is not present,
create just `/media/internal/lg-xmb` using the TV's existing root connection.

The file is user data, never executable helper code. The app reads it through
`user-music.mp3`, a fixed link prepared on launch. Setup never replaces, copies,
reads, deletes or changes ownership of the recording. The app installer does not
manage the external music directory, so normal app upgrades leave it in place;
Home recreates its own link after an upgrade. It also remains after uninstall.
An unexpected existing link/file is not overwritten; setup logs
`music_path_unavailable` while continuing with the rest of the helper.

## Earlier builds

The canonical path is `/media/internal/lg-xmb/background.mp3`. A recognized
app-relative link from 0.1.22/0.1.23 is retargeted during setup. No recording is
moved or overwritten: a file previously placed in `/var/lib/lg-xmb/music/`
remains there until you copy it to the canonical path yourself.

## Replacing the recording

Turn music Off, upload a replacement named `background.mp3`, then turn it On.
For an atomic replacement, upload as `background.mp3.new` then rename it in the
same directory. Retry playback starts from the beginning of the current file.
Playback resumes the previous position only when returning from an app or live
preview during the same session.

## Playback behaviour

Music loops only while Home is visible. It releases the player before live HDMI
playback or launching another app, then resumes on return. An unsupported,
missing or unreadable file leaves Home usable with a status message and an
explicit retry. Autoplay denial waits for a user gesture; no polling/downloads.
Actual local-file access and audio handoff still require TV validation.

## Desktop development

For a local preview, place a disposable copy at `app/user-music.mp3`. It is ignored
by Git and excluded from package staging, as is the old `app/audio/` directory.
Do not commit recordings. Browser lifecycle tests generate silent PCM in memory;
this checks decoding/looping without requiring or shipping anyone's music.
