'use strict';
// A képernyő ébren tartása, amíg a játékos szobában van (lobbi vagy játék): telefonon hosszabb beszéd / szavazás alatt különben elsötétül és lezár,
// a játékos kiesik, és a szerepe átkerülhet valakire. A böngésző Screen Wake Lock API-ja (Android Chrome / a Play-alkalmazás, asztali Chrome / Edge; Safari 16.4+).
//   - csak látható oldalon kérhető: ha az oldal háttérbe kerül, a böngésző magától elengedi; visszatéréskor (visibilitychange) újra kérjük
//   - a szobán kívüli képernyőkön (belépés, névválasztó, menü) elengedjük
//   - ha nincs API, vagy a böngésző megtagadja (pl. energiatakarékos mód), csendben nem csinál semmit
// window.kbWakeLock.state() a teszteknek: { supported, active, wanted }.
(function () {
  const api = navigator.wakeLock;
  const ROOM_SCREENS = ['lobby', 'game'];
  let lock = null, pending = false;
  const wanted = () => ROOM_SCREENS.includes(document.body && document.body.dataset.screen) && document.visibilityState === 'visible';

  async function acquire() {
    if (!api || lock || pending || !wanted()) return;
    pending = true;
    try {
      const l = await api.request('screen');
      if (!wanted()) { try { await l.release(); } catch (_) { /* */ } return; } // közben kilépett a szobából
      lock = l;
      lock.addEventListener('release', () => { if (lock === l) lock = null; });
    } catch (_) { /* megtagadva / nem támogatott: a játék ettől még működik */ }
    finally { pending = false; }
  }
  async function release() {
    const l = lock; lock = null;
    if (l) { try { await l.release(); } catch (_) { /* */ } }
  }
  function sync() { if (wanted()) acquire(); else release(); }

  document.addEventListener('kb:screen', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pageshow', sync);
  window.kbWakeLock = { state: () => ({ supported: !!api, active: !!lock, wanted: wanted() }), sync };
  sync();
})();
