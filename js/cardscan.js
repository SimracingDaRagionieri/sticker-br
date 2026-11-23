// Rilevazione delle fasce arma su una carta operativo (Passo 5). Niente OCR.
//
// Parte pura (nessun DOM, testabile in Node): findWeaponRowsGray(card, templates, opts)
//   card      = { data: Uint8Array|Uint8ClampedArray, width, height }   scala di grigi, larghezza SCAN_W
//   templates = { ranged?: gray, melee?: gray }                          stesso formato, alla stessa scala
//   -> { rows: [{ y0, y1, x0, x1, kind, score, iconY, iconH }], detections }   coordinate in pixel di `card`
// Le icone arma (mirino/munizioni a distanza, spada in mischia) compaiono una volta per riga di profilo:
// si cercano per correlazione normalizzata a piu' scale; ogni icona trovata diventa una fascia a tutta
// larghezza che arriva fino alla riga successiva. Se la rilevazione e' incerta propone MENO fasce.
//
// Parte con DOM (solo helper, usati dalla schermata): canvasToGray, cropToTemplate, templateFromBlob,
// findWeaponRows(canvas, iconTemplates, opts) -> righe in pixel della carta originale.

export const SCAN_W = 480;                       // larghezza di lavoro della carta e delle icone
export const SCALES = [0.8, 0.9, 1, 1.1, 1.25];  // scale provate per ogni icona
export const DEFAULT_SENSITIVITY = 0.5;
const MIN_STD = 6;      // finestre quasi uniformi (sfondo) non sono mai un'icona
const STRIDE = 3;       // passo della scansione grossolana, in px a scala di lavoro
const MIN_TPL = 8;      // lato minimo di un'icona a scala di lavoro

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Sensibilita' 0..1 -> soglia di correlazione. 0 = prudente (0.80), 0.5 = 0.625, 1 = permissiva (0.45).
export const thresholdFor = (sens) => 0.8 - 0.35 * clamp01(sens);

// ---------- immagini in grigio ----------

// Ridimensiona con media d'area in riduzione e interpolazione bilineare in ingrandimento.
export function resizeGray(src, nw, nh) {
  nw = Math.max(1, Math.round(nw));
  nh = Math.max(1, Math.round(nh));
  const { data, width: w, height: h } = src;
  if (nw === w && nh === h) return { data: Uint8Array.from(data), width: w, height: h };
  const sx = w / nw, sy = h / nh;
  // passo orizzontale
  const tmp = new Float32Array(nw * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < nw; x++) {
      let v;
      if (sx > 1) {
        const a = x * sx, b = (x + 1) * sx;
        const i0 = Math.floor(a), i1 = Math.min(w, Math.ceil(b));
        let acc = 0, wt = 0;
        for (let i = i0; i < i1; i++) {
          const k = Math.min(i + 1, b) - Math.max(i, a);
          acc += data[y * w + i] * k; wt += k;
        }
        v = acc / wt;
      } else {
        const c = (x + 0.5) * sx - 0.5;
        const i0 = Math.max(0, Math.floor(c)), i1 = Math.min(w - 1, i0 + 1);
        const f = Math.min(1, Math.max(0, c - i0));
        v = data[y * w + i0] * (1 - f) + data[y * w + i1] * f;
      }
      tmp[y * nw + x] = v;
    }
  }
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let v;
      if (sy > 1) {
        const a = y * sy, b = (y + 1) * sy;
        const j0 = Math.floor(a), j1 = Math.min(h, Math.ceil(b));
        let acc = 0, wt = 0;
        for (let j = j0; j < j1; j++) {
          const k = Math.min(j + 1, b) - Math.max(j, a);
          acc += tmp[j * nw + x] * k; wt += k;
        }
        v = acc / wt;
      } else {
        const c = (y + 0.5) * sy - 0.5;
        const j0 = Math.max(0, Math.floor(c)), j1 = Math.min(h - 1, j0 + 1);
        const f = Math.min(1, Math.max(0, c - j0));
        v = tmp[j0 * nw + x] * (1 - f) + tmp[j1 * nw + x] * f;
      }
      out[y * nw + x] = Math.round(v);
    }
  }
  return { data: out, width: nw, height: nh };
}

// ---------- correlazione normalizzata ----------

