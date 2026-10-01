/* Original XMB-inspired vector icons. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  // Each icon uses a 48 x 48 viewBox and inherits the surrounding text color.
  // Separate SVG elements and subpaths below so silhouettes are easy to edit.
  // Keep these flat: no gradients, filters, external assets or animation.
  var paths = {
    // Main category symbols.
    settings:
      '<path d="' +
      'M15 14V11a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v3h8a3 3 0 0 1 3 3v3H36.2v-.4a1.8 1.8 0 0 0-1.8-1.8h-3a1.8 1.8 0 0 0-1.8 1.8v.4H18.4v-.4a1.8 1.8 0 0 0-1.8-1.8h-3a1.8 1.8 0 0 0-1.8 1.8v.4H4v-3a3 3 0 0 1 3-3zm3 0h12v-3a1.7 1.7 0 0 0-1.7-1.7h-8.6A1.7 1.7 0 0 0 18 11z' +
      'M4 23h7.8v1.4a1.8 1.8 0 0 0 1.8 1.8h3a1.8 1.8 0 0 0 1.8-1.8V23h11.2v1.4a1.8 1.8 0 0 0 1.8 1.8h3a1.8 1.8 0 0 0 1.8-1.8V23H44v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/>',
    image:
      '<path d="' +
      'M20 7h8c1 0 2 1 2.5 2l2 5H40a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3h7.5l2-5c.5-1 1.5-2 2.5-2z' +
      'M24 17a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/>' +
      '<circle cx="24" cy="26" r="4.6"/>',
    music:
      '<path d="' +
      'M15 8c0-2 1-3 3-2 6 3 13 3 19 0 2-1 3 0 3 2v27c0 4-4 8-8 8s-6-3-5-6c1-5 5-8 9-8V14c-6 2-11 2-17 0v21c0 4-4 8-8 8s-6-3-5-6c1-5 5-8 9-8z"/>',
    media:
      '<path d="' +
      'M5 10h2a.6.6 0 0 1 .6.6v.8a.6.6 0 0 0 .6.6h3.2a.6.6 0 0 0 .6-.6v-.8a.6.6 0 0 1 .6-.6H15v3h20v-3h2.4a.6.6 0 0 1 .6.6v.8a.6.6 0 0 0 .6.6h3.2a.6.6 0 0 0 .6-.6v-.8a.6.6 0 0 1 .6-.6h2a.6.6 0 0 1 .6.6v26.8a.6.6 0 0 1-.6.6h-2a.6.6 0 0 1-.6-.6v-.8a.6.6 0 0 0-.6-.6h-3.2a.6.6 0 0 0-.6.6v.8a.6.6 0 0 1-.6.6H35v-4H15v4h-2.4a.6.6 0 0 1-.6-.6v-.8a.6.6 0 0 0-.6-.6H8.2a.6.6 0 0 0-.6.6v.8a.6.6 0 0 1-.6.6H5a.6.6 0 0 1-.6-.6V10.6a.6.6 0 0 1 .6-.6z' +
      'M15 16v15h20V16z' +
      'M7.5 15v4h4.5v-4zm0 7v4h4.5v-4zm0 7v4h4.5v-4zm30-14v4H42v-4zm0 7v4H42v-4zm0 7v4H42v-4z" transform="translate(-1 0)"/>',
    live:
      // Follow the 35n alpha outline from icontex.qrc (DDS rows reversed),
      // retaining its 128px texture origin and slightly elliptical arcs. Centering
      // the whole silhouette shifts the screen left of the category label.
      // Frame, outer arc, inner arc and dot share one fill. Matching winding
      // joins the arc to the frame without painting translucent colour twice;
      // only the screen opening winds the other way to cut a hole.
      '<path transform="translate(24 24) scale(.47) translate(-64 -64)" fill-rule="nonzero" d="M34.5 38.3h58.3a6 6 0 0 1 6 6v41.9a6 6 0 0 1-6 6H34.5a6 6 0 0 1-6-6V44.3a6 6 0 0 1 6-6z' +
      'M39.5 48.8v33.2h48.2V48.8z' +
      'M115.3 54a30.5 30.9 0 0 1-30.5-30.9h5.7a24.8 25.2 0 0 0 24.8 25.2z' +
      'M115.2 40.5a17.1 17.4 0 0 1-17.1-17.4h5.6a11.5 11.7 0 0 0 11.5 11.7z' +
      'M116.3 17.1a5.2 5.2 0 1 1 0 10.4 5.2 5.2 0 1 1 0-10.4z"/>',
    apps:
      '<path d="' +
      'M12 11c3-1 5 1 8 3h9c3-2 5-4 8-3 4 1 6 6 8 17 1 7 0 10-3 11-4 2-6-1-8-4l-5-7H16l-5 7c-2 3-5 6-9 3-2-2-2-6-1-11 2-10 4-14 7-16 1 0 3-1 4 0z" transform="translate(3 0) scale(.91 1)"/>',
    globe:
      '<path transform="translate(4 4) scale(.1384083) translate(-67 -46)" d="' +
      'M211.5 46a144.5 144.5 0 1 0 0 289 144.5 144.5 0 0 0 0-289z' +
      'M137 104c12-10 25-17 39-22-6 10-10 20-14 31-9-2-17-5-25-9z' +
      'M208 79q3-4 6 0c9 13 15 26 21 39-16 2-31 2-47 0 5-14 12-27 20-39z' +
      'M246 82c15 5 28 12 39 22-8 4-16 7-25 9-4-11-8-21-14-31z' +
      'M117 126c12 6 24 11 37 15-3 12-4 24-5 37H98c3-19 10-36 19-52z' +
      'M179 146c21 3 43 3 65 0 2 10 4 21 4 32h-73c0-11 2-22 4-32z' +
      'M268 141c13-4 25-9 37-15 10 16 17 33 20 52h-52c0-13-2-25-5-37z' +
      'M98 203h51c1 14 2 27 5 39-13 4-25 9-37 15-10-16-16-34-19-54z' +
      'M175 203h73c0 12-2 23-4 34-22-3-44-3-65 0-2-11-4-22-4-34z' +
      'M273 203h52c-3 20-10 38-20 54-12-6-24-11-37-15 3-12 5-25 5-39z' +
      'M137 279c8-4 16-7 25-9 4 11 8 20 14 30-15-5-27-12-39-21z' +
      'M188 265c16-2 31-2 47 0-5 13-12 26-21 38q-3 4-6 0c-9-12-16-25-20-38z' +
      'M260 270c9 2 17 5 25 9-11 9-24 16-39 21 6-10 10-19 14-30z"/>',
    network:
      '<path d="' +
      'M24 4a20 20 0 1 0 0 40 20 20 0 0 0 0-40zm0 3.5a16.5 16.5 0 1 1 0 33 16.5 16.5 0 0 1 0-33z' +
      'M12.8 12.3c2.3-1.8 4.6-3.1 7.5-3.6l4 .9c.5.1.7.7.3 1.1l-3.1 3.4 1.9 2.3-4.7 2.8-.5 2.9q-.1.9-1 .5l-2.6-1-1.8-4.4-2.6-1.5q1.1-2.2 2.6-3.4z' +
      'M18 24.5q.8-.7 1.7-.3l5.9 2.9.9 4.2q-1.6 4.5-3.9 8.1-.5.7-.9-.2l-2.4-5.3-.5-4.5-2.6-2.4q-.6-.7.1-1.2z' +
      'M30.2 11.1q3 .9 5 3l3.4 4.8q.3.7-.5.9l-3.3.3-2.9 3.2 2.1 2.3-1.8 8.3q-.3.9-1.1.5l-2.4-1.4-3-7 2.1-5-.9-5q.8-3 3.3-4.9z"/>',

    // App shortcuts and generic fallback.
    application:
      '<path d="m7 12 16-10q1-.7 2 0l16 10q1 .6 0 1.2l-2 1.2q-.5.3-1 0L24 5.5 10 14.4q-.5.3-1 0l-2-1.2q-1-.6 0-1.2z' +
      'M4 16q0-.6.6-.2L22 26.3q.3.2.3.6v19q0 .7-.6.3L4.3 35.4q-.3-.2-.3-.6zm40 0q0-.6-.6-.2L26 26.3q-.3.2-.3.6v19q0 .7.6.3l17.4-10.8q.3-.2.3-.6z"/>' +
      '<ellipse cx="23" cy="11.3" rx="2.3" ry="1.4"/>' +
      '<ellipse cx="31.2" cy="16.2" rx="2.3" ry="1.4"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="' +
      'M17.5 15.3c.6 3.2 4.3 4.6 7.8 4.2"/>',
    homehub:
      '<path d="' +
      'M23 6a1.5 1.5 0 0 1 2 0l18 15c1.2 1 .5 2.5-1 2.5H36V36a5 5 0 0 1-5 5H17a5 5 0 0 1-5-5V23.5H6c-1.5 0-2.2-1.5-1-2.5z' +
      'M18.5 23.5a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm11 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z' +
      'M19 31c-1.6-1.3-3.4 1-1.8 2.5 4 3.7 9.6 3.7 13.6 0 1.6-1.5-.2-3.8-1.8-2.5-3 2.5-7 2.5-10 0z"/>',
    brew:
      '<path d="' +
      'M8 17h27v3h3a7 7 0 0 1 0 14h-3v2a7 7 0 0 1-7 7H15a7 7 0 0 1-7-7zm27 7v6h3a3 3 0 0 0 0-6z"/>' +
      '<path d="' +
      'M13 4h3v8h-3zm8-2h3v10h-3zm8 2h3v8h-3z"/>',
    shop:
      '<path d="' +
      'M16 14v-4a8 8 0 0 1 16 0v4h7l4 30H5l4-30zm4-4v4h8v-4a4 4 0 0 0-8 0zm-4 9v6h4v-6zm12 0v6h4v-6z"/>',
    home: '<path d="m2 22 22-18 22 18-3 4-4-3v20H28V29h-8v14H9V23l-4 3zm14 0h16l-8-7z"/>',
    library:
      '<path fill-rule="nonzero" d="' +
      'M5 9h13l4 4h18v4H9v23H5z' +
      'M12 20h32l-6 22H6zm3 4-4 14h24l4-14z"/>',

    // TV, inputs and devices.
    watch:
      '<path d="' +
      'M5 10c12-4 26-4 38 0 2 7 2 18 0 25-12 4-26 4-38 0-2-7-2-18 0-25zm4 3c-1 6-1 13 0 19 9 3 21 3 30 0 1-6 1-13 0-19-9-3-21-3-30 0z' +
      'M21 39h6v3h9v3H12v-3h9z"/>',
    inputs:
      '<path fill-rule="nonzero" d="' +
      'M8 7h32a3 3 0 0 1 3 3v25a3 3 0 0 1-3 3H27v3h8v3H13v-3h8v-3H8v-4h31V11H12v8H8z' +
      'M3 24h17v-6l11 9-11 9v-7H3z"/>',
    hdmi:
      '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="' +
      'M5 14h38v13l-7 7H12l-7-7z"/>' +
      '<path d="' +
      'M11 20h26v3H11z"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.2" d="' +
      'M13 24v3m3-3v3m3-3v3m3-3v3m3-3v3m3-3v3m3-3v3m3-3v3"/>',
    channels:
      '<path d="' +
      'M5 6c9-2 20-2 29 0v3c-8-2-18-2-26 0v19H5z"/>' +
      '<path d="' +
      'M13 13c9-3 21-3 30 0 2 6 2 16 0 22-9 3-21 3-30 0-2-6-2-16 0-22zm4 3c-1 5-1 11 0 16 6 2 16 2 22 0 1-5 1-11 0-16-6-2-16-2-22 0z' +
      'M25 38h5v3h8v3H17v-3h8z"/>' +
      '<path d="m25 19 9 5-9 5z"/>',
    casting:
      '<path d="' +
      'M5 7h39v31H27v-4h13V11H9v9H5z' +
      'M5 23a18 18 0 0 1 18 18h-4A14 14 0 0 0 5 27zm0 8a10 10 0 0 1 10 10h-4a6 6 0 0 0-6-6z"/>' +
      '<circle cx="6" cy="40" r="2"/>',

    // Extra device symbols for custom app and input shortcuts.
    disc:
      '<path d="M24 4a20 20 0 1 0 0 40 20 20 0 0 0 0-40z' +
      'M24 20.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"/>',
    mediasearch:
      // One nonzero fill joins the drive, network bus and magnifier. The lens
      // and drive slot wind the other way, leaving transparent openings.
      '<path fill-rule="nonzero" d="M4.5 21.4H29.9q.6 0 .6.6v7.9q0 .6-.6.6H4.5q-.6 0-.6-.6V22q0-.6.6-.6z' +
      'M15.9 30.1h2.7v5.4h-2.7z' +
      'M5.1 37h24.1a1.5 1.5 0 0 1 0 3H5.1a1.5 1.5 0 0 1 0-3z' +
      'M17.3 34.9a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 1 1 0-7.6z' +
      'M34.8 18.7 43.8 28.3q.4.4 0 .8l-2.7 2.7q-.4.4-.8 0L32 22.1z' +
      'M28 5.5a9.3 9.3 0 1 1 0 18.6 9.3 9.3 0 1 1 0-18.6z' +
      'M28 8.5a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 1 0 0-12.6z' +
      'M9.8 25.1a.85.85 0 0 0 0 1.7h14.8a.85.85 0 0 0 0-1.7z"/>',
    headset:
      '<path d="M9.2 18.3a14.8 14.8 0 0 1 29.6 0c1.5.8 2.3 2.3 2.3 4v3.4c0 1.6-.3 2.6-1.5 4L28.2 43c-2.4 2.1-6 1.4-7.1-.7-1.6-2.8-.5-6.1 2.4-7.1 1.8-.7 3.5-.2 4.9.9l6.2-8.8c-.3-.7-1.3-1.4-1.3-2.2v-6.9a9.3 9.3 0 0 0-18.6 0v6.4c0 2.7-.9 4.4-3.4 4.4H11c-2.4 0-4.1-1.7-4.1-4.2v-3c0-1.5.8-3 2.3-3.9z"/>',
    display:
      '<path transform="translate(3 8.4) scale(.0907) translate(-251 -284)" d="M298 304c123-27 246-27 370 0 12 2 15 9 18 18 38 88 38 182 0 270-5 13-10 14-18 17-124 27-247 27-370 0-13-3-16-8-19-17-37-88-37-182 0-270 6-15 10-16 19-18z' +
      'M321 350c108-22 216-22 324 0 26 70 26 142 0 212-108 22-216 22-324 0-26-70-26-142 0-212z"/>',
    handheld:
      '<path d="M8 12h32q.5 0 .8.4c6.2 6.6 6.2 16.6 0 23.2q-.3.4-.8.4H8q-.5 0-.8-.4C1 29 1 19 7.2 12.4q.3-.4.8-.4z' +
      'M11.7 16h24.6q.3 0 .3.3v15.4q0 .3-.3.3H11.7q-.3 0-.3-.3V16.3q0-.3.3-.3z"/>',
    pc:
      '<path d="M5 11h25q2 0 2 2v18q0 2-2 2h-9v4h7v3H8v-3h8v-4H5q-2 0-2-2V13q0-2 2-2z' +
      'M6 14v15h23V14z' +
      'M37 7h6q2 0 2 2v30q0 2-2 2h-6q-2 0-2-2V9q0-2 2-2z' +
      'M37.5 11v2h5v-2zm0 5v2h5v-2z' +
      'M40 32.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"/>',
    streamer:
      '<path d="M7 26h34a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-6a4 4 0 0 1 4-4z' +
      'M21 29v8l7-4z"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M12 14q12-11 24 0M17 18q7-7 14 0"/>' +
      '<circle cx="24" cy="21" r="1.5"/>',
    console:
      // Leave a gap around the controller so its silhouette reads in front
      // of the console without overlapping translucent fills.
      '<path d="M6 9h36q3 0 3 3v12q0 3-3 3h-4c-.8-2.8-2.3-5.4-5.3-5.8-2.1-.3-3.8.9-5.6 2.2h-4.2c-1.8-1.3-3.5-2.5-5.6-2.2-3 .4-4.5 3-5.3 5.8H6q-3 0-3-3V12q0-3 3-3z' +
      'M8 13v3h20v-3zM39 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z' +
      'M17.3 24c2-.4 3.8 1.3 5.2 2.2h3c1.4-.9 3.2-2.6 5.2-2.2 2.8.6 4 5.1 5.4 10.7.7 3.7-.1 5.3-2.2 5.3s-3.2-2.1-4.6-4.2H18.7c-1.4 2.1-2.5 4.2-4.6 4.2s-2.9-1.6-2.2-5.3c1.4-5.6 2.6-10.1 5.4-10.7z' +
      'M18.3 28.7h1.6v1.5h1.5v1.6h-1.5v1.5h-1.6v-1.5h-1.5v-1.6h1.5z' +
      'M28.6 28.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM31 30.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>',

    // Settings and controls.
    motion:
      '<path d="' +
      'M4 13h14v3H4zm-2 9h12v3H2zm3 9h13v3H5z' +
      'M30 7a17 17 0 1 0 0 34 17 17 0 0 0 0-34zm0 4a13 13 0 1 1 0 26 13 13 0 0 1 0-26z"/>' +
      '<path d="m26 16 11 8-11 8z"/>',
    info:
      '<path d="' +
      'M24 4a20 20 0 1 0 0 40 20 20 0 0 0 0-40zm0 4a16 16 0 1 1 0 32 16 16 0 0 1 0-32z"/>' +
      '<circle cx="24" cy="15" r="2.5"/>' +
      '<path d="' +
      'M20 21h6v13h3v3h-9v-3h2V24h-2z"/>',
    remote:
      '<g transform="rotate(25 24 24)">' +
      '<path d="' +
      'M18 3h12a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm6 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-6 19v3h4v-3zm8 0v3h4v-3z"/>' +
      '<circle cx="24" cy="22" r="3"/>' +
      '</g>'
  };

  // Settings icons share one badge. Its path is kept in the reference's
  // coordinates; only this helper normalises it into the 48 x 48 icon viewBox.
  var settingsBadgePath =
    'M211.5 84.5a127.5 127.5 0 1 1 0 255 127.5 127.5 0 0 1 0-255z' +
    'M268 130c-21-10-44-3-61 14-17 17-19 36-13 58l-66 66q-4 4 0 8l24 25q4 4 8 0l67-67q2-3 6-1c20 10 39 3 55-12 17-16 19-40 11-60l-42 39q-15-10-27-25z';
  var settingsBadgeLayout = { x: 11, y: 11, radius: 9 };

  // Artwork and placement live together. `transform` places a separate body;
  // `joinedOutline` uses the badge's coordinates for a single shared fill.
  // `badge` can move the wrench, but all badges share one radius.
  // Reuse a paths entry for a settings variant of an existing plain icon.
  var settingsIcons = {
    appearance: {
      // The frame shares the badge's coordinates and fill so their overlapping
      // corner stays the same brightness when dimmed.
      joinedOutline:
        'M227.82 246.232h499.94q4.776 0 4.776 4.776v249.97q0 4.776-4.776 4.776H227.82q-4.776 0-4.776-4.776V251.008q0-4.776 4.776-4.776z' +
        'M262.051 282.055q-3.184 0-3.184 3.184v134.538q0 3.184 3.184 3.98c22.29 7.165 48.561 9.553 75.628 9.553 117.024 0 195.836-126.577 355.053-78.812q3.98 1.592 3.98-3.184v-66.075q0-3.184-3.184-3.184z',
      // The landscape frame is wider and lower; its badge overlaps the corner.
      badge: { x: 9.220281, y: 17.192514 }
    },
    sound: {
      body:
        '<path d="M213 304h81l105-93q13-10 13 5v334q0 13-11 5L294 462h-81q-5 0-5-5V309q0-5 5-5z"/>' +
        '<path fill="none" stroke="currentColor" stroke-width="38" stroke-linecap="round" d="M483 311c36 43 36 100 0 143M541 254c68 74 68 184 0 258"/>',
      transform: 'translate(17.5 18.5) scale(.0703518) translate(-208 -208)'
    },
    previewsettings: {
      body: paths.hdmi,
      transform: 'translate(10 15.4) scale(.82)'
    },
    remotesettings: {
      body: paths.remote,
      transform: 'translate(14 12) scale(.7)'
    },
    clock: {
      body:
        '<path d="M489 300a207 207 0 1 0 0 414 207 207 0 0 0 0-414z' +
        'M467 342h44v210h-43l-101-70 26-37 74 52z"/>',
      transform: 'translate(16 16) scale(.0724638) translate(-282 -300)'
    },
    tvsettings: {
      body:
        '<path d="M298 304c123-27 246-27 370 0 12 2 15 9 18 18 38 88 38 182 0 270-5 13-10 14-18 17-124 27-247 27-370 0-13-3-16-8-19-17-37-88-37-182 0-270 6-15 10-16 19-18z' +
        'M321 350c108-22 216-22 324 0 26 70 26 142 0 212-108 22-216 22-324 0-26-70-26-142 0-212z"/>',
      transform: 'translate(13 20) scale(.0712) translate(-251 -284)'
    }
  };

  function settingsIcon(definition) {
    var badge = definition.badge || settingsBadgeLayout;
    var badgeTransform =
      'translate(' +
      badge.x +
      ' ' +
      badge.y +
      ') scale(' +
      settingsBadgeLayout.radius / 127.5 +
      ') translate(-211.5 -212)';
    if (definition.joinedOutline) {
      return (
        '<path transform="' +
        badgeTransform +
        '" fill-rule="nonzero" d="' +
        definition.joinedOutline +
        settingsBadgePath +
        '"/>'
      );
    }
    return (
      '<g transform="' +
      definition.transform +
      '">' +
      definition.body +
      '</g>' +
      '<path transform="' +
      badgeTransform +
      '" d="' +
      settingsBadgePath +
      '"/>'
    );
  }

  // Compose once at startup, not on each row render or navigation event.
  Object.keys(settingsIcons).forEach(function (name) {
    paths[name] = settingsIcon(settingsIcons[name]);
  });

  // Alternate names deliberately share the same artwork.
  paths.camera = paths.image;
  paths.game = paths.apps;

  function icon(name) {
    var key = Object.prototype.hasOwnProperty.call(paths, name) ? name : 'application';
    return (
      '<svg' +
      (Object.prototype.hasOwnProperty.call(settingsIcons, key) ? ' class="settings-symbol"' : '') +
      (key === 'live' ? ' overflow="visible"' : '') +
      ' viewBox="0 0 48 48" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" aria-hidden="true" focusable="false">' +
      paths[key] +
      '</svg>'
    );
  }

  // Keep choices alphabetical; wrench badges and menu controls are not shortcuts.
  icon.choices = [
    { id: 'application', title: 'Application' },
    { id: 'globe', title: 'Browser' },
    { id: 'casting', title: 'Casting' },
    { id: 'channels', title: 'Channels' },
    { id: 'disc', title: 'Disc' },
    { id: 'library', title: 'Folder' },
    { id: 'console', title: 'Game console' },
    { id: 'apps', title: 'Game controller' },
    { id: 'handheld', title: 'Handheld' },
    { id: 'hdmi', title: 'HDMI' },
    { id: 'headset', title: 'Headset' },
    { id: 'home', title: 'Home' },
    { id: 'homehub', title: 'Home Hub' },
    { id: 'brew', title: 'Homebrew' },
    { id: 'inputs', title: 'Input' },
    { id: 'mediasearch', title: 'Media search' },
    { id: 'streamer', title: 'Media streamer' },
    { id: 'watch', title: 'Monitor' },
    { id: 'music', title: 'Music' },
    { id: 'network', title: 'Network' },
    { id: 'pc', title: 'PC' },
    { id: 'image', title: 'Photo' },
    { id: 'display', title: 'Screen' },
    { id: 'shop', title: 'Store' },
    { id: 'settings', title: 'Toolbox' },
    { id: 'live', title: 'TV' },
    { id: 'media', title: 'Video' }
  ];

  root.C5Icon = icon;
  if (typeof module !== 'undefined' && module.exports) module.exports = icon;
})(typeof window !== 'undefined' ? window : globalThis);
