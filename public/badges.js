'use strict';
// ============================================================
// KIÉRDEMELHETŐ JELVÉNYEK – a meglévő bűnügyi nyilvántartásból (név szerinti statisztika: játék, győzelem, ítéletek, szerepek, díjak, kihívások, pont)
// számolva; új adatot nem tárol, ezért a korábbi játékok is beszámítanak. Megjelenik: a lobbi plakátján, a névválasztó kártyáján (a legrangosabbak),
// a profilban (mind: megszerzett / még elérhető). Új jelvénynél értesítés (a már látott jelvények név szerint a böngészőben: kb_badges_seen).
// window.kbBadges: { list, earned(stats), next(stats), html(stats, max, cls), profileHtml(stats), checkNew(name, stats) }
// ============================================================
(function () {
  // a sorrend a rang (az elöl lévők látszanak a plakáton / kártyán, ha több van, mint ami elfér)
  // key / min: a statisztika mezője és a küszöb (ebből a haladás is számolható)
  const LIST = [
    { id: 'bajnok', icon: '👑', name: 'Bajnok', desc: '5 megnyert játék', key: 'gyozelem', min: 5 },
    { id: 'torzsvendeg', icon: '🏛️', name: 'Törzsvendég', desc: '50 lejátszott játék', key: 'jatek', min: 50 },
    { id: 'vadlo', icon: '🔥', name: 'Rettegett vádló', desc: '5 elítélés ügyészként', key: 'ugyeszSiker', min: 5 },
    { id: 'ugyved', icon: '🛡️', name: 'Sztárügyvéd', desc: '5 felmentés védőként', key: 'vedoSiker', min: 5 },
    { id: 'visszaeso', icon: '🦹', name: 'Visszaeső', desc: '5× elítélve vádlottként', key: 'bunos', min: 5 },
    { id: 'tisztakez', icon: '😇', name: 'Tiszta kéz', desc: '5× felmentve vádlottként', key: 'artatlan', min: 5 },
    { id: 'kihivas', icon: '🎭', name: 'Kihívás-mester', desc: '10 teljesített titkos kihívás', key: 'kihivas', min: 10 },
    { id: 'dijazott', icon: '🏆', name: 'Díjazott', desc: '5 játék végi díj', key: 'dijak', min: 5 },
    { id: 'biro', icon: '🔨', name: 'Bírói talár', desc: '10× a kör bírója', key: 'biro', min: 10 },
    { id: 'tanu', icon: '👁️', name: 'Koronatanú', desc: '10× tanú', key: 'tanu', min: 10 },
    { id: 'pontgyujto', icon: '💯', name: 'Pontgyűjtő', desc: 'összesen 100 pont', key: 'pont', min: 100 },
    { id: 'veteran', icon: '⚖️', name: 'Veterán', desc: '10 lejátszott játék', key: 'jatek', min: 10 },
    { id: 'gyoztes', icon: '🥇', name: 'Győztes', desc: 'megnyert egy játékot', key: 'gyozelem', min: 1 },
    { id: 'elso', icon: '🎖️', name: 'Első tárgyalás', desc: 'végigjátszott egy játékot', key: 'jatek', min: 1 }
  ];
  for (const b of LIST) b.test = (s) => s[b.key] >= b.min;
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
  // haladás egy jelvény felé (0–1) és a legközelebbi még meg nem szerzett jelvény (a legnagyobb haladású; egyenlőnél a kisebb küszöb)
  const progress = (b, s) => Math.max(0, Math.min(1, s[b.key] / b.min));
  function next(stats) {
    const s = norm(stats);
    let best = null;
    for (const b of LIST) {
      if (b.test(s)) continue;
      const p = progress(b, s);
      if (!best || p > best.p || (p === best.p && b.min < best.b.min)) best = { b, p };
    }
    return best ? { id: best.b.id, icon: best.b.icon, name: best.b.name, desc: best.b.desc, have: s[best.b.key], need: best.b.min, p: best.p } : null;
  }
  // a profil "Jelvények" blokkja: érmék (a megszerzettek aranyban; a többin a gyűrű a haladást mutatja) + a következő jelvény sávja
  function profileHtml(stats) {
    const s = norm(stats), got = new Set(earned(stats).map((b) => b.id)), nx = next(stats);
    return '<div class="ps-badges"><h4>JELVÉNYEK <small>' + got.size + ' / ' + LIST.length + '</small></h4>' +
      (nx ? '<div class="pb-next"><i aria-hidden="true">' + nx.icon + '</i><div><b>Következő: ' + esc(nx.name) + '</b><span>' + nx.have + ' / ' + nx.need + ' · ' + esc(nx.desc) + '</span>' +
        '<span class="pb-bar" aria-hidden="true"><span style="width:' + Math.round(nx.p * 100) + '%"></span></span></div></div>' : '<div class="pb-next all"><i aria-hidden="true">🏛️</i><div><b>Mind a ' + LIST.length + ' jelvény a tiéd!</b><span>A bíróság fejet hajt.</span></div></div>') +
      '<div class="pb-grid">' +
      LIST.map((b) => { const have = got.has(b.id), p = have ? 100 : Math.round(progress(b, s) * 100);
        return '<div class="pb' + (have ? ' got' : '') + '" style="--pdp:' + p + '" title="' + esc(b.name + ' – ' + b.desc + (have ? ' ✔' : ' (' + Math.min(s[b.key], b.min) + ' / ' + b.min + ')')) + '">' +
          '<span class="pb-m" aria-hidden="true"><i>' + b.icon + '</i></span><b>' + esc(b.name) + '</b>' + (have ? '' : '<small>' + Math.min(s[b.key], b.min) + ' / ' + b.min + '</small>') + '</div>'; }).join('') +
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
  window.kbBadges = { list: LIST.map(({ id, icon, name, desc, key, min }) => ({ id, icon, name, desc, key, min })), earned: (s) => earned(s).map((b) => b.id), next, html, profileHtml, checkNew };
})();