function integrals(img) {
  const { data, width: w, height: h } = img;
  const W1 = w + 1;
  const s = new Float64Array(W1 * (h + 1));
  const q = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      rs += v; rq += v * v;
      s[(y + 1) * W1 + x + 1] = s[y * W1 + x + 1] + rs;
      q[(y + 1) * W1 + x + 1] = q[y * W1 + x + 1] + rq;
    }
  }
  return { s, q, W1 };
}

// Icona a media zero e norma 1 alla scala richiesta (null se quasi uniforme o troppo piccola).
function prepareTemplate(tpl, scale) {
  const tw = Math.round(tpl.width * scale), th = Math.round(tpl.height * scale);
  if (tw < MIN_TPL || th < MIN_TPL) return null;
  const r = scale === 1 ? tpl : resizeGray(tpl, tw, th);
  const n = r.width * r.height;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += r.data[i];
  mean /= n;
  const zm = new Float32Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) { const d = r.data[i] - mean; zm[i] = d; norm += d * d; }
  if (Math.sqrt(norm / n) < MIN_STD) return null;
  return { w: r.width, h: r.height, zm, norm: Math.sqrt(norm), n };
}

function nccAt(img, ii, t, x, y) {
  const { data, width: W } = img;
  const { s, q, W1 } = ii;
  const x1 = x + t.w, y1 = y + t.h;
  const sum = s[y1 * W1 + x1] - s[y * W1 + x1] - s[y1 * W1 + x] + s[y * W1 + x];
  const sq = q[y1 * W1 + x1] - q[y * W1 + x1] - q[y1 * W1 + x] + q[y * W1 + x];
  const varr = sq - (sum * sum) / t.n;
  if (varr < t.n * MIN_STD * MIN_STD) return 0;
  let num = 0;
  for (let j = 0; j < t.h; j++) {
    const base = (y + j) * W + x, tb = j * t.w;
    for (let i = 0; i < t.w; i++) num += t.zm[tb + i] * data[base + i];
  }
  return num / (Math.sqrt(varr) * t.norm);
}

// Tutte le posizioni con correlazione >= thr: passo grossolano (3 px), poi rifinitura 1 px attorno ai migliori.
function scanTemplate(img, ii, t, thr, kind, scale) {
  const { width: W, height: H } = img;
  if (t.w >= W || t.h >= H) return [];
  const coarse = [];
  const lo = thr * 0.85;
  for (let y = 0; y <= H - t.h; y += STRIDE) {
    for (let x = 0; x <= W - t.w; x += STRIDE) {
      const sc = nccAt(img, ii, t, x, y);
      if (sc >= lo) coarse.push({ x, y, score: sc });
    }
  }
  coarse.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of coarse.slice(0, 120)) {
    let best = c;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (x < 0 || y < 0 || x > W - t.w || y > H - t.h) continue;
        const sc = nccAt(img, ii, t, x, y);
        if (sc > best.score) best = { x, y, score: sc };
      }
    }
    if (best.score >= thr) out.push({ x: best.x, y: best.y, w: t.w, h: t.h, score: best.score, kind, scale });
  }
  return out;
}

const median = (arr) => {
  const a = [...arr].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// ---------- rilevazione ----------

export function findWeaponRowsGray(card, templates, { sensitivity = DEFAULT_SENSITIVITY, scales = SCALES } = {}) {
  const thr = thresholdFor(sensitivity);
  const ii = integrals(card);
  const hits = [];
  for (const kind of ['ranged', 'melee']) {
    const tpl = templates && templates[kind];
    if (!tpl) continue;
    for (const sc of scales) {
      const t = prepareTemplate(tpl, sc);
      if (t) hits.push(...scanTemplate(card, ii, t, thr, kind, sc));
    }
  }

  // Soppressione dei doppioni: due rilevazioni che si sovrappongono in verticale sono la stessa riga.
  hits.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const h of hits) {
    const dup = kept.some((k) => {
      const ov = Math.min(h.y + h.h, k.y + k.h) - Math.max(h.y, k.y);
      return ov > 0.4 * Math.min(h.h, k.h);
    });
    if (!dup) kept.push(h);
  }

  // Le icone stanno in una colonna: scarta quelle lontane dalla colonna della maggioranza.
  let det = kept;
  if (kept.length >= 3) {
    const mx = median(kept.map((k) => k.x + k.w / 2));
    const tol = Math.max(0.06 * card.width, 1.5 * median(kept.map((k) => k.w)));
    det = kept.filter((k) => Math.abs(k.x + k.w / 2 - mx) <= tol);
  } else if (kept.length === 2) {
    const tol = Math.max(0.06 * card.width, 1.5 * Math.max(kept[0].w, kept[1].w));
    if (Math.abs(kept[0].x + kept[0].w / 2 - (kept[1].x + kept[1].w / 2)) > tol) det = [kept[0]]; // meglio una sola
  }
  det.sort((a, b) => a.y - b.y);

  const rows = [];
  if (det.length) {
    const tops = det.map((d) => Math.max(0, d.y - 0.4 * d.h));
    const pitches = [];
    for (let i = 0; i + 1 < tops.length; i++) pitches.push(tops[i + 1] - tops[i]);
    const lastPitch = pitches.length ? median(pitches) : 3 * det[0].h;
    det.forEach((d, i) => {
      const y0 = tops[i];
      const y1 = i + 1 < det.length ? tops[i + 1] : Math.min(card.height, y0 + lastPitch);
      rows.push({ y0, y1, x0: 0, x1: card.width, kind: d.kind, score: d.score, iconY: d.y, iconH: d.h });
    });
  }
  return { rows, detections: det };
}

