// Keep personal assets and their runtime links out of distributable IPKs.
const path = require('node:path');
function includeAppFile(appDir, source, options = {}) {
  const relative = path.relative(appDir, source);
  if (relative === 'media-fonts' || relative.startsWith('media-fonts' + path.sep)) return false;
  if (relative === 'user-fonts' || relative.startsWith('user-fonts' + path.sep)) {
    return options.personalFonts === true && (relative === 'user-fonts' ||
      /^user-fonts[\\/]SCE-PS3-RD-[LRB]-LATIN2\.TTF$/.test(relative));
  }
  return relative !== 'user-music.mp3' && relative !== 'user-wallpaper.jpg' && relative !== 'audio' &&
    !relative.startsWith('audio' + path.sep) && !/\.(mp3|wav|ogg|flac|m4a|aac|mp4)$/i.test(relative);
}
module.exports = {includeAppFile};
