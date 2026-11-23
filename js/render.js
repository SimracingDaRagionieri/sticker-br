// Motore sticker: disegna su canvas fuori dal DOM a pixel reali e restituisce un PNG trasparente.
// Nessuna dipendenza (ne' dal database ne' dal DOM visibile).
//
// renderSticker(data, config) -> Promise<Blob>
//   data   = { unitName, weaponName, actionName, factionName, unitImage, weaponImage, accentColor }
//            (unitImage/weaponImage: Blob oppure null; accentColor: '#rrggbb' oppure null)
//   config = config del template (vedi SPEC.md sezione 2). Campi mancanti = valori predefiniti.
//
// Significato dei campi principali:
//   width     larghezza di disegno in pixel; con una targa (plate.show) la targa occupa tutta la larghezza.
//   padding   margine trasparente lasciato attorno allo sticker (anche dopo il taglio); almeno quanto serve
//             a contorno e ombra del testo.
//   trim      se true taglia i bordi trasparenti, poi riaggiunge `padding`.
//   plate.padding  spazio tra targa e contenuto (facoltativo, predefinito 28).
//   plate.border   se assente (undefined/null) e i dati hanno accentColor, il bordo usa quel colore.
//   weaponImage.replaceText  se true e l'immagine arma e' mostrata, la riga di testo dell'arma non viene scritta.
//   lines[].weight peso del font (facoltativo, predefinito 400).

const TRUNC = '...';
const SHADOW = { color: 'rgba(0,0,0,0.65)', blur: 8, offsetY: 4 };
const SHADOW_REACH = SHADOW.blur + SHADOW.offsetY;
const MAX_HEIGHT = 8000;

// ---------- configurazione ----------

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const bool = (v, d) => (v === undefined || v === null ? d : !!v);

function normBorder(b) {
  if (!b || typeof b !== 'object') return null;
  const width = num(b.width, 0);
  return { width, color: b.color || '#ffffff' };
}

function normLine(l = {}) {
  const size = Math.max(8, num(l.size, 64));
  return {
    source: ['unit', 'weapon', 'action', 'faction', 'text'].includes(l.source) ? l.source : 'text',
    text: String(l.text ?? ''),
    font: String(l.font || 'Oswald'),
    weight: num(l.weight, 400),
    size,
    minSize: Math.min(size, Math.max(8, num(l.minSize, Math.round(size * 0.6)))),
    color: l.color || '#ffffff',
    stroke: l.stroke && num(l.stroke.width, 0) > 0 ? { width: num(l.stroke.width, 0), color: l.stroke.color || '#000000' } : null,
    shadow: bool(l.shadow, false),
    upper: bool(l.upper, false),
    align: ['left', 'center', 'right'].includes(l.align) ? l.align : 'left'
  };
}

export function normalizeConfig(c = {}) {
  const plate = c.plate || {};
  const image = c.image || {};
  const wi = c.weaponImage || {};
  return {
    width: Math.min(4320, Math.max(240, Math.round(num(c.width, 1080)))),
    padding: Math.max(0, num(c.padding, 24)),
    trim: bool(c.trim, true),
    plate: {
      show: bool(plate.show, true),
      color: plate.color || '#111111',
      opacity: Math.min(1, Math.max(0, num(plate.opacity, 0.85))),
      radius: Math.max(0, num(plate.radius, 16)),
      padding: Math.max(0, num(plate.padding, 28)),
      border: normBorder(plate.border)
    },
    image: {
      show: bool(image.show, false),
      side: ['left', 'right', 'top'].includes(image.side) ? image.side : 'left',
      height: Math.max(16, num(image.height, 220)),
      radius: Math.max(0, num(image.radius, 12)),
      border: normBorder(image.border)
    },
    weaponImage: {
      show: bool(wi.show, false),
      position: wi.position === 'right' ? 'right' : 'below',
      maxHeight: Math.max(16, num(wi.maxHeight, 200)),
      replaceText: bool(wi.replaceText, false),
      radius: Math.max(0, num(wi.radius, 12)),
      border: normBorder(wi.border)
    },
    lines: (Array.isArray(c.lines) ? c.lines : []).map(normLine)
  };
}

// ---------- font ----------

