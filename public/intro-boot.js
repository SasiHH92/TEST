'use strict';
// Egyszeri bevezető (intro): a döntés a <head>-ben, szinkron fut, hogy a belépőoldal ne villanjon fel a bevezető előtt.
// Megjelenik: első indításkor (nincs kb_introSeen és nincs kb_helpSeen), de NEM szobalinkkel / tárgyalás-linkkel érkezőknek (?room=, ?court=) – ők játszani jöttek.
// Kényszerítve: ?intro=1. Tiltott böngészőtárnál (privát mód, hiba) nincs intro, az oldal ettől még működik.
(function () {
  try {
    var q = location.search || '';
    var force = /[?&]intro=1(&|$)/.test(q);
    var link = /[?&](room|court|watch)=/.test(q); // a nézőnek (watch) sem
    // automatizált böngészőben (tesztek, Playwright / Selenium: navigator.webdriver) nem jelenik meg magától – a valódi játékosokat ez nem érinti; a ?intro=1 ettől függetlenül kényszeríti
    var bot = !!navigator.webdriver;
    var ls = window.localStorage;
    if (force || (!bot && !link && !ls.getItem('kb_introSeen') && !ls.getItem('kb_helpSeen'))) document.documentElement.classList.add('intro-pending');
  } catch (e) { /* nincs intro */ }
})();
