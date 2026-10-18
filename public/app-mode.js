'use strict';
// A Play Áruházas alkalmazás (TWA) felismerése: a Chrome az alkalmazásból indított oldalnak "android-app://com.kamubirosag.app" hivatkozót (referrer) ad.
// Ilyenkor a <html> "in-app" osztályt kap: az önkéntes támogatás (Ko-fi) linkjei az alkalmazásban nem látszanak (a Play fizetési szabályai miatt), a weben maradnak.
// sessionStorage (csak ez a munkamenet): az alkalmazás és a telefon Chrome-ja ugyanazt a tárhelyet használja, így a böngészőben semmi nem rejtőzik el.
// ?app=android: ugyanez kézzel (teszteléshez). A <head>-ben, szinkron fut, hogy semmi ne villanjon fel.
(function () {
  try {
    var ss = window.sessionStorage;
    if (/^android-app:\/\/com\.kamubirosag\.app/.test(document.referrer || '') || /[?&]app=android(&|$)/.test(location.search || '')) ss.setItem('kb_app', 'android');
    if (ss.getItem('kb_app') === 'android') document.documentElement.classList.add('in-app');
  } catch (e) { /* nincs tár: nincs alkalmazás-mód, a weboldal ettől még működik */ }
})();