const q = (family) => `"${String(family).replace(/"/g, '')}"`;
const fontString = (line, size) => `${line.weight} ${size}px ${q(line.font)}, "Roboto Condensed", sans-serif`;

// Attende che i font usati dal template siano caricati prima di disegnare:
// senza questa attesa il PNG puo' uscire con il font di sistema (soprattutto al primo avvio).
async function ensureFonts(lines, texts) {
  if (!document.fonts || !document.fonts.load) return;
  const sample = (texts.join(' ') + ' Aa').slice(0, 200);
  const jobs = new Set();
  for (const l of lines) jobs.add(`${l.weight} ${l.size}px ${q(l.font)}`);
  await Promise.all([...jobs].map((f) => document.fonts.load(f, sample).catch(() => [])));
}

// ---------- utilita' di disegno ----------

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function toBitmap(blob) {
  if (!blob) return null;
  try { return await createImageBitmap(blob); } catch (err) { console.warn('Immagine non leggibile', err); return null; }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function drawImageBox(ctx, bmp, x, y, w, h, radius, border) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, x, y, w, h);
  ctx.restore();
  if (border && border.width > 0) {
    const bw = border.width;
    ctx.save();
    ctx.lineWidth = bw;
    ctx.strokeStyle = border.color;
    roundRectPath(ctx, x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, radius - bw / 2));
    ctx.stroke();
    ctx.restore();
  }
}

