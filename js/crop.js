// Selezione immagine e ritaglio a tutto schermo.
// pickImage()  -> Promise<File|null>   apre il selettore file di Android (galleria, foto, file)
// cropImage(b) -> Promise<{ blob, width, height, thumb }|null>   null se l'utente annulla
//
// Gesti: un dito su un angolo ridimensiona, dentro il rettangolo lo sposta, fuori sposta l'immagine;
// due dita zoomano e spostano l'immagine. Il tasto indietro di Android chiude senza salvare.

import { toast } from './app.js';

const MAX_SIDE = 1600;   // lato lungo massimo dell'uscita (ridimensiona solo se piu' grande)
const THUMB_SIDE = 96;   // miniatura per gli elenchi (48 px a 2x)
const HIT = 24;          // mezza area di tocco delle maniglie: 48 px
const MIN_CROP = 64;     // lato minimo del ritaglio sullo schermo, in px
const ACCENT = '#e8b04a';

export function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    let done = false;
    const finish = (file) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

export async function cropImage(source) {
  let bitmap;
  try {
    // 'from-image' applica l'orientamento EXIF, cosi' le foto verticali escono dritte.
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch (err) {
    console.error(err);
    throw new Error('immagine non leggibile (formato non supportato?)');
  }
  return runCropper(bitmap);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob fallito'))), 'image/png');
  });
}