// ---------- helper con DOM (usati solo da chi li chiama) ----------

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function imageDataToGray(id) {
  const n = id.width * id.height;
  const out = new Uint8Array(n);
  const d = id.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
  return { data: out, width: id.width, height: id.height };
}

// Canvas/bitmap -> grigio alla larghezza richiesta (sfondo trasparente trattato come bianco).
export function canvasToGray(source, width = SCAN_W) {
  const w = Math.round(width), h = Math.max(1, Math.round(source.height * (w / source.width)));
  const c = makeCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return imageDataToGray(g.getImageData(0, 0, w, h));
}

function grayToPngBlob(gray) {
  const c = makeCanvas(gray.width, gray.height);
  const g = c.getContext('2d');
  const id = g.createImageData(gray.width, gray.height);
  for (let i = 0, p = 0; i < gray.data.length; i++, p += 4) {
    id.data[p] = id.data[p + 1] = id.data[p + 2] = gray.data[i];
    id.data[p + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c.convertToBlob ? c.convertToBlob({ type: 'image/png' })
    : new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob fallito'))), 'image/png'));
}

// Ritaglia il riquadro box = { x, y, w, h } (pixel della carta) e lo porta alla scala di lavoro:
// PNG in grigio pronto per settings.iconTemplates. Lancia un errore se il riquadro e' troppo piccolo.
export async function cropToTemplate(source, box) {
  const k = SCAN_W / source.width;
  const tw = Math.round(box.w * k), th = Math.round(box.h * k);
  if (tw < MIN_TPL || th < MIN_TPL) throw new Error('riquadro troppo piccolo: ingrandisci la carta e ripeti');
  const c = makeCanvas(tw, th);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, tw, th);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, tw, th);
  const gray = imageDataToGray(g.getImageData(0, 0, tw, th));
  if (!prepareTemplate(gray, 1)) throw new Error('il riquadro e\' quasi uniforme: includi bene l\'icona');
  return grayToPngBlob(gray);
}

export async function templateFromBlob(blob) {
  const bmp = await createImageBitmap(blob);
  try {
    const c = makeCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return imageDataToGray(g.getImageData(0, 0, bmp.width, bmp.height));
  } finally { bmp.close(); }
}

// Interfaccia della specifica: bitmap/canvas della carta + icone salvate ({ ranged?: Blob, melee?: Blob })
// -> fasce { y0, y1, x0, x1, kind, score } in pixel della carta ORIGINALE, ordinate dall'alto.
// `cache` (facoltativo, oggetto) conserva grigio della carta e icone decodificate tra una chiamata e l'altra.
export async function findWeaponRows(source, iconTemplates, { sensitivity = DEFAULT_SENSITIVITY, cache = {} } = {}) {
  if (!cache.card) cache.card = canvasToGray(source, SCAN_W);
  if (!cache.tpl) {
    cache.tpl = {};
    for (const kind of ['ranged', 'melee']) {
      if (iconTemplates && iconTemplates[kind]) cache.tpl[kind] = await templateFromBlob(iconTemplates[kind]);
    }
  }
  const { rows } = findWeaponRowsGray(cache.card, cache.tpl, { sensitivity });
  const k = source.width / cache.card.width;
  return rows.map((r) => ({ y0: r.y0 * k, y1: r.y1 * k, x0: 0, x1: source.width, kind: r.kind, score: r.score }));
}