// Dimensioni di una immagine dentro limiti massimi, mantenendo le proporzioni.
function fitBox(bmp, maxW, maxH) {
  const ar = bmp.width / bmp.height;
  let h = maxH, w = h * ar;
  if (w > maxW) { w = maxW; h = w / ar; }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

// ---------- testo ----------

function lineValue(line, data) {
  let v;
  switch (line.source) {
    case 'unit': v = data.unitName; break;
    case 'weapon': v = data.weaponName; break;
    case 'action': v = data.actionName; break;
    case 'faction': v = data.factionName; break;
    default: v = line.text;
  }
  v = String(v ?? '').replace(/\s+/g, ' ').trim();
  return line.upper ? v.toUpperCase() : v;
}

// Sceglie dimensione e testo finale: riduce fino a minSize, poi tronca con "...".
function fitLine(ctx, line, text, availW) {
  const strokeW = line.stroke ? line.stroke.width : 0;
  const room = Math.max(10, availW - 2 * strokeW);
  let size = line.size;
  ctx.font = fontString(line, size);
  let w = ctx.measureText(text).width;
  if (w > room) {
    size = Math.max(line.minSize, Math.floor(size * (room / w)));
    ctx.font = fontString(line, size);
    w = ctx.measureText(text).width;
  }
  let out = text;
  while (w > room && out.length > 1) {
    out = out.slice(0, -1).trimEnd();
    w = ctx.measureText(out + TRUNC).width;
    if (w <= room) { out += TRUNC; break; }
  }
  if (out.length <= 1 && w > room) out = TRUNC; // spazio ridicolo: meglio qualcosa che niente
  if (out === text) w = ctx.measureText(out).width;
  // Altezza della riga e posizione della linea di base: il testo e' centrato sull'altezza delle maiuscole.
  const m = ctx.measureText('H');
  const cap = m.actualBoundingBoxAscent || size * 0.7;
  const lineH = Math.round(size * 1.1) + strokeW;
  return { line, text: out, size, width: w, lineH, base: Math.round((lineH + cap) / 2) };
}

function drawLine(ctx, fl, x, y, blockW) {
  const { line } = fl;
  ctx.font = fontString(line, fl.size);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  let tx = x;
  ctx.textAlign = 'left';
  if (line.align === 'center') tx = x + (blockW - fl.width) / 2;
  else if (line.align === 'right') tx = x + blockW - fl.width;
  const ty = y + fl.base;
  if (line.stroke) {
    ctx.save();
    if (line.shadow) {
      ctx.shadowColor = SHADOW.color; ctx.shadowBlur = SHADOW.blur; ctx.shadowOffsetY = SHADOW.offsetY;
    }
    ctx.lineWidth = line.stroke.width * 2; // il tratto e' centrato sul bordo: meta' resta sotto il riempimento
    ctx.strokeStyle = line.stroke.color;
    ctx.strokeText(fl.text, tx, ty);
    ctx.restore();
  }
  ctx.save();
  if (line.shadow && !line.stroke) {
    ctx.shadowColor = SHADOW.color; ctx.shadowBlur = SHADOW.blur; ctx.shadowOffsetY = SHADOW.offsetY;
  }
  ctx.fillStyle = line.color;
  ctx.fillText(fl.text, tx, ty);
  ctx.restore();
}

// ---------- taglio dei bordi trasparenti ----------

function trimCanvas(src, margin) {
  const { width: W, height: H } = src;
  const data = src.getContext('2d').getImageData(0, 0, W, H).data;
  const T = 4; // soglia alfa: ignora le code piu' tenui dell'ombra
  let top = H, bottom = -1, left = W, right = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (data[row + x * 4 + 3] > T) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return src; // tutto trasparente: niente da tagliare
  const x0 = Math.max(0, left - margin), y0 = Math.max(0, top - margin);
  const x1 = Math.min(W, right + 1 + margin), y1 = Math.min(H, bottom + 1 + margin);
  if (x0 === 0 && y0 === 0 && x1 === W && y1 === H) return src;
  const out = makeCanvas(x1 - x0, y1 - y0);
  out.getContext('2d').drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  return out;
}

// ---------- motore ----------

export async function renderSticker(data = {}, config = {}) {
  const cfg = normalizeConfig(config);
  const useUnitImg = cfg.image.show && data.unitImage;
  const useWeaponImg = cfg.weaponImage.show && data.weaponImage;
  // Con weaponImage.replaceText l'immagine del profilo arma prende il posto del nome arma scritto.
  const dropWeaponText = useWeaponImg && cfg.weaponImage.replaceText;
  const items = cfg.lines
    .filter((l) => !(dropWeaponText && l.source === 'weapon'))
    .map((l) => ({ l, v: lineValue(l, data) }))
    .filter((x) => x.v);

  await ensureFonts(items.map((x) => x.l), items.map((x) => x.v));

  const [unitBmp, weaponBmp] = await Promise.all([
    useUnitImg ? toBitmap(data.unitImage) : null,
    useWeaponImg ? toBitmap(data.weaponImage) : null
  ]);

  try {
    const W = cfg.width;
    const plate = cfg.plate;
    const border = plate.border || (data.accentColor ? { width: 4, color: data.accentColor } : null);

    // Margine esterno: almeno `padding`, e abbastanza per contorno e ombra del testo.
    let need = 0;
    for (const { l } of items) need = Math.max(need, (l.stroke ? l.stroke.width : 0) + (l.shadow ? SHADOW_REACH : 0));
    const outer = Math.ceil(Math.max(cfg.padding, need));

    // Con la targa: spazio tra targa e contenuto. Senza targa: lo spazio per contorno e ombra, che sporgono dal testo.
    const innerPad = plate.show ? plate.padding + (border ? border.width : 0) : need;
    const contentX = outer + innerPad;
    const contentW = Math.max(40, W - 2 * contentX);

    // --- misure ---
    const measure = makeCanvas(8, 8).getContext('2d');
    const GAP = 24;

    // immagine miniatura
    let uImg = null; // {w,h}
    const side = cfg.image.side;
    if (unitBmp) {
      uImg = side === 'top'
        ? fitBox(unitBmp, contentW, cfg.image.height)
        : fitBox(unitBmp, contentW * 0.42, cfg.image.height);
    }
    // immagine arma
    let wImg = null;
    const wPos = cfg.weaponImage.position;
    if (weaponBmp) {
      wImg = wPos === 'right'
        ? fitBox(weaponBmp, contentW * 0.35, cfg.weaponImage.maxHeight)
        : fitBox(weaponBmp, contentW, cfg.weaponImage.maxHeight);
    }

    // colonna del testo: spazio orizzontale disponibile
    let textW = contentW;
    if (uImg && side !== 'top') textW -= uImg.w + GAP;
    if (wImg && wPos === 'right') textW -= wImg.w + GAP;
    textW = Math.max(40, textW);

    const fitted = items.map(({ l, v }) => fitLine(measure, l, v, textW));
    const LINE_GAP = 6;
    let textH = fitted.reduce((s, f) => s + f.lineH, 0) + Math.max(0, fitted.length - 1) * LINE_GAP;
    const belowH = wImg && wPos === 'below' ? wImg.h + (fitted.length ? GAP / 2 : 0) : 0;
    const colH = textH + belowH; // altezza della colonna del testo (con eventuale immagine arma sotto)

    // altezza del contenuto
    let bodyH;
    if (uImg && side === 'top') bodyH = uImg.h + (colH ? GAP : 0) + colH;
    else bodyH = Math.max(colH, uImg ? uImg.h : 0, wImg && wPos === 'right' ? wImg.h : 0);

    if (!fitted.length && !uImg && !wImg) bodyH = 0;
    const H = Math.min(MAX_HEIGHT, Math.ceil(2 * outer + 2 * innerPad + bodyH));

    // --- disegno ---
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: cfg.trim }); // il taglio rilegge i pixel
    ctx.clearRect(0, 0, W, H);

    if (plate.show) {
      const px = outer, py = outer, pw = W - 2 * outer, ph = H - 2 * outer;
      ctx.save();
      ctx.globalAlpha = plate.opacity;
      ctx.fillStyle = plate.color;
      roundRectPath(ctx, px, py, pw, ph, plate.radius);
      ctx.fill();
      ctx.restore();
      if (border && border.width > 0) {
        ctx.save();
        ctx.lineWidth = border.width;
        ctx.strokeStyle = border.color;
        roundRectPath(ctx, px + border.width / 2, py + border.width / 2, pw - border.width, ph - border.width, Math.max(0, plate.radius - border.width / 2));
        ctx.stroke();
        ctx.restore();
      }
    }

    const top = outer + innerPad;
    let colX = contentX, colTop = top, colBodyH = bodyH;

    if (uImg && side === 'top') {
      drawImageBox(ctx, unitBmp, contentX + (contentW - uImg.w) / 2, top, uImg.w, uImg.h, cfg.image.radius, cfg.image.border);
      colTop = top + uImg.h + (colH ? GAP : 0);
      colBodyH = colH;
    } else if (uImg) {
      const iy = top + (bodyH - uImg.h) / 2;
      if (side === 'left') {
        drawImageBox(ctx, unitBmp, contentX, iy, uImg.w, uImg.h, cfg.image.radius, cfg.image.border);
        colX = contentX + uImg.w + GAP;
      } else {
        drawImageBox(ctx, unitBmp, contentX + contentW - uImg.w, iy, uImg.w, uImg.h, cfg.image.radius, cfg.image.border);
      }
    }

    // immagine arma a destra: all'estremita' destra dell'area di contenuto (a sinistra di quella della miniatura se a destra)
    if (wImg && wPos === 'right') {
      let wx = contentX + contentW - wImg.w;
      if (uImg && side === 'right') wx -= uImg.w + GAP;
      drawImageBox(ctx, weaponBmp, wx, top + (bodyH - wImg.h) / 2, wImg.w, wImg.h, cfg.weaponImage.radius, cfg.weaponImage.border);
    }

    // colonna di testo, centrata in verticale rispetto al corpo
    let y = colTop + Math.max(0, (colBodyH - colH) / 2);
    fitted.forEach((f, i) => {
      drawLine(ctx, f, colX, y, textW);
      y += f.lineH + (i < fitted.length - 1 ? LINE_GAP : 0);
    });

    if (wImg && wPos === 'below') {
      y += fitted.length ? GAP / 2 : 0;
      const al = cfg.lines[0] ? cfg.lines[0].align : 'left';
      const wx = al === 'center' ? colX + (textW - wImg.w) / 2 : al === 'right' ? colX + textW - wImg.w : colX;
      drawImageBox(ctx, weaponBmp, wx, y, wImg.w, wImg.h, cfg.weaponImage.radius, cfg.weaponImage.border);
    }

    const final = cfg.trim ? trimCanvas(canvas, outer) : canvas;
    return await new Promise((resolve, reject) => {
      final.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob fallito'))), 'image/png');
    });
  } finally {
    if (unitBmp && unitBmp.close) unitBmp.close();
    if (weaponBmp && weaponBmp.close) weaponBmp.close();
  }
}
