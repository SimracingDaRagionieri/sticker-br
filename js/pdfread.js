// Lettura di un PDF con pdf.js -> modello di pagina per js/pdfteam.js, piu' ritagli disegnati.
// Funziona in browser e in Node: pdf.js non e' importato qui, lo si passa dall'esterno (pdfjs = modulo gia' caricato).
//
// Modello di pagina: { num, width, height, rotate, items[], images[] }
//   items[]  = { str, x, y, w, h, font, bold }   x = bordo sinistro, y = LINEA DI BASE dall'alto (y verso il basso),
//              w = larghezza, h = altezza del carattere (punti PDF), font = nome PostScript del font, bold = bool
//   images[] = { x, y, w, h }   rettangoli delle immagini bitmap sulla pagina (x, y = angolo in alto a sinistra)
// Tutte le coordinate sono in punti PDF alla scala 1, origine in alto a sinistra.

const BOLD_RE = /(bold|black|heavy|semibold|demi|extrabold|ultra|-bd\b|,bd\b|\bbd$)/i;

export function isBoldName(name) {
  return BOLD_RE.test(String(name || ''));
}

// Moltiplicazione di matrici affini [a b c d e f] come in PDF: result = m1 x m2 (m1 applicata per prima).
function mul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

// Rettangoli delle immagini di una pagina (in coordinate della vista, origine in alto a sinistra).
function imageRects(opList, OPS, viewport) {
  const rects = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const paintOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter((x) => x != null));
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(opList.argsArray[i], ctm);
    else if (paintOps.has(fn)) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => viewport.convertToViewportPoint(
        ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      rects.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, mask: fn === OPS.paintImageMaskXObject });
    }
  }
  return rects;
}

// Nome PostScript del font di una voce di testo: serve a riconoscere il grassetto.
function fontInfo(page, loadedName, cache) {
  if (cache.has(loadedName)) return cache.get(loadedName);
  let info = { name: '', bold: false };
  try {
    if (page.commonObjs.has(loadedName)) {
      const f = page.commonObjs.get(loadedName);
      const name = String((f && (f.name || f.fallbackName)) || '');
      info = { name, bold: !!(f && (f.bold || f.black)) || isBoldName(name) };
    }
  } catch (_) { /* font non disponibile: resta senza nome */ }
  cache.set(loadedName, info);
  return info;
}

// Apre il PDF. fontExtraProperties serve per avere i nomi PostScript dei font (riconoscimento del grassetto).
// standardFontDataUrl/cMapUrl non sono forniti: i PDF Games Workshop incorporano i font, quindi non servono.
export async function openPdf(pdfjs, data) {
  // Copia in un Uint8Array "pulito" (pdf.js rifiuta i Buffer di Node).
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : Uint8Array.from(data);
  const task = pdfjs.getDocument({ data: bytes, fontExtraProperties: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  return task.promise;
}

// doc = oggetto restituito da openPdf()
export async function extractPages(pdfjs, doc, { onProgress } = {}) {
  const pages = [];
  const fonts = new Map();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    // Serve per popolare commonObjs (nomi dei font) e per trovare le immagini.
    const opList = await page.getOperatorList();
    const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
    const cache = fonts.get(n) || new Map();
    fonts.set(n, cache);
    const items = [];
    for (const it of content.items) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const t = it.transform;
      const [x, y] = viewport.convertToViewportPoint(t[4], t[5]);
      const fi = fontInfo(page, it.fontName, cache);
      const h = it.height || Math.hypot(t[2], t[3]);
      items.push({ str: it.str, x, y, w: it.width, h, font: fi.name, bold: fi.bold });
    }
    pages.push({
      num: n, width: viewport.width, height: viewport.height, rotate: page.rotate || 0,
      items, images: imageRects(opList, pdfjs.OPS, viewport).filter((r) => !r.mask && r.w > 8 && r.h > 8)
    });
    page.cleanup();
    if (onProgress) onProgress(n, doc.numPages);
  }
  let title = '';
  try { const meta = await doc.getMetadata(); title = String((meta.info && meta.info.Title) || '').trim(); } catch (_) { /* nessun titolo */ }
  return { pages, title };
}

// Disegna un rettangolo della pagina (punti PDF, origine in alto a sinistra) a `scale` pixel per punto.
// makeCanvas(w, h) -> canvas (nel browser document.createElement('canvas'); in Node @napi-rs/canvas se serve).
export async function renderRect(doc, pageNum, rect, { scale = 300 / 72, makeCanvas } = {}) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = Math.max(1, Math.round(rect.h * scale));
  const canvas = makeCanvas ? makeCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  await page.render({
    canvasContext: ctx, viewport,
    transform: [1, 0, 0, 1, -rect.x * scale, -rect.y * scale],
    background: 'rgb(255,255,255)'
  }).promise;
  page.cleanup();
  return canvas;
}
