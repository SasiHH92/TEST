'use strict';

// ============================================================
// KAMU BÍRÓSÁG – avatár × szerep megfeleltetés
//
// Az avatár azonosítója (av01…av50) MINDIG ugyanaz marad; a szerepenként más kép csak a megjelenítést érinti:
//   assets/roles/avatar_17_judge.webp, avatar_17_prosecutor.webp, avatar_17_defendant.webp, avatar_17_witness.webp, avatar_17_juror.webp
//   (a teljes alapkészlet 50 × 5 kép; a védőügyvéd saját képe, avatar_17_defender.webp, opcionális)
// A szerver a /api/role-sprites címen megmondja, melyik kép van ténylegesen feltöltve (a mappa tartalma alapján), a kliens ezt egyszer
// letölti. Ahol az adott avatár × szerep képe még nincs meg, a rendszer TARTALÉKOT ad: a meglévő portré marad, és a szerepnek megfelelő
// "jelmez-sáv" (talár, piros öltöny, narancs rabruha, zöld mellény, lila esküdt-szalag) kerül rá. Új képet feltölteni elég a
// fájlt a mappába tenni (névkonvenció fent), kód nem kell hozzá. Lásd assets/roles/README.md.
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

  const numberOf = (avatarId) => (AVATAR_RE.test(avatarId || '') ? String(avatarId).slice(2) : '');
  const fileName = (avatarId, role) => 'avatar_' + numberOf(avatarId) + '_' + role + '.' + EXT;

  function setAvailable(list) {
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
    return has(avatarId, role) ? BASE + fileName(avatarId, role) : null;
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

  return { ROLES, CORE_ROLES, AVATAR_RE, fileName, setAvailable, has, spriteFor, coverage, costumeHtml, count, BASE };
});
