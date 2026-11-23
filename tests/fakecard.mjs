// Carte finte in scala di grigi per provare js/cardscan.js senza foto vere (solo per i test, non e' servito dall'app).
import { resizeGray } from '../js/cardscan.js';

export function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.gauss = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  return r;
}

// Buffer di disegno a 2x (poi ridotto per l'antialias).
function canvas(w, h, bg) { return { w, h, d: new Float32Array(w * h).fill(bg) }; }
function rect(c, x0, y0, x1, y1, v) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(c.h, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(c.w, Math.ceil(x1)); x++) c.d[y * c.w + x] = v;
}
function ring(c, cx, cy, r0, r1, v) {
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++)
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      if (x < 0 || y < 0 || x >= c.w || y >= c.h) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r0 && d <= r1) c.d[y * c.w + x] = v;
    }
}
function line(c, x0, y0, x1, y1, th, v) {
  const minx = Math.floor(Math.min(x0, x1) - th), maxx = Math.ceil(Math.max(x0, x1) + th);
  const miny = Math.floor(Math.min(y0, y1) - th), maxy = Math.ceil(Math.max(y0, y1) + th);
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
  for (let y = miny; y <= maxy; y++)
    for (let x = minx; x <= maxx; x++) {
      if (x < 0 || y < 0 || x >= c.w || y >= c.h) continue;
      let t = ((x - x0) * dx + (y - y0) * dy) / L2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= th / 2) c.d[y * c.w + x] = v;
    }
}

function iconRanged(c, x, y, s, v) { // mirino
  const cx = x + s / 2, cy = y + s / 2;
  ring(c, cx, cy, s * 0.36, s * 0.46, v);
  line(c, cx, y, cx, y + s * 0.3, s * 0.07, v); line(c, cx, y + s * 0.7, cx, y + s, s * 0.07, v);
  line(c, x, cy, x + s * 0.3, cy, s * 0.07, v); line(c, x + s * 0.7, cy, x + s, cy, s * 0.07, v);
  ring(c, cx, cy, 0, s * 0.07, v);
}
function iconMelee(c, x, y, s, v) { // spada
  line(c, x + s * 0.15, y + s * 0.85, x + s * 0.88, y + s * 0.12, s * 0.12, v);
  line(c, x + s * 0.28, y + s * 0.42, x + s * 0.58, y + s * 0.72, s * 0.09, v);
  ring(c, x + s * 0.1, y + s * 0.9, 0, s * 0.09, v);
}

function textBars(c, x, y, w, lineH, n, r, v) { // finto testo
  for (let i = 0; i < n; i++) {
    let cx = x; const cy = y + i * lineH * 1.6;
    while (cx < x + w - lineH * 3) {
      const wl = lineH * (1.2 + 3 * r());
      rect(c, cx, cy, Math.min(cx + wl, x + w), cy + lineH * 0.8, v);
      cx += wl + lineH * 0.7;
    }
  }
}

function rotate(g, deg, fill) {
  if (!deg) return g;
  const { width: w, height: h, data } = g, a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const out = new Uint8Array(w * h).fill(fill), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = ca * (x - cx) + sa * (y - cy) + cx, sy = -sa * (x - cx) + ca * (y - cy) + cy;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
    const fx = sx - x0, fy = sy - y0;
    out[y * w + x] = data[y0 * w + x0] * (1 - fx) * (1 - fy) + data[y0 * w + x0 + 1] * fx * (1 - fy) + data[(y0 + 1) * w + x0] * (1 - fx) * fy + data[(y0 + 1) * w + x0 + 1] * fx * fy;
  }
  return { data: out, width: w, height: h };
}

// kinds: tipi delle righe dall'alto. iconSize in px a larghezza W. Restituisce { gray, truth }.
export function makeCard({ seed = 1, W = 1000, H = 1400, kinds = ['ranged', 'melee', 'ranged'], iconSize = 46, pitch = 118, tableTop = 520, tilt = 0, noise = 6, decoys = true } = {}) {
  const r = rng(seed), K = 2, c = canvas(W * K, H * K, 214 + 6 * r());
  const ink = 28;
  // intestazione: titolo, statistiche e foto/arte finti
  rect(c, 40 * K, 40 * K, 960 * K, 120 * K, 60);
  textBars(c, 60 * K, 150 * K, 880 * K, 14 * K, 6, r, ink);
  rect(c, 40 * K, 330 * K, 960 * K, 470 * K, 150 + 30 * r());
  if (decoys) for (let i = 0; i < 14; i++) { const x = (60 + 60 * i) * K, y = (350 + 40 * r()) * K; ring(c, x, y, 7 * K, 12 * K, ink); line(c, x - 14 * K, y + 40 * K, x + 14 * K, y + 40 * K, 4 * K, ink); }
  const truth = [];
  kinds.forEach((kind, i) => {
    const top = tableTop + i * pitch;
    rect(c, 30 * K, top * K, 970 * K, (top + pitch - 6) * K, i % 2 ? 200 : 222);
    line(c, 30 * K, (top + pitch - 3) * K, 970 * K, (top + pitch - 3) * K, 3 * K, 90);
    const iy = top + (pitch - iconSize) / 2 - 4 + 3 * r(), ix = 50 + 3 * r();
    (kind === 'ranged' ? iconRanged : iconMelee)(c, ix * K, iy * K, iconSize * K, ink);
    textBars(c, 120 * K, (top + 18) * K, 300 * K, 13 * K, 2, r, ink);
    for (let s = 0; s < 3; s++) { // A, BS/WS, D: cifre finte, alcune con zeri "O" come falsi mirini
      const sx = (470 + s * 70) * K, sy = (top + 40) * K;
      if (decoys && r() < 0.6) ring(c, sx, sy, 6 * K, 11 * K, ink); else rect(c, sx - 8 * K, sy - 12 * K, sx + 8 * K, sy + 12 * K, ink);
    }
    textBars(c, 720 * K, (top + 14) * K, 235 * K, 11 * K, 3, r, ink);
    truth.push({ kind, y0: top, y1: top + pitch, iconY: iy, iconH: iconSize });
  });
  textBars(c, 60 * K, (tableTop + kinds.length * pitch + 30) * K, 880 * K, 12 * K, 4, r, ink); // regole sotto la tabella
  let g = resizeGray({ data: Uint8Array.from(c.d, (v) => Math.max(0, Math.min(255, v))), width: c.w, height: c.h }, W, H);
  if (tilt) g = rotate(g, tilt, 210);
  const d = g.data;
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(255, Math.round(d[i] + noise * r.gauss())));
  return { gray: g, truth, W, H };
}

// Icona "insegnata": ritaglio con margine approssimativo da una carta di riferimento, alla scala di lavoro.
export function teachIcon(card, rowIndex, scanW, jitter = 2) {
  const small = resizeGray(card.gray, scanW, Math.round(card.H * scanW / card.W));
  const k = scanW / card.W, t = card.truth[rowIndex];
  const x0 = Math.max(0, Math.round(50 * k - 3 + jitter)), y0 = Math.max(0, Math.round(t.iconY * k - 3 + jitter));
  const w = Math.round(t.iconH * k + 8), h = Math.round(t.iconH * k + 8);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = small.data[(y0 + y) * small.width + x0 + x];
  return { data, width: w, height: h };
}
