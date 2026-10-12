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
    '<div class="bug-img"><label class="bug-img-pick">📎 Kép csatolása (nem kötelező)<input id="bugImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
    '<div id="bugImgPrev" class="bug-img-prev" hidden><img id="bugImgThumb" alt="A csatolt kép előnézete"><button type="button" id="bugImgRemove" class="btn small ghost">ELTÁVOLÍT</button></div></div>' +
    '<label id="bugNameWrap">Neved (nem kötelező)<input id="bugName" maxlength="40" autocomplete="off"></label>' +
    '<p class="bug-note">A jelentéssel automatikusan elküldjük, hol jártál a játékban (képernyő, szobakód) és az eszközöd típusát. Jelszót vagy egyéb adatot nem. A csatolt kép a fejlesztők privát csatornájába kerül, ezért ne legyen rajta személyes adat.</p>' +
    '<p id="bugMsg" class="bug-msg" role="status" aria-live="polite"></p>' +
    '<div class="bug-actions"><button type="button" id="bugCancel" class="btn small ghost">MÉGSEM</button><button type="submit" id="bugSend" class="btn small">KÜLDÉS</button></div>' +
    '</form>';

  // A csatolt kép: böngészőben kicsinyítjük (legfeljebb 1600 px, JPEG), hogy gyorsan menjen és kicsi maradjon; a szerver ezt újra ellenőrzi.
  const IMG_MAX_BYTES = 1.2 * 1024 * 1024, IMG_MAX_SIDE = 1600, IMG_RAW_MAX = 12 * 1024 * 1024;
  let imageData = '';
  function setImage(dataUrl) {
    imageData = dataUrl || '';
    const prev = $('#bugImgPrev', dlg);
    prev.hidden = !imageData;
    $('#bugImgThumb', dlg).src = imageData || '';
    if (!imageData) $('#bugImage', dlg).value = '';
  }
  function loadBitmap(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('A fájl nem olvasható képként.')); };
      img.src = url;
    });
  }
  async function shrink(file) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Csak kép csatolható (PNG, JPEG, WebP, GIF).');
    if (file.size > IMG_RAW_MAX) throw new Error('A kép túl nagy (legfeljebb 12 MB).');
    const img = await loadBitmap(file);
    let scale = Math.min(1, IMG_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    for (let q = 0.85, tries = 0; tries < 6; tries++) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // az átlátszó rész fehér lesz (JPEG)
      g.drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', q);
      if (url.length * 0.75 <= IMG_MAX_BYTES) return url;
      if (tries % 2 === 0) q -= 0.15; else scale *= 0.75;
    }
    throw new Error('A képet nem sikerült elég kicsire zsugorítani.');
  }
  async function pickImage(file) {
    const msg = $('#bugMsg', dlg);
    msg.className = 'bug-msg'; msg.textContent = '';
    if (!file) { setImage(''); return; }
    try { setImage(await shrink(file)); } catch (e) { setImage(''); msg.textContent = '❌ ' + (e.message || 'A kép nem használható.'); msg.classList.add('err'); }
  }

  function context() {
    let room = '';
    try { const r = window.kbInRoom && window.kbInRoom(); room = (r && r.code) || ''; } catch (_) { /* nincs szoba */ }
    return { where: document.body.dataset.screen || '', room };
  }

  function open() {
    $('#bugMsg', dlg).textContent = '';
    $('#bugMsg', dlg).className = 'bug-msg';
    $('#bugSend', dlg).disabled = false;
    setImage('');
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
        body: JSON.stringify({ kind: $('#bugKind', dlg).value, text, name: $('#bugName', dlg).value, ...(imageData ? { image: imageData } : {}), ...context() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Nem sikerült elküldeni.');
      msg.textContent = '✅ Köszönjük! A jelentés megérkezett a fejlesztőkhöz (' + data.id + ').';
      msg.classList.add('ok');
      $('#bugText', dlg).value = '';
      setImage('');
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
    $('#bugImage', dlg).addEventListener('change', (e) => pickImage(e.target.files && e.target.files[0]));
    $('#bugImgRemove', dlg).addEventListener('click', () => setImage(''));
    // képernyőkép beillesztése (Ctrl+V) a szövegmezőbe
    dlg.addEventListener('paste', (e) => {
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); pickImage(f); }
    });
    // A lebegő gomb a billentyűzet-játékot ne zavarja: a szövegmezőben gépelt betűk nem jutnak a játék gyorsbillentyűihez.
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
