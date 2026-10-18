'use strict';
// NÉZŐ MÓD felismerése (/?watch=KÓD): a <head>-ben, szinkron fut, MIELŐTT a belépés (auth.js) elindulna – a néző nem lép be, nem választ karaktert.
// window.KB_WATCH = a szoba kódja; <html class="watch-mode">. A többit a public/watch.js végzi.
(function () {
  try {
    var m = /[?&]watch=([A-Za-z0-9]{4})(&|$)/.exec(location.search || '');
    if (m) { window.KB_WATCH = m[1].toUpperCase(); document.documentElement.classList.add('watch-mode'); }
  } catch (e) { /* nincs néző mód */ }
})();
