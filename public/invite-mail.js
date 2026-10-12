'use strict';
// "✉️ Meghívó e-mailben" a lobbiban: bejelentkezett fiókkal, a saját szobához. A szobakódot és a jogosultságot a szerver ellenőrzi
// (/api/invite-email); a gomb csak akkor látszik, ha a szerveren működik a levélküldés.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const copy = document.getElementById('btnCopyLink');
  if (!copy) return;
  let mailOk = null;

  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'btnInviteMail'; btn.className = 'btn police hidden';
  btn.textContent = '✉️ Meghívó e-mailben';
  copy.insertAdjacentElement('afterend', btn);

  const dlg = document.createElement('dialog');
  dlg.id = 'inviteMailDialog'; dlg.className = 'bug-dialog';
  dlg.setAttribute('aria-labelledby', 'inviteMailTitle');
  dlg.innerHTML =
    '<form method="dialog" id="inviteMailForm" novalidate>' +
    '<h2 id="inviteMailTitle">✉️ Meghívó e-mailben</h2>' +
    '<p class="bug-sub">Küldünk egy beidéző levelet a szobakóddal és a belépő linkkel. Óránként legfeljebb 3 meghívót küldhetsz.</p>' +
    '<label>A meghívott e-mail címe<input id="inviteMailTo" type="email" maxlength="254" autocomplete="off" placeholder="barat@example.com"></label>' +
    '<p id="inviteMailMsg" class="bug-msg" role="status" aria-live="polite"></p>' +
    '<div class="bug-actions"><button type="button" id="inviteMailCancel" class="btn small ghost">MÉGSEM</button><button type="submit" id="inviteMailSend" class="btn small">KÜLDÉS</button></div>' +
    '</form>';
  document.body.appendChild(dlg);

  async function refresh() {
    const room = window.kbInRoom ? window.kbInRoom() : null;
    if (mailOk === null && window.kbAccount) {
      try { const r = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' }); mailOk = !!(await r.json()).mail; } catch (_) { mailOk = false; }
    }
    btn.classList.toggle('hidden', !(mailOk && window.kbAccount && room && room.lobby));
  }
  document.addEventListener('kb:screen', () => { setTimeout(refresh, 50); });
  // a lobbi-állapot (szoba) frissülésekor is megnézzük
  setInterval(() => { if (document.body.dataset.screen === 'lobby') refresh(); }, 4000);

  const msg = (t, cls) => { const m = $('#inviteMailMsg', dlg); m.textContent = t; m.className = 'bug-msg' + (cls ? ' ' + cls : ''); };
  btn.addEventListener('click', () => { msg(''); $('#inviteMailSend', dlg).disabled = false; if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); $('#inviteMailTo', dlg).focus(); });
  $('#inviteMailCancel', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  $('#inviteMailForm', dlg).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const room = window.kbInRoom ? window.kbInRoom() : null;
    const email = $('#inviteMailTo', dlg).value.trim();
    if (!room || !room.code) { msg('Nem vagy szobában.', 'err'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('Adj meg egy érvényes e-mail címet.', 'err'); return; }
    const send = $('#inviteMailSend', dlg); send.disabled = true; msg('Küldés…');
    try {
      const res = await fetch('/api/invite-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email, code: room.code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Nem sikerült elküldeni.');
      msg('✅ A meghívó elment: ' + email, 'ok');
      $('#inviteMailTo', dlg).value = '';
      setTimeout(() => { if (dlg.open) dlg.close(); }, 1800);
    } catch (e) { msg('❌ ' + (e.message || 'Nem sikerült elküldeni.'), 'err'); send.disabled = false; }
  });
})();
