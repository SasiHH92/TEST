'use strict';

// A Discord átírja a csatornaneveket (kisbetű, szóköz → kötőjel), az emoji változat-
// jelölőket pedig néha levágja. Az azonosításhoz ezért normalizált kulcsot használunk.
function normName(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/[︎️‍]/g, '')
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = { normName };
