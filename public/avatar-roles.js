'use strict';

// ============================================================
// KAMU BÍRÓSÁG – avatár × szerep megfeleltetés
//
// Az avatár azonosítója (av01…av50) MINDIG ugyanaz marad; a szerepenként más kép csak a megjelenítést érinti:
//   assets/roles/avatar_17_judge.webp, avatar_17_prosecutor.webp, avatar_17_defendant.webp, avatar_17_witness.webp, avatar_17_juror.webp
//   (a teljes alapkészlet 50 × 5 kép; a védőügyvéd saját képe, avatar_17_defender.webp, opcionális)
// A szerver a /api/role-sprites címen megmondja, melyik kép IGAZI szerep-kép (a ROLE_ASSET_MANIFEST.json "real" listája; a többi fájl még placeholder) + a képek
// verzióját (?v=), a kliens ezt egyszer letölti. Ahol az adott avatár × szerep képe nincs meg (vagy nem töltődik be: markMissing), a rendszer TARTALÉKOT ad:
// az eredeti avatár portréja marad + HTML szerep-jelvény (getRoleAvatar: soha nem törött kép, soha nem SVG). Az igazi képek 720 × 960-as, átlátszó WebP-k
// (scripts/build-role-assets.js); a megjelenítésük elrendezése (ROLE_LAYOUT / NARROW_LAYOUT / MOBILE_LAYOUT / AVATAR_ROLE_ADJUSTMENTS) ugyanitt van.
// Lásd assets/roles/README.md és docs/ROLE-ASSETS.md.
// A modul böngészőben (window.kbAvatarRoles) és Node-ban (tesztek) is használható.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.kbAvatarRoles = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CORE_ROLES = ['judge', 'prosecutor', 'defendant', 'witness', 'juror']; // az 50 × 5 alapkészlet
  const ROLES = ['judge', 'prosecutor', 'defendant', 'defender', 'witness', 'juror']; // + a védőügyvéd (opcionális kép)
  const AVATAR_RE = /^av(0[1-9]|[1-4]\d|50)$/;
  const EXT = 'webp';
  const BASE = '/assets/roles/';

  // { av17: { judge: true, prosecutor: true } } – a szerver listája
  let available = {};
  let version = ''; // a képek verziója (?v=): a kicserélt képek ne ragadjanak be a böngésző gyorsítótárában

  const numberOf = (avatarId) => (AVATAR_RE.test(avatarId || '') ? String(avatarId).slice(2) : '');
  const fileName = (avatarId, role) => 'avatar_' + numberOf(avatarId) + '_' + role + '.' + EXT;

  function setAvailable(list, v) {
    if (typeof v === 'string' && /^[A-Za-z0-9._-]{0,24}$/.test(v)) version = v;
    const next = {};
    if (list && typeof list === 'object') {
      for (const [id, roles] of Object.entries(list)) {
        if (!AVATAR_RE.test(id) || !Array.isArray(roles)) continue;
        const set = {};
        for (const r of roles) if (ROLES.includes(r)) set[r] = true;
        if (Object.keys(set).length) next[id] = set;
      }
    }
    available = next;
    return count();
  }
  const count = () => Object.values(available).reduce((n, set) => n + Object.keys(set).length, 0);
  // (saját kulcsokra szűrve: a "constructor", "__proto__" stb. nem lehet szerep)
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const has = (avatarId, role) => own(available, avatarId) && own(available[avatarId], role) && available[avatarId][role] === true;

  // A szerep-specifikus kép elérési útja, vagy null (ilyenkor tartalék: portré + jelmez).
  function spriteFor(avatarId, role) {
    if (!AVATAR_RE.test(avatarId || '') || !ROLES.includes(role)) return null;
    return has(avatarId, role) ? BASE + fileName(avatarId, role) + (version ? '?v=' + version : '') : null;
  }
  // Egy kép nem töltődött be (hálózati hiba / hiányzó fájl): a továbbiakban nem szerep-kép, a tartalék (az avatár portréja + jelvény) lép be.
  function markMissing(avatarId, role) {
    if (!has(avatarId, role)) return false;
    delete available[avatarId][role];
    if (!Object.keys(available[avatarId]).length) delete available[avatarId];
    return true;
  }
  // A kép kiválasztása MINDIG a választott avatár + a mostani szerep alapján: szerep-kép, ennek hiányában az eredeti avatár képe (soha nem törött kép).
  const portraitOf = (avatarId) => (AVATAR_RE.test(avatarId || '') ? '/assets/avatars/avatar_' + numberOf(avatarId) + '.webp' : '');
  function getRoleAvatar(avatarId, role) {
    const sprite = spriteFor(avatarId, role);
    if (sprite) return { kind: 'sprite', src: sprite };
    const portrait = portraitOf(avatarId);
    return portrait ? { kind: 'portrait', src: portrait } : { kind: 'generic', src: '' };
  }

  // ---------- elrendezés ----------
  // A szerep-képek 720 × 960 (3:4) vásznon készülnek (scripts/build-role-assets.js): az arc mindig ugyanakkora és ugyanott áll (az áll a magasság 42%-án),
  // alatta a derékig látszó törzs. A színpadi slot magassága = a jelenet szerepenkénti pos.h értéke × scale. A kép a bútor / pult MÖGÖTT áll
  // (a derék a bútor takarásában marad), a nyitott térben (vádlott) az alja puhán elhalványul.
  //   scale: nagyítás a jelenet-profil szerinti slot-magassághoz képest · x / y: eltolás a slot szélességének / magasságának %-ában
  //   (x > 0: jobbra, y > 0: lefelé) · z: a rétegsorrend finomhangolása (a jelenet z·10 értékéhez adódik) · depth: fényerő (1 = alap, a hátsó sor kicsit sötétebb)
  const ROLE_LAYOUT = {
    judge:      { scale: 1.75, x: 0, y: 27, z: 0, depth: 1 },
    prosecutor: { scale: 1.6, x: 0, y: 0, z: 0, depth: 1 },
    defendant:  { scale: 1.75, x: 0, y: 22, z: 0, depth: 1 },
    defender:   { scale: 1.8, x: 0, y: 0, z: 0, depth: 1 },
    witness:    { scale: 1.55, x: -6, y: 0, z: 0, depth: 1 },
    juror:      { scale: 1.25, x: 0, y: 12, z: -3, depth: 0.86 } // z: a hátsó sor a bíró és a tanú MÖGÖTT áll
  };
  // Keskeny asztali képernyőn (< 1180 px: 1024 × 768 tablet / kis laptop) a bal oldali szerep-füzet az ügyész arcába lógna: az ügyész jobbra, az esküdtek lejjebb állnak.
  const NARROW_LAYOUT = {
    prosecutor: { x: 46, y: 8 },
    defendant:  { scale: 1.5, y: 24 },   // a kisebb szélességű jelenetben a vádlott ne takarja a védő portréját
    juror:      { y: 26 }
  };
  // Telefonon a jelenet más (kisebb) slot-magasságokat ad; itt szerepenként finomítható (üresen az alap érvényes).
  const MOBILE_LAYOUT = {
    judge:      { scale: 1.5, y: 12 },
    prosecutor: { scale: 1.4, x: 9 },
    defendant:  { scale: 1.3, y: 8 },
    witness:    { scale: 1.35 },
    juror:      { scale: 1.05, y: 6 }
  };
  // Avatáronkénti finomhangolás: a szorzók az alapra szorzódnak (scale) / adódnak (x, y, z). Példa: a széles mutatókezű ügyész kicsit kisebb és balra tolva:
  //   av01: { prosecutor: { scale: 0.96, x: 2 } }
  const AVATAR_ROLE_ADJUSTMENTS = {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  // mode: 'desktop' | 'narrow' | 'mobile' (vagy logikai: true = mobile)
  function layoutFor(avatarId, role, mode) {
    if (mode === true) mode = 'mobile';
    const base = ROLE_LAYOUT[role] || ROLE_LAYOUT.juror;
    const table = mode === 'mobile' ? MOBILE_LAYOUT : mode === 'narrow' ? NARROW_LAYOUT : null;
    const mob = table && table[role] ? table[role] : null;
    const adj = own(AVATAR_ROLE_ADJUSTMENTS, avatarId) && own(AVATAR_ROLE_ADJUSTMENTS[avatarId], role) ? AVATAR_ROLE_ADJUSTMENTS[avatarId][role] : null;
    return {
      scale: num(mob && mob.scale, base.scale) * num(adj && adj.scale, 1),
      x: num(mob && mob.x, base.x) + num(adj && adj.x, 0),
      y: num(mob && mob.y, base.y) + num(adj && adj.y, 0),
      z: num(mob && mob.z, base.z) + num(adj && adj.z, 0),
      depth: num(mob && mob.depth, base.depth)
    };
  }

  // A hiányzó alapkészlet-képek listája (a feltöltés követéséhez): { have, total, missing: [fájlnevek], defender: <feltöltött védő-képek száma> }
  function coverage(avatarIds) {
    const ids = avatarIds || Array.from({ length: 50 }, (_, i) => 'av' + String(i + 1).padStart(2, '0'));
    const missing = [];
    let have = 0;
    for (const id of ids) for (const role of CORE_ROLES) { if (has(id, role)) have++; else missing.push(fileName(id, role)); }
    const defender = ids.filter((id) => has(id, 'defender')).length;
    return { have, total: ids.length * CORE_ROLES.length, missing, defender };
  }

  // ---------- asset-first fallback ----------
  // Ha egy szerep-specifikus raster asset még nincs feltöltve, NEM rajzolunk SVG/CSS karaktert.
  // Az eredeti avatar marad látható, és csak egy egyszerű HTML szerepjelvény kerül rá.
  const ROLE_LABEL = { judge: 'BÍRÓ', prosecutor: 'ÜGYÉSZ', defendant: 'VÁDLOTT', defender: 'VÉDŐ', witness: 'TANÚ', juror: 'ESKÜDT' };
  function costumeHtml(role) {
    const label = ROLE_LABEL[role];
    if (!label) return '';
    return '<span class="role-fallback-badge role-fallback-' + role + '" aria-hidden="true">' + label + '</span>';
  }

  return { ROLES, CORE_ROLES, AVATAR_RE, fileName, setAvailable, has, spriteFor, markMissing, getRoleAvatar, layoutFor, ROLE_LAYOUT, MOBILE_LAYOUT, NARROW_LAYOUT, AVATAR_ROLE_ADJUSTMENTS, coverage, costumeHtml, count, BASE };
});
