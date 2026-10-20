'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a játékos VALÓDI IP-címe (a címenkénti korlátokhoz: belépés-próbálkozás, szoba, kapcsolat, QR, moderáció)
//
// Az út élesben: játékos → Cloudflare (kamubirosag.com) → Render proxy → szerver. A Render proxy az X-Forwarded-For végére a hozzá
// kapcsolódó gép címét írja – ez a Cloudflare egyik szervere, NEM a játékos. Ezért korábban sok játékos ugyanazon a "címen" osztozott:
// a belépés-korlát, a szoba- / kapcsolat-korlát és az IP-alapú némítás ártatlanokat érinthetett, a valódi visszaélőt pedig nem fogta.
//
// A Cloudflare a játékos címét a CF-Connecting-IP fejlécben adja át. Ezt CSAK akkor fogadjuk el, ha a Render-hez kapcsolódó gép
// (az X-Forwarded-For utolsó eleme) a Cloudflare nyilvános címtartományába esik – különben (pl. ha valaki közvetlenül az onrender.com
// címet hívja) a fejléc hamisítható volna, és az utolsó elem (a valódi kapcsolódó gép) számít, mint eddig.
// A tartományok forrása: https://www.cloudflare.com/ips/ (ritkán változnak; ha mégis, itt kell frissíteni).
// ============================================================
const net = require('net');

const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20',
  '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

// IPv4: 32 bites szám; IPv6: 128 bites BigInt
const v4num = (ip) => ip.split('.').reduce((n, p) => n * 256 + (parseInt(p, 10) & 255), 0);
function v6big(ip) {
  let [head, tail] = ip.split('::');
  const part = (s) => (s ? s.split(':') : []);
  let h = part(head), t = part(tail);
  // beágyazott IPv4 a végén (pl. ::ffff:1.2.3.4)
  const last = (tail !== undefined ? t : h);
  if (last.length && last[last.length - 1].includes('.')) {
    const v4 = v4num(last.pop());
    last.push(((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16));
  }
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  const groups = [...h, ...fill, ...t];
  return groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
}
const RANGES = [
  ...CLOUDFLARE_V4.map((c) => { const [ip, bits] = c.split('/'); const b = Number(bits); return { v: 4, base: v4num(ip) >>> 0, mask: b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0 }; }),
  ...CLOUDFLARE_V6.map((c) => { const [ip, bits] = c.split('/'); const b = BigInt(bits); const mask = ((1n << 128n) - 1n) ^ ((1n << (128n - b)) - 1n); return { v: 6, base: v6big(ip) & mask, mask }; })
];

// a "::ffff:1.2.3.4" alakot sima IPv4-gyé alakítja; érvénytelen címre ''
function normalize(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) s = mapped[1];
  return net.isIP(s) ? s : '';
}
function isCloudflare(ip) {
  const s = normalize(ip); if (!s) return false;
  if (net.isIPv4(s)) { const n = v4num(s) >>> 0; return RANGES.some((r) => r.v === 4 && ((n & r.mask) >>> 0) === r.base); }
  const n = v6big(s); return RANGES.some((r) => r.v === 6 && (n & r.mask) === r.base);
}

// headers: a kérés fejlécei (kisbetűs kulcsok), remote: a közvetlen kapcsolat címe (helyben, proxy nélkül)
function fromHeaders(headers, remote) {
  const h = headers || {};
  const list = String(h['x-forwarded-for'] || '').split(',').map((x) => normalize(x)).filter(Boolean);
  const hop = list.length ? list[list.length - 1] : normalize(remote);
  if (hop && isCloudflare(hop)) { const cf = normalize(h['cf-connecting-ip']); if (cf) return cf; }
  return hop || normalize(remote) || String(remote || '');
}

// Express: a req.ip mindenhol a valódi címet adja (szerver, auth, csomagok…)
function middleware(req, res, next) {
  const ip = fromHeaders(req.headers, req.socket && req.socket.remoteAddress);
  try { Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true }); } catch (_) { /* marad az Express-féle */ }
  next();
}

module.exports = { fromHeaders, middleware, isCloudflare, normalize, CLOUDFLARE_V4, CLOUDFLARE_V6 };
