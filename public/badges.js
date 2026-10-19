'use strict';
// ============================================================
// KIÉRDEMELHETŐ JELVÉNYEK – a meglévő bűnügyi nyilvántartásból (név szerinti statisztika: játék, győzelem, ítéletek, szerepek, díjak, kihívások, pont)
// számolva; új adatot nem tárol, ezért a korábbi játékok is beszámítanak. Megjelenik: a lobbi plakátján, a névválasztó kártyáján (a legrangosabbak),
// a profilban (mind: megszerzett / még elérhető). Új jelvénynél értesítés (a már látott jelvények név szerint a böngészőben: kb_badges_seen).
// window.kbBadges: { list, earned(stats), html(stats, max, cls), profileHtml(stats), checkNew(name, stats) }
// ============================================================
(function () {
  // a sorrend a rang (az elöl lévők látszanak a plakáton / kártyán, ha több van, mint ami elfér)
  const LIST = [
    { id: 'bajnok', icon: '👑', name: 'Bajnok', desc: '5 megnyert játék', test: (s) => s.gyozelem >= 5 },
    { id: 'torzsvendeg', icon: '🏛️', name: 'Törzsvendég', desc: '50 lejátszott játék', test: (s) => s.jatek >= 50 },
    { id: 'vadlo', icon: '🔥', name: 'Rettegett vádló', desc: '5 elítélés ügyészként', test: (s) => s.ugyeszSiker >= 5 },
    { id: 'ugyved', icon: '🛡️', name: 'Sztárügyvéd', desc: '5 felmentés védőként', test: (s) => s.vedoSiker >= 5 },
    { id: 'visszaeso', icon: '🦹', name: 'Visszaeső', desc: '5× elítélve vádlottként', test: (s) => s.bunos >= 5 },
    { id: 'tisztakez', icon: '😇', name: 'Tiszta kéz', desc: '5× felmentve vádlottként', test: (s) => s.artatlan >= 5 },
    { id: 'kihivas', icon: '🎭', name: 'Kihívás-mester', desc: '10 teljesített titkos kihívás', test: (s) => s.kihivas >= 10 },
    { id: 'dijazott', icon: '🏆', name: 'Díjazott', desc: '5 játék végi díj', test: (s) => s.dijak >= 5 },
    { id: 'biro', icon: '🔨', name: 'Bírói talár', desc: '10× a kör bírója', test: (s) => s.biro >= 10 },
    { id: 'tanu', icon: '👁️', name: 'Koronatanú', desc: '10× tanú', test: (s) => s.tanu >= 10 },
    { id: 'pontgyujto', icon: '💯', name: 'Pontgyűjtő', desc: 'összesen 100 pont', test: (s) => s.pont >= 100 },
    { id: 'veteran', icon: '⚖️', name: 'Veterán', desc: '10 lejátszott játék', test: (s) => s.jatek >= 10 },
    { id: 'gyoztes', icon: '🥇', name: 'Győztes', desc: 'megnyert egy játékot', test: (s) => s.gyozelem >= 1 },
    { id: 'elso', icon: '🎖️', name: 'Első tárgyalás', desc: 'végigjátszott egy játékot', test: (s) => s.jatek >= 1 }
  ];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => { const o = {}; for (const k of ['jatek', 'gyozelem', 'bunos', 'artatlan', 'ugyeszSiker', 'vedoSiker', 'kihivas', 'dijak', 'biro', 'tanu', 'pont']) o[k] = s && typeof s[k] === 'number' ? s[k] : 0; return o; };
  const earned = (stats) => { if (!stats) return []; const s = norm(stats); return LIST.filter((b) => b.test(s)); };

  // kis jelvény-sor (plakát / kártya): a legrangosabbak, a többi "+N"
  function html(stats, max, cls) {
    const list = earned(stats);
    if (!list.length) return '';
    const shown = list.slice(0, max || 4), more = list.length - shown.length;
    return '<span class="kb-badges' + (cls ? ' ' + cls : '') + '" role="list" aria-label="Jelvények">' +
      shown.map((b) => '<span class="kb-badge" role="listitem" title="' + esc(b.name + ' – ' + b.desc) + '" aria-label="' + esc(b.name) + '">' + b.icon + '</span>').join('') +
      (more > 0 ? '<span class="kb-badge-more" title="' + esc(list.slice(shown.length).map((b) => b.name).join(', ')) + '">+' + more + '</span>' : '') + '</span>';
  }
  // a profil "Jelvények" blokkja: mind, a megszerzettek színesen, a többi halványan a feltétellel
  function profileHtml(stats) {
    const got = new Set(earned(stats).map((b) => b.id));
    return '<div class="ps-badges"><h4>JELVÉNYEK <small>' + got.size + ' / ' + LIST.length + '</small></h4><div class="pb-grid">' +
      LIST.map((b) => '<div class="pb' + (got.has(b.id) ? ' got' : '') + '" title="' + esc(b.desc) + '"><i aria-hidden="true">' + b.icon + '</i><b>' + esc(b.name) + '</b><span>' + esc(b.desc) + '</span></div>').join('') +
      '</div></div>';
  }
  // új jelvény: értesítés (név szerint megjegyezve; az első alkalommal csak megjegyzi, nem jelez a régiekről)
  function checkNew(name, stats) {
    if (!name || !stats) return [];
    const key = 'kb_badges_seen:' + name;
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { seen = null; }
    const now = earned(stats).map((b) => b.id);
    const fresh = Array.isArray(seen) ? now.filter((id) => !seen.includes(id)) : [];
    if (!Array.isArray(seen) || fresh.length) { try { localStorage.setItem(key, JSON.stringify(now)); } catch (_) { /* nincs tár */ } }
    for (const id of fresh) {
      const b = LIST.find((x) => x.id === id);
      try { if (typeof showToast === 'function') showToast('🏅 Új jelvény: ' + b.icon + ' ' + b.name + ' – ' + b.desc + '!'); } catch (_) { /* */ }
      try { if (window.kbSound && window.kbSound.play) window.kbSound.play('points'); } catch (_) { /* */ }
    }
    return fresh;
  }
  // a saját számok minden állapot után (a játék végén itt jön meg az új jelvény)
  document.addEventListener('kb:state', () => {
    try {
      if (typeof S === 'undefined' || !S || !S.players || !MY.playerId) return;
      const me = S.players.find((p) => p.id === MY.playerId);
      if (me && !me.isBot && me.profile && me.profile._stats) checkNew(me.name, me.profile._stats);
    } catch (_) { /* a jelvény nem kritikus */ }
  });
  window.kbBadges = { list: LIST.map(({ id, icon, name, desc }) => ({ id, icon, name, desc })), earned: (s) => earned(s).map((b) => b.id), html, profileHtml, checkNew };
})();
