# Development release history

These notes describe older builds. Use the current [installation guide](../INSTALLATION.md)
and [build instructions](../BUILDING.md) for setup.

## 0.1.12 — Input labels and bundled helper

- Use the HDMI names configured on the TV.
- Move earlier items above the category bar while scrolling.
- Package the helper and start setup from the app through Homebrew Channel.
- Use `lg-xmb` runtime paths while retaining the installed app ID for upgrades.

## 0.1.13 — Helper package permissions

- Write root-owned app directories with mode 0755 instead of the CLI's 0777.
- Record early setup failures in the bounded startup log.
- Check directory ownership and modes when verifying the IPK.

## 0.1.14 — Labels above the category bar

- Keep labels beside icons after their rows move above the category bar.
- Retain pointer activation and ellipsis for long names.
- Include the helper packaging and logging fixes from 0.1.13.

## 0.1.15 — Legacy helper ownership

- Repair the known 1001:1001 helper-directory owner left by earlier packages.
- Verify the manifest and bundle before changing the recognised directory.
- Refuse unknown owners, unexpected files and changed bundle contents.

## 0.1.16 — Spline-wave background

- Introduce a folded spline-wave background with the existing theme and motion controls.

## 0.1.17 — Full-HD wave output

- Raise the canvas and wave-surface limits from 720p to 1920 × 1080.
- Stop lowering the requested resolution in response to scheduling gaps.

## 0.1.18 — Wave quality settings

- Add supersampling, mesh-detail and edge-softness controls.
- Save quality choices and report reduced sampling after allocation limits.

## 0.1.19 — Wave antialiasing

- Add FXAA and Wave FXAA with selectable smoothing strength.
- Rename the internal-resolution setting to Supersampling.
- Keep the menu text outside the background filter.

## 0.1.20 — Concurrent helper setup

- Serialise boot and app-start setup with a bounded 30-second lock wait.
- Verify the bundle and installation record after acquiring the lock.
- Reuse the matching worker and log overlapping setup attempts.

## 0.1.22 — Particles and background music

- Add particle visibility and density controls.
- Add optional looping background music with saved volume.
- Exclude local recordings from Git and package staging.

## 0.1.24 — Menu motion and music path

- Raise the background and revise category-transition timing.
- Use `/media/internal/lg-xmb/background.mp3` for user music.
- Repoint recognised older music links without moving or overwriting the recording.

## 0.1.27 — Hardware antialiasing

- Add optional MSAA with supported-sample checks and reported allocation fallbacks.
- Correct fractional-sampling alignment and particle viewport restoration.

## 0.1.28 — Category transitions

- Replace the overlapping category swipe with a shorter directional reveal.
- Reuse category rows and icons instead of cloning them during transitions.
- Integrate the cropped wave surface and MSAA controls.

## 0.1.29 — Transform-only menu movement

- Use CSS transforms for category movement and rapid reversals.
- Remove scripted progress reads and animation-completion cleanup.
- Keep row reuse and immediate selection.

## 0.1.30 — Navigation and spline work

- Reduce repeated spline calculations in that version's renderer.
- Avoid redundant menu updates and reuse matching detail icons.
- Keep animation deadlines stable after delayed callbacks.

## 0.1.31 — WebGL 2 background and Home integration

- Replace the background with the reconstructed PS3 3.01 WebGL 2 simulation.
- Add the PS3 monthly background, 30/60 fps selection and full-screen wave view.
- Create particles on the moving sheet and apply navigation-driven wind. Density limits are 1,000, 2,000 and 4,000.
- Retain painted menu rows and delay detail-text updates during rapid navigation.
- Connect background-music audio when running under the LG Home identity.
- Remove the stock Home shortcut, retired renderer and GitHub publishing workflows.
- Commit the runtime reference data so a checkout builds the animated background.

The reference data is included, but isn't relicensed as project source.
WebGL 2 is required for animation; otherwise the menu uses a static backdrop.
The development target remains the LG C5. Other TVs need separate testing.
