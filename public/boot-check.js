'use strict';

// Betöltés-ellenőrzés: ha a játék fő szkriptjei nem töltődtek be (gyenge mobilhálózat, deploy közbeni újraindítás, megszakadt kapcsolat),
// az oldal ne maradjon üresen / törötten: egyszer magától újrapróbálja, utána érthető üzenetet és újratöltés gombot mutat.
// Ez a legutolsó szkript. A tartalom-biztonsági szabály (CSP) miatt nincs beágyazott szkript, ezért külön fájl.
(function () {
  const FLAG = 'kb_bootRetry';
  const store = (fn) => { try { return fn(window.sessionStorage); } catch (_) { return null; } };

  // Mi hiányzik? (a globális "const"-ok a szkriptek között láthatók: typeof nem dob hibát)
  // (ha a "const socket = io()" hibára fut, a változó "holt zónában" marad, és már a typeof is hibát dob: ezért try/catch)
  const ok = (probe) => { try { return !!probe(); } catch (_) { return false; } };
  function missing() {
    const out = [];
    if (!ok(() => typeof io !== 'undefined')) out.push('socket.io');
    if (!ok(() => typeof $ !== 'undefined' && typeof socket !== 'undefined' && socket)) out.push('client.js');
    if (!ok(() => 'kbAccount' in window)) out.push('auth.js');
    return out;
  }

  function report(list) {
    try {
      const body = JSON.stringify({ message: 'Betöltési hiba (boot-check): nem töltődött be: ' + list.join(', '), src: 'boot-check.js', line: 0 });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    } catch (_) { /* a jelentés hibája nem okozhat újabb hibát */ }
  }

  function banner(list) {
    if (document.getElementById('bootFail')) return;
    const box = document.createElement('div');
    box.id = 'bootFail'; box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(20,8,12,.94);font-family:system-ui,Segoe UI,Arial,sans-serif;';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:420px;text-align:center;color:#f3ece0;background:#2a0b14;border:2px solid #f2c14e;border-radius:14px;padding:26px 22px;box-shadow:0 10px 40px rgba(0,0,0,.6);';
    const h = document.createElement('div'); h.textContent = '⚖️ Nem sikerült betölteni a játékot';
    h.style.cssText = 'font-size:20px;font-weight:700;color:#f2c14e;margin-bottom:10px;';
    const p = document.createElement('p'); p.textContent = 'A kapcsolat megszakadhatott, vagy a szerver éppen újraindul. Ellenőrizd az internetet, és töltsd újra az oldalt.';
    p.style.cssText = 'margin:0 0 18px;line-height:1.5;font-size:15px;';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'ÚJRATÖLTÉS';
    b.style.cssText = 'font:700 16px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:1px;padding:12px 26px;border-radius:10px;border:2px solid #f2c14e;background:#7b1b2b;color:#f3dfa2;cursor:pointer;';
    b.addEventListener('click', () => { store((s) => s.removeItem(FLAG)); window.location.reload(); });
    card.append(h, p, b); box.appendChild(card); document.body.appendChild(box);
    try { b.focus(); } catch (_) { /* nincs fókusz */ }
  }

  function check() {
    const list = missing();
    if (!list.length) { store((s) => s.removeItem(FLAG)); return; } // minden rendben: a következő hiba megint kaphat egy újrapróbát
    if (!store((s) => s.getItem(FLAG))) {
      // első hiba: egyszer magától újrapróbálja (átmeneti hálózati hiba / újraindulás gyakran ettől elmúlik)
      store((s) => s.setItem(FLAG, '1'));
      window.setTimeout(() => window.location.reload(), 1200);
      return;
    }
    report(list);
    banner(list);
  }

  if (document.readyState === 'complete') check(); else window.addEventListener('load', check, { once: true });
})();