function runCropper(bitmap) {
  return new Promise((resolve) => {
    const W = bitmap.width;
    const H = bitmap.height;

    const root = document.createElement('div');
    root.className = 'crop';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Ritaglia immagine');
    root.innerHTML = `
      <div class="crop-bar">
        <button type="button" data-cancel>Annulla</button>
        <span class="crop-title">Ritaglia</span>
        <button type="button" class="primary" data-save>Salva</button>
      </div>
      <div class="crop-stage"><canvas></canvas></div>
      <div class="crop-foot"><span class="crop-info"></span></div>`;
    document.body.appendChild(root);

    const stage = root.querySelector('.crop-stage');
    const canvas = root.querySelector('canvas');
    const info = root.querySelector('.crop-info');
    const btnCancel = root.querySelector('[data-cancel]');
    const btnSave = root.querySelector('[data-save]');
    const g = canvas.getContext('2d');

    // Vista: schermo = immagine * s + (tx, ty). Il ritaglio e' in pixel dell'immagine.
    let vw = 0, vh = 0, dpr = 1;
    let s = 1, tx = 0, ty = 0, fitS = 1;
    const rect = { x0: W * 0.05, y0: H * 0.05, x1: W * 0.95, y1: H * 0.95 };

    let busy = false;
    let closed = false;
    let popped = false;
    let queued = false;

    // ----- vista -----
    function fit() {
      const pad = 16;
      fitS = Math.min((vw - pad * 2) / W, (vh - pad * 2) / H);
      if (!(fitS > 0)) fitS = 1;
      s = fitS;
      tx = (vw - W * s) / 2;
      ty = (vh - H * s) / 2;
    }

    function clampView() {
      s = clamp(s, fitS * 0.5, fitS * 8);
      const m = 80; // almeno 80 px di immagine restano visibili
      tx = clamp(tx, m - W * s, vw - m);
      ty = clamp(ty, m - H * s, vh - m);
    }

    function resize() {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      vw = w;
      vh = h;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      fit();
      schedule();
    }

    const toScreen = () => ({
      x: tx + rect.x0 * s, y: ty + rect.y0 * s,
      w: (rect.x1 - rect.x0) * s, h: (rect.y1 - rect.y0) * s
    });

    const corners = () => {
      const r = toScreen();
      return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
    };

    // ----- disegno -----
    function schedule() {
      if (queued || closed) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (!closed) draw(); });
    }

    function draw() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0b0b0b';
      g.fillRect(0, 0, vw, vh);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(bitmap, tx, ty, W * s, H * s);

      const r = toScreen();
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.beginPath();
      g.rect(0, 0, vw, vh);
      g.rect(r.x, r.y, r.w, r.h);
      g.fill('evenodd');

      g.lineWidth = 1;
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.beginPath();
      for (let i = 1; i <= 2; i++) {
        g.moveTo(r.x + (r.w * i) / 3, r.y); g.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
        g.moveTo(r.x, r.y + (r.h * i) / 3); g.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
      }
      g.stroke();

      g.lineWidth = 2;
      g.strokeStyle = ACCENT;
      g.strokeRect(r.x, r.y, r.w, r.h);

      for (const c of corners()) {
        g.beginPath();
        g.arc(c.x, c.y, 11, 0, Math.PI * 2);
        g.fillStyle = ACCENT;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#111';
        g.stroke();
      }

      const sw = Math.round(rect.x1) - Math.round(rect.x0);
      const sh = Math.round(rect.y1) - Math.round(rect.y0);
      const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
      info.textContent = `${Math.max(1, Math.round(sw * k))} × ${Math.max(1, Math.round(sh * k))} px · angoli per ritagliare, due dita per zoom`;
    }

    // ----- gesti -----
    const ptrs = new Map();
    let mode = null;

    const local = (e) => {
      const b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };

    function startSingle(p) {
      const cs = corners();
      let best = -1, bestD = Infinity;
      cs.forEach((c, i) => {
        const dx = Math.abs(p.x - c.x), dy = Math.abs(p.y - c.y);
        if (dx <= HIT && dy <= HIT && dx + dy < bestD) { best = i; bestD = dx + dy; }
      });
      if (best >= 0) {
        mode = { type: 'handle', i: best, offX: p.x - cs[best].x, offY: p.y - cs[best].y };
        return;
      }
      const r = toScreen();
      const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      mode = { type: inside ? 'move' : 'pan', lx: p.x, ly: p.y };
    }

    function pinchPoints() {
      const [a, b] = [...ptrs.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }

    function startPinch() {
      const { d, mx, my } = pinchPoints();
      mode = { type: 'pinch', d0: d, s0: s, px: (mx - tx) / s, py: (my - ty) / s };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (busy) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
      ptrs.set(e.pointerId, local(e));
      if (ptrs.size === 1) startSingle(ptrs.get(e.pointerId));
      else if (ptrs.size === 2) startPinch();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !mode || busy) return;
      e.preventDefault();
      const p = local(e);
      ptrs.set(e.pointerId, p);

      if (mode.type === 'pinch') {
        if (ptrs.size < 2) return;
        const { d, mx, my } = pinchPoints();
        s = clamp(mode.s0 * (d / mode.d0), fitS * 0.5, fitS * 8);
        tx = mx - mode.px * s;
        ty = my - mode.py * s;
        clampView();
      } else if (mode.type === 'pan') {
        tx += p.x - mode.lx;
        ty += p.y - mode.ly;
        mode.lx = p.x; mode.ly = p.y;
        clampView();
      } else if (mode.type === 'move') {
        const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
        const nx = clamp(rect.x0 + (p.x - mode.lx) / s, 0, W - w);
        const ny = clamp(rect.y0 + (p.y - mode.ly) / s, 0, H - h);
        rect.x0 = nx; rect.x1 = nx + w; rect.y0 = ny; rect.y1 = ny + h;
        mode.lx = p.x; mode.ly = p.y;
      } else if (mode.type === 'handle') {
        const ix = (p.x - mode.offX - tx) / s;
        const iy = (p.y - mode.offY - ty) / s;
        const minW = Math.min(MIN_CROP / s, W), minH = Math.min(MIN_CROP / s, H);
        if (mode.i === 0 || mode.i === 3) rect.x0 = clamp(ix, 0, rect.x1 - minW);
        else rect.x1 = clamp(ix, rect.x0 + minW, W);
        if (mode.i === 0 || mode.i === 1) rect.y0 = clamp(iy, 0, rect.y1 - minH);
        else rect.y1 = clamp(iy, rect.y0 + minH, H);
      }
      schedule();
    });

    function endPointer(e) {
      if (!ptrs.delete(e.pointerId)) return;
      if (ptrs.size === 0) mode = null;
      else if (ptrs.size === 1) {
        // Dopo lo zoom il dito rimasto sposta l'immagine (mai un angolo per sbaglio).
        const p = [...ptrs.values()][0];
        mode = { type: 'pan', lx: p.x, ly: p.y };
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    // Zoom con la rotella (utile solo per provare da computer).
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      const ns = clamp(s * Math.exp(-e.deltaY * 0.0015), fitS * 0.5, fitS * 8);
      tx = p.x - ((p.x - tx) / s) * ns;
      ty = p.y - ((p.y - ty) / s) * ns;
      s = ns;
      clampView();
      schedule();
    }, { passive: false });

    // ----- uscita -----
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    function close(result) {
      if (closed) return;
      closed = true;
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      ro.disconnect();
      root.remove();
      try { bitmap.close(); } catch (_) { /* gia' chiusa */ }
      if (!popped) history.back(); // toglie lo stato aggiunto all'apertura (non cambia l'hash)
      resolve(result);
    }

    // Tasto indietro di Android: chiude senza salvare.
    function onPop() { popped = true; close(null); }
    function onKey(e) { if (e.key === 'Escape') btnCancel.click(); }
    history.pushState({ crop: true }, '');
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);

    btnCancel.addEventListener('click', () => { if (!busy) close(null); });

    btnSave.addEventListener('click', async () => {
      if (busy || closed) return;
      busy = true;
      btnSave.disabled = true;
      btnSave.textContent = 'Salvo…';
      try {
        const out = await exportCrop();
        if (closed) return; // l'utente e' uscito con il tasto indietro nel frattempo
        close(out);
      } catch (err) {
        if (closed) return;
        console.error(err);
        toast('Ritaglio non riuscito: ' + err.message);
        busy = false;
        btnSave.disabled = false;
        btnSave.textContent = 'Salva';
      }
    });

    // PNG a pixel reali; ridimensiona solo se il lato lungo supera MAX_SIDE.
    async function exportCrop() {
      const sx = Math.round(rect.x0), sy = Math.round(rect.y0);
      const sw = Math.max(1, Math.round(rect.x1) - sx);
      const sh = Math.max(1, Math.round(rect.y1) - sy);
      const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * k));
      const h = Math.max(1, Math.round(sh * k));

      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const c = out.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
      const blob = await canvasToPng(out);

      const tk = Math.min(1, THUMB_SIDE / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * tk));
      const th = Math.max(1, Math.round(h * tk));
      const tc = document.createElement('canvas');
      tc.width = tw;
      tc.height = th;
      const t = tc.getContext('2d');
      t.imageSmoothingEnabled = true;
      t.imageSmoothingQuality = 'high';
      t.drawImage(out, 0, 0, tw, th);
      const thumb = await canvasToPng(tc);

      return { blob, width: w, height: h, thumb };
    }

    resize();
  });
}
