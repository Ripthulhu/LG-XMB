/* Original vector icons for the OpenXMB C5 adaptation. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var paths={
 network:'<circle cx="24" cy="10" r="5"/><circle cx="10" cy="35" r="5"/><circle cx="38" cy="35" r="5"/><path d="M21 14 13 31M27 14l8 17M15 35h18"/>',
 inputs:'<rect x="8" y="10" width="32" height="25" rx="4"/><path d="M17 40h14M24 35v5M3 23h17m-5-5 5 5-5 5"/>',
 watch:'<rect x="5" y="10" width="38" height="28" rx="5"/><path d="M18 43h12M18 4l6 6 6-6"/><path d="m21 18 10 6-10 6z"/>',
 library:'<path d="M10 12v28M6 8h8v32H6zM20 8h8v32h-8zM32 11l7-2 8 29-8 2z"/>',
 apps:'<rect x="6" y="6" width="14" height="14" rx="4"/><rect x="28" y="6" width="14" height="14" rx="4"/><rect x="6" y="28" width="14" height="14" rx="4"/><rect x="28" y="28" width="14" height="14" rx="4"/>',
 settings:'<path d="m20 5-1 6-5 3-6-2-4 7 5 4v5l-5 4 4 7 6-2 5 3 1 5h8l1-5 5-3 6 2 4-7-5-4v-5l5-4-4-7-6 2-5-3-1-6z"/><circle cx="24" cy="25" r="7"/>',
 live:'<rect x="5" y="13" width="38" height="27" rx="4"/><path d="m15 4 9 9 9-9M11 33h17M35 23v.1M35 29v.1"/>',
 channels:'<path d="M10 9h28v30H10zM16 3v6M32 3v6M16 39v6M32 39v6M3 17h7M3 31h7M38 17h7M38 31h7"/><path d="m20 17 11 7-11 7z"/>',
 media:'<rect x="5" y="7" width="38" height="34" rx="4"/><path d="m19 17 12 7-12 7zM5 13h38M5 35h38M12 7v6M24 7v6M36 7v6M12 35v6M24 35v6M36 35v6"/>',
 hdmi:'<path d="M8 11h32v15l-7 8H15l-7-8zM18 34v9M30 34v9M15 17v6M21 17v6M27 17v6M33 17v6"/>',
 home:'<path d="m4 23 20-17 20 17M10 19v23h28V19M19 42V28h10v14"/>',
 music:'<path d="M19 33V10l23-5v25M19 17l23-5"/><ellipse cx="12" cy="36" rx="7" ry="5"/><ellipse cx="35" cy="33" rx="7" ry="5"/>',
 globe:'<circle cx="24" cy="24" r="19"/><ellipse cx="24" cy="24" rx="8" ry="19"/><path d="M5 24h38M9 13h30M9 35h30"/>',
 brew:'<path d="M10 17h25v17a8 8 0 0 1-8 8h-9a8 8 0 0 1-8-8zM35 19h3a6 6 0 0 1 0 12h-3M15 5v5M23 3v7M31 5v5"/>',
 shop:'<path d="M9 17h30l3 26H6zM17 17v-6a7 7 0 0 1 14 0v6"/>',
 image:'<rect x="5" y="7" width="38" height="34" rx="4"/><circle cx="16" cy="17" r="4"/><path d="m5 34 12-11 8 7 8-12 10 12"/>',
 palette:'<circle cx="24" cy="24" r="19"/><path d="M24 5c-14 14 14 24 0 38"/><circle cx="14" cy="22" r="2"/><circle cx="34" cy="26" r="2"/>',
 motion:'<path d="M3 18h10M2 25h8M5 32h10"/><circle cx="30" cy="25" r="14"/><path d="m27 18 8 7-8 7"/>',
 sound:'<path d="M6 18h9L27 8v32L15 30H6zM34 16a12 12 0 0 1 0 16M39 10a21 21 0 0 1 0 28"/>',
 info:'<circle cx="24" cy="24" r="19"/><path d="M24 21v14M24 13v1"/>',
 casting:'<path d="M5 19V9h38v30H26M5 26a13 13 0 0 1 13 13M5 33a6 6 0 0 1 6 6M5 39v.1"/>',
 camera:'<path d="m7 15 8-1 4-7h11l4 7 8 1v26H7z"/><circle cx="25" cy="27" r="8"/>',
 game:'<path d="M13 15h22c7 0 13 25 6 25-4 0-8-8-10-8H17c-2 0-6 8-10 8C0 40 6 15 13 15zM12 23v8M8 27h8M32 23v.1M37 28v.1"/>'
};
window.C5Icon=function(name){return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.apps)+'</svg>';};
})();
