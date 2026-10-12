'use strict';
// Hibajelentő: lebegő gomb + kis űrlap, bárhol elérhető (belépő, menü, lobbi, játék közben is).
// A jelentés a szerverre megy (/api/bugreport), onnan a Discord bot kiposztolja a fejlesztők hibajelentés csatornájába.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  let LS = null;
  try { LS = window.localStorage; } catch (_) { /* tiltott tárhely */ }
  const KINDS = [['bug', 'Hiba / elromlott valami'], ['sound', 'Hang / Voice'], ['ui', 'Kinézet / UI'], ['room', 'Szoba / Lobby'], ['other', 'Egyéb']];

  const fab = document.createElement('button');
  fab.type = 'button'; fab.id = 'bugFab'; fab.className = 'bug-fab';
  fab.setAttribute('aria-label', 'Hibajelentés');
  fab.title = 'Hibát találtál? Jelentsd nekünk!';
  fab.innerHTML = '<span aria-hidden="true">🐞</span><b>Hibajelentés</b>';

  const dlg = document.createElement('dialog');
  dlg.id = 'bugDialog'; dlg.className = 'bug-dialog';
  dlg.setAttribute('aria-labelledby', 'bugTitle');
  dlg.innerHTML =
    '<form method="dialog" id="bugForm" novalidate>' +
    '<h2 id="bugTitle">🐞 Hibajelentés</h2>' +
    '<p class="bug-sub">Írd le, mi romlott el – akár játék közben is. A jelentés egyből a fejlesztőkhöz kerül.</p>' +
    '<label>Mi a hiba típusa?<select id="bugKind">' + KINDS.map((k) => '<option value="' + k[0] + '">' + k[1] + '</option>').join('') + '</select></label>' +
    '<label>Mi történt?<textarea id="bugText" rows="5" maxlength="1200" placeholder="Pl.: a szavazás után nem jelent meg az ítélet…"></textarea></label>' +
    '<label id="bugNameWrap">Neved (nem kötelező)<input id="bugName" maxlength="40" autocomplete="off"></label>' +
    '<p class="bug-note">A jelentéssel automatikusan elküldjük, hol jártál a játékban (képernyő, szobakód) és az eszközöd típusát. Jelszót vagy egyéb adatot nem.</p>' +
    '<p id="bugMsg" class="bug-msg" role="status" aria-live="polite"></p>' +
    '<div class="bug-actions"><button type="button" id="bugCancel" class="btn small ghost">MÉGSEM</button><button type="submit" id="bugSend" class="btn small">KÜLDÉS</button></div>' +
    '</form>';

  function context() {
    let room = '';
    try { const r = window.kbInRoom && window.kbInRoom(); room = (r && r.code) || ''; } catch (_) { /* nincs szoba */ }
    return { where: document.body.dataset.screen || '', room };
  }

  function open() {
    $('#bugMsg', dlg).textContent = '';
    $('#bugMsg', dlg).className = 'bug-msg';
    $('#bugSend', dlg).disabled = false;
    let n = ''; try { n = (LS && LS.getItem('kb_name')) || ''; } catch (_) { /* üres */ }
    $('#bugName', dlg).value = n;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('#bugText', dlg).focus();
  }
  const close = () => { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); };

  async function send(ev) {
    ev.preventDefault();
    const msg = $('#bugMsg', dlg), btn = $('#bugSend', dlg);
    const text = $('#bugText', dlg).value.trim();
    msg.className = 'bug-msg';
    if (text.length < 5) { msg.textContent = 'Írj pár szót arról, mi történt.'; msg.classList.add('err'); return; }
    btn.disabled = true; msg.textContent = 'Küldés…';
    try {
      const res = await fetch('/api/bugreport', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ kind: $('#bugKind', dlg).value, text, name: $('#bugName', dlg).value, ...context() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Nem sikerült elküldeni.');
      msg.textContent = '✅ Köszönjük! A jelentés megérkezett a fejlesztőkhöz (' + data.id + ').';
      msg.classList.add('ok');
      $('#bugText', dlg).value = '';
      setTimeout(() => { if (dlg.open) close(); }, 1800);
    } catch (e) {
      msg.textContent = '❌ ' + (e.message || 'Nem sikerült elküldeni.');
      msg.classList.add('err');
      btn.disabled = false;
    }
  }

  function init() {
    document.body.appendChild(fab);
    document.body.appendChild(dlg);
    fab.addEventListener('click', open);
    $('#bugCancel', dlg).addEventListener('click', close);
    $('#bugForm', dlg).addEventListener('submit', send);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    // A lebegő gomb a billentyűzet-játékot ne zavarja: a szövegmezőben gépelt betűk nem jutnak a játék gyorsbillentyűihez.
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
