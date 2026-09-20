// Keep personal assets and their runtime links out of distributable IPKs.
const path = require('node:path');
function includeAppFile(appDir, source) {
  const relative = path.relative(appDir, source);
  return relative !== 'user-music.mp3' && relative !== 'user-wallpaper.jpg' && relative !== 'audio' &&
    !relative.startsWith('audio' + path.sep) && !/\.(mp3|wav|ogg|flac|m4a|aac|mp4)$/i.test(relative);
}
module.exports = {includeAppFile};
