// Importa carta (Passo 5): foto/screenshot di una carta operativo -> fasce arma -> profili arma salvati.
// Route: #/carta?g=<gioco>&f=<fazione>[&u=<miniatura>]. La carta vive solo in memoria (nessuna tabella cards).
//
// Flusso: [insegna le icone, una sola volta per gioco] -> fasce proposte (correggibili a mano) -> conferma
// (un campo "Arma" per fascia) -> salvataggio -> facoltativo: ritaglio della miniatura dalla stessa carta.

import * as D from '../db.js';
import { toast, parseHash } from '../app.js';
import { esc, openSheet, closeSheet, menuSheet, confirmSheet } from '../ui.js';
import { pickImage, cropImage } from '../crop.js';
import { canvasToGray, cropToTemplate, templateFromBlob, findWeaponRowsGray, SCAN_W, DEFAULT_SENSITIVITY } from '../cardscan.js';

const MAX_CARD = 2400;   // lato lungo massimo della carta in memoria
const MAX_BAND = 1200;   // lato lungo massimo del PNG di una fascia
const THUMB_SIDE = 96;
const HIT = 24;          // mezza area di tocco: 48 px
const MIN_BAND = 12;     // altezza minima di una fascia, in px della carta
const ACCENT = '#e8b04a';
const KIND_COLOR = { ranged: '#ff9800', melee: '#42a5f5', other: '#cfd8dc' };
const KIND_LABEL = { ranged: 'A distanza', melee: 'Mischia', other: 'Altro' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const lc = (s) => String(s || '').toLowerCase();

let pending = null;   // { canvas, gameId, factionId, unitId }
let observer = null;

export function cleanup() {
  if (observer) { observer.disconnect(); observer = null; }
  pending = null;
}

// ---------- ingresso (chiamato da Libreria, dentro il tocco dell'utente) ----------

export async function startCardImport({ gameId, factionId, unitId = null }) {
  const file = await pickImage(); // niente await prima: il selettore va aperto subito
  if (!file) return;
  try {
    toast('Preparo la carta…');
    const canvas = await loadCard(file);
    cleanup();
    pending = { canvas, gameId, factionId, unitId };
    location.hash = `#/carta?g=${gameId}&f=${factionId}${unitId != null ? '&u=' + unitId : ''}`;
  } catch (err) {
    console.error(err);
    toast('Carta non leggibile: ' + err.message);
  }
}

// Decodifica con orientamento EXIF e riduce a MAX_CARD sul lato lungo.
async function loadCard(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { throw new Error('formato non supportato'); }
  const k = Math.min(1, MAX_CARD / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

const toBlob = (canvas, type = 'image/png', q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob fallito'))), type, q));

// ---------- schermata ----------

export async function render(el) {
  const q = parseHash().query;
  const ids = { g: Number(q.get('g')), f: Number(q.get('f')), u: q.has('u') ? Number(q.get('u')) : null };
  if (!pending || pending.gameId !== ids.g || pending.factionId !== ids.f || pending.unitId !== ids.u) {
    location.replace('#/libreria'); // ricaricata la pagina: la carta in memoria non c'e' piu'
    return;
  }
  const my = pending;
  let game, faction, unit = null;
  try {
    await D.ready();
    [game, faction] = await Promise.all([D.getGame(ids.g), D.getFaction(ids.f)]);
    if (ids.u != null) unit = await D.getUnit(ids.u);
  } catch (err) { console.error(err); }
  if (pending !== my) return;
  if (!game || !faction || (ids.u != null && !unit)) { location.replace('#/libreria'); return; }
  const tplBlobs = await D.getIconTemplates(game.id);
  if (pending !== my) return;
  run(el, { card: my.canvas, game, faction, unit, tplBlobs });
}

function run(el, { card, game, faction, unit, tplBlobs }) {
  const W = card.width, H = card.height;
  const L = game.labels;

  el.innerHTML = `
    <div class="carta" role="dialog" aria-label="Importa carta">
      <div class="carta-bar">
        <button type="button" class="back" data-back aria-label="Indietro">‹</button>
        <span class="carta-title">Importa carta</span>
        <button type="button" class="kebab" data-menu aria-label="Altre azioni">⋮</button>
      </div>
      <div class="carta-hint" data-hint></div>
      <div class="carta-stage"><canvas></canvas></div>
      <div class="carta-foot" data-foot></div>
    </div>`;
  const root = el.querySelector('.carta');
  const stage = root.querySelector('.carta-stage');
  const canvas = stage.querySelector('canvas');
  const hint = root.querySelector('[data-hint]');
  const foot = root.querySelector('[data-foot]');
  const g = canvas.getContext('2d');

  const st = {
    mode: (tplBlobs.ranged || tplBlobs.melee) ? 'bands' : 'teach',
    step: 'ranged',            // passo dell'insegnamento: ranged poi melee
    box: null,                 // riquadro dell'icona (px della carta) { x0, y0, x1, y1 }
    taught: {},
    bands: [],                 // { id, y0, y1, x0, x1, kind, src: 'auto'|'manual', edited }
    sel: -1,
    sens: DEFAULT_SENSITIVITY,
    busy: false,
    nextId: 1,
    draft: null
  };
  const cache = { card: null, tpl: null };
  let tpls = { ...tplBlobs };

  // ----- vista: schermo = carta * s + (tx, ty) -----
  let vw = 0, vh = 0, dpr = 1, s = 1, tx = 0, ty = 0, fitS = 1, queued = false;
  function fit() {
    const pad = 8;
    fitS = Math.min((vw - pad * 2) / W, (vh - pad * 2) / H);
    if (!(fitS > 0)) fitS = 1;
    s = fitS; tx = (vw - W * s) / 2; ty = (vh - H * s) / 2;
  }
  function clampView() {
    s = clamp(s, fitS * 0.5, fitS * 10);
    tx = clamp(tx, 80 - W * s, vw - 80);
    ty = clamp(ty, 80 - H * s, vh - 80);
  }
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    vw = w; vh = h; dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    fit(); schedule();
  }
  observer = new ResizeObserver(resize);
  observer.observe(stage);

  const sx = (x) => tx + x * s, sy = (y) => ty + y * s;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };

  // ----- disegno -----
  function draw() {
    if (!root.isConnected) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0b0b';
    g.fillRect(0, 0, vw, vh);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(card, tx, ty, W * s, H * s);

    if (st.mode === 'bands') {
      st.bands.forEach((b, i) => {
        const col = KIND_COLOR[b.kind] || KIND_COLOR.other;
        const x = sx(b.x0), y = sy(b.y0), w = (b.x1 - b.x0) * s, h = (b.y1 - b.y0) * s;
        const on = i === st.sel;
        g.fillStyle = col + (on ? '44' : '2e');
        g.fillRect(x, y, w, h);
        g.lineWidth = on ? 3 : 2;
        g.strokeStyle = on ? '#fff' : col;
        g.strokeRect(x, y, w, h);
        // numero
        g.fillStyle = col;
        g.beginPath(); g.arc(x + 16, y + 16, 13, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111'; g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i + 1), x + 16, y + 16);
        if (on) { // maniglie ai bordi
          g.fillStyle = ACCENT; g.strokeStyle = '#111'; g.lineWidth = 2;
          for (const [hx, hy, hw, hh] of [[x + w / 2 - 22, y - 5, 44, 10], [x + w / 2 - 22, y + h - 5, 44, 10], [x - 5, y + h / 2 - 22, 10, 44], [x + w - 5, y + h / 2 - 22, 10, 44]]) {
            g.beginPath(); g.roundRect(hx, hy, hw, hh, 5); g.fill(); g.stroke();
          }
        }
      });
    } else if (st.box) {
      const b = st.box, x = sx(b.x0), y = sy(b.y0), w = (b.x1 - b.x0) * s, h = (b.y1 - b.y0) * s;
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.beginPath(); g.rect(0, 0, vw, vh); g.rect(x, y, w, h); g.fill('evenodd');
      g.lineWidth = 2; g.strokeStyle = KIND_COLOR[st.step]; g.strokeRect(x, y, w, h);
      for (const [cx, cy] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) {
        g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2); g.fillStyle = ACCENT; g.fill(); g.lineWidth = 2; g.strokeStyle = '#111'; g.stroke();
      }
    }
  }

  // ----- testi e comandi in basso -----
  function setHint(t) { hint.textContent = t; }

  function renderFoot() {
    if (st.mode === 'teach') {
      const ranged = st.step === 'ranged';
      setHint(`${ranged ? '1/2' : '2/2'} · Insegna le icone (una volta sola per ${game.name}). Ingrandisci con due dita e trascina un riquadro attorno all'icona ${ranged ? 'ARMA A DISTANZA (mirino/munizioni)' : 'ARMA DA MISCHIA (spada)'} di una riga.`);
      foot.innerHTML = `<div class="carta-btns">
        <button type="button" data-skip>${ranged ? 'Non c\'è' : 'Salta'}</button>
        <button type="button" class="primary" data-ok ${st.box ? '' : 'disabled'}>Fatto</button></div>`;
      foot.querySelector('[data-skip]').onclick = () => nextTeach(false);
      foot.querySelector('[data-ok]').onclick = () => nextTeach(true);
      return;
    }
    const n = st.bands.length;
    setHint(n
      ? 'Controlla le fasce: trascina i bordi per ridimensionare, dentro per spostare, due dita per zoom. Fuori dalle fasce un dito sposta la carta.'
      : 'Nessuna fascia. Usa "Rileva armi" oppure "+ Fascia" per aggiungerne a mano (utile se la foto è storta).');
    foot.innerHTML = `
      <div class="carta-sens"><label for="sens">Sensibilità</label>
        <input id="sens" type="range" min="0" max="100" value="${Math.round(st.sens * 100)}" aria-label="Sensibilità del rilevamento">
        <output>${Math.round(st.sens * 100)}%</output></div>
      <div class="carta-btns">
        <button type="button" data-detect>Rileva armi</button>
        <button type="button" data-add>+ Fascia</button>
        <button type="button" class="danger" data-del ${st.sel >= 0 ? '' : 'disabled'}>Elimina</button></div>
      <div class="carta-btns"><button type="button" class="primary" data-next ${n ? '' : 'disabled'}>Avanti: assegna ${esc(lc(L.weapon))} (${n})</button></div>`;
    const sens = foot.querySelector('#sens'), out = foot.querySelector('output');
    sens.addEventListener('input', () => { st.sens = Number(sens.value) / 100; out.textContent = `${sens.value}%`; });
    sens.addEventListener('change', () => detect());
    foot.querySelector('[data-detect]').onclick = () => detect();
    foot.querySelector('[data-add]').onclick = addBand;
    foot.querySelector('[data-del]').onclick = delBand;
    foot.querySelector('[data-next]').onclick = () => openConfirm();
  }

  // ----- insegnamento delle icone -----
  async function nextTeach(taken) {
    if (st.busy) return;
    if (taken) {
      if (!st.box) return;
      try {
        st.busy = true;
        const b = st.box;
        st.taught[st.step] = await cropToTemplate(card, { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
      } catch (err) {
        toast(err.message);
        st.busy = false;
        return;
      }
      st.busy = false;
    }
    st.box = null;
    if (st.step === 'ranged') { st.step = 'melee'; renderFoot(); schedule(); return; }
    // fine: salva le icone e cerca le fasce
    st.mode = 'bands';
    if (!st.taught.ranged && !st.taught.melee) {
      toast('Nessuna icona insegnata: aggiungi le fasce a mano');
      renderFoot(); schedule();
      return;
    }
    try {
      await D.setIconTemplates(game.id, st.taught);
      tpls = { ...tpls, ...st.taught };
      cache.tpl = null;
    } catch (err) { console.error(err); toast('Icone non salvate: ' + err.message); }
    renderFoot(); schedule();
    detect();
  }

  // ----- rilevazione -----
  async function detect() {
    if (st.busy) return;
    if (!tpls.ranged && !tpls.melee) { toast('Prima insegna le icone (menu ⋮ → Reimposta icone)'); return; }
    st.busy = true;
    const btn = foot.querySelector('[data-detect]');
    if (btn) { btn.disabled = true; btn.textContent = 'Cerco…'; }
    try {
      await new Promise((r) => setTimeout(r, 40)); // lascia ridisegnare il pulsante
      if (!cache.card) cache.card = canvasToGray(card, SCAN_W);
      if (!cache.tpl) {
        cache.tpl = {};
        for (const k of ['ranged', 'melee']) if (tpls[k]) cache.tpl[k] = await templateFromBlob(tpls[k]);
      }
      const { rows } = findWeaponRowsGray(cache.card, cache.tpl, { sensitivity: st.sens });
      const k = W / cache.card.width;
      const keep = st.bands.filter((b) => b.src === 'manual' || b.edited);
      const found = rows.map((r) => mkBand(r.y0 * k, r.y1 * k, r.kind, 'auto'))
        .filter((b) => !keep.some((o) => Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) > 0.5 * Math.min(o.y1 - o.y0, b.y1 - b.y0)));
      st.bands = [...keep, ...found].sort((a, b) => a.y0 - b.y0);
      st.sel = -1; st.draft = null;
      toast(found.length ? `Trovate ${found.length} fasce` : 'Nessuna fascia trovata: alza la sensibilità o aggiungile a mano');
    } catch (err) {
      console.error(err);
      toast('Rilevamento non riuscito: ' + err.message);
    } finally {
      st.busy = false;
      renderFoot();
      schedule();
    }
  }

  function mkBand(y0, y1, kind, src) {
    return { id: st.nextId++, y0: clamp(y0, 0, H - MIN_BAND), y1: clamp(y1, MIN_BAND, H), x0: 0, x1: W, kind, src, edited: false };
  }

  function addBand() {
    const cy = clamp((vh / 2 - ty) / s, 0, H);
    const h = Math.max(MIN_BAND * 2, H * 0.08);
    const y0 = clamp(cy - h / 2, 0, H - h);
    st.bands.push(mkBand(y0, y0 + h, 'other', 'manual'));
    st.bands.sort((a, b) => a.y0 - b.y0);
    st.sel = st.bands.findIndex((b) => b.id === st.nextId - 1);
    selId = st.nextId - 1; st.draft = null;
    renderFoot(); schedule();
  }

  function delBand() {
    if (st.sel < 0) return;
    st.bands.splice(st.sel, 1);
    st.sel = -1; st.draft = null;
    renderFoot(); schedule();
  }

  // ----- gesti -----
  const ptrs = new Map();
  let mode = null;
  let selId = -1;      // id della fascia selezionata (l'indice cambia quando si riordina)
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const inImg = (p) => ({ x: clamp((p.x - tx) / s, 0, W), y: clamp((p.y - ty) / s, 0, H) });

  // Bordo di fascia piu' vicino al tocco: { i, edge: 't'|'b'|'l'|'r' } oppure null.
  function hitEdge(p) {
    let best = null, bd = HIT + 1;
    st.bands.forEach((b, i) => {
      const x0 = sx(b.x0), x1 = sx(b.x1), y0 = sy(b.y0), y1 = sy(b.y1);
      const insideX = p.x >= x0 - HIT && p.x <= x1 + HIT, insideY = p.y >= y0 - HIT && p.y <= y1 + HIT;
      const cands = [];
      if (insideX) cands.push(['t', Math.abs(p.y - y0)], ['b', Math.abs(p.y - y1)]);
      if (i === st.sel && insideY) cands.push(['l', Math.abs(p.x - x0)], ['r', Math.abs(p.x - x1)]);
      for (const [edge, d] of cands) {
        const bias = i === st.sel ? -4 : 0; // a parita' vince la fascia selezionata
        if (d + bias < bd) { bd = d + bias; best = { i, edge }; }
      }
    });
    return best;
  }

  function hitBand(p) {
    const ip = inImg(p);
    // l'ultima disegnata e' quella in cima; la selezionata ha la precedenza
    if (st.sel >= 0) { const b = st.bands[st.sel]; if (ip.y >= b.y0 && ip.y <= b.y1 && ip.x >= b.x0 && ip.x <= b.x1) return st.sel; }
    for (let i = st.bands.length - 1; i >= 0; i--) {
      const b = st.bands[i];
      if (ip.y >= b.y0 && ip.y <= b.y1 && ip.x >= b.x0 && ip.x <= b.x1) return i;
    }
    return -1;
  }

  function boxCorner(p) {
    if (!st.box) return -1;
    const b = st.box, cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
    let best = -1, bd = Infinity;
    cs.forEach(([cx, cy], i) => {
      const dx = Math.abs(p.x - sx(cx)), dy = Math.abs(p.y - sy(cy));
      if (dx <= HIT && dy <= HIT && dx + dy < bd) { best = i; bd = dx + dy; }
    });
    return best;
  }

  function startSingle(p) {
    if (st.mode === 'teach') {
      const c = boxCorner(p);
      if (c >= 0) { mode = { type: 'corner', c }; return; }
      const ip = inImg(p);
      if (st.box && ip.x >= st.box.x0 && ip.x <= st.box.x1 && ip.y >= st.box.y0 && ip.y <= st.box.y1) { mode = { type: 'boxmove', lx: ip.x, ly: ip.y }; return; }
      mode = { type: 'draw', ax: ip.x, ay: ip.y, prev: st.box };
      return;
    }
    const e = hitEdge(p);
    if (e) { st.sel = e.i; selId = st.bands[e.i].id; mode = { type: 'edge', i: e.i, edge: e.edge }; renderFoot(); schedule(); return; }
    const bi = hitBand(p);
    if (bi >= 0) { const ip = inImg(p); st.sel = bi; selId = st.bands[bi].id; mode = { type: 'bmove', i: bi, lx: ip.x, ly: ip.y }; renderFoot(); schedule(); return; }
    if (st.sel >= 0) { st.sel = -1; renderFoot(); schedule(); }
    mode = { type: 'pan', lx: p.x, ly: p.y };
  }

  const pinchPts = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  function startPinch() {
    if (mode && mode.type === 'draw') st.box = mode.prev; // il primo dito non voleva disegnare
    const { d, mx, my } = pinchPts();
    mode = { type: 'pinch', d0: d, s0: s, px: (mx - tx) / s, py: (my - ty) / s };
    schedule();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (st.busy) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
    ptrs.set(e.pointerId, local(e));
    if (ptrs.size === 1) startSingle(ptrs.get(e.pointerId));
    else if (ptrs.size === 2) startPinch();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !mode || st.busy) return;
    e.preventDefault();
    const p = local(e);
    ptrs.set(e.pointerId, p);
    const ip = inImg(p);
    switch (mode.type) {
      case 'pinch': {
        if (ptrs.size < 2) return;
        const { d, mx, my } = pinchPts();
        s = clamp(mode.s0 * (d / mode.d0), fitS * 0.5, fitS * 10);
        tx = mx - mode.px * s; ty = my - mode.py * s;
        clampView();
        break;
      }
      case 'pan':
        tx += p.x - mode.lx; ty += p.y - mode.ly; mode.lx = p.x; mode.ly = p.y; clampView();
        break;
      case 'draw': {
        const x0 = Math.min(mode.ax, ip.x), x1 = Math.max(mode.ax, ip.x), y0 = Math.min(mode.ay, ip.y), y1 = Math.max(mode.ay, ip.y);
        st.box = (x1 - x0) * s > 6 && (y1 - y0) * s > 6 ? { x0, y0, x1, y1 } : mode.prev;
        break;
      }
      case 'corner': {
        const b = st.box, min = 8 / s;
        if (mode.c === 0 || mode.c === 3) b.x0 = Math.min(ip.x, b.x1 - min); else b.x1 = Math.max(ip.x, b.x0 + min);
        if (mode.c === 0 || mode.c === 1) b.y0 = Math.min(ip.y, b.y1 - min); else b.y1 = Math.max(ip.y, b.y0 + min);
        break;
      }
      case 'boxmove': {
        const b = st.box, w = b.x1 - b.x0, h = b.y1 - b.y0;
        const nx = clamp(b.x0 + ip.x - mode.lx, 0, W - w), ny = clamp(b.y0 + ip.y - mode.ly, 0, H - h);
        st.box = { x0: nx, x1: nx + w, y0: ny, y1: ny + h };
        mode.lx = ip.x; mode.ly = ip.y;
        break;
      }
      case 'bmove': {
        const b = st.bands[mode.i], w = b.x1 - b.x0, h = b.y1 - b.y0;
        const nx = clamp(b.x0 + ip.x - mode.lx, 0, W - w), ny = clamp(b.y0 + ip.y - mode.ly, 0, H - h);
        b.x0 = nx; b.x1 = nx + w; b.y0 = ny; b.y1 = ny + h; b.edited = true;
        mode.lx = ip.x; mode.ly = ip.y;
        break;
      }
      case 'edge': {
        const b = st.bands[mode.i];
        if (mode.edge === 't') b.y0 = Math.min(ip.y, b.y1 - MIN_BAND);
        else if (mode.edge === 'b') b.y1 = Math.max(ip.y, b.y0 + MIN_BAND);
        else if (mode.edge === 'l') b.x0 = Math.min(ip.x, b.x1 - MIN_BAND);
        else b.x1 = Math.max(ip.x, b.x0 + MIN_BAND);
        b.edited = true;
        break;
      }
      default: break;
    }
    schedule();
  });

  function endPointer(e) {
    if (!ptrs.delete(e.pointerId)) return;
    if (mode && st.mode === 'teach' && (mode.type === 'draw' || mode.type === 'corner' || mode.type === 'boxmove')) renderFoot(); // abilita "Fatto"
    if (mode && (mode.type === 'bmove' || mode.type === 'edge') && ptrs.size === 0) { // riordina dall'alto e tiene la selezione
      st.bands.sort((a, b) => a.y0 - b.y0);
      st.sel = st.bands.findIndex((b) => b.id === selId);
      st.draft = null;
    }
    if (ptrs.size === 0) mode = null;
    else if (ptrs.size === 1) { const p = [...ptrs.values()][0]; mode = { type: 'pan', lx: p.x, ly: p.y }; }
    schedule();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => { // solo per provare da computer
    e.preventDefault();
    const p = local(e), ns = clamp(s * Math.exp(-e.deltaY * 0.0015), fitS * 0.5, fitS * 10);
    tx = p.x - ((p.x - tx) / s) * ns; ty = p.y - ((p.y - ty) / s) * ns; s = ns; clampView(); schedule();
  }, { passive: false });

  // ----- barra in alto -----
  root.querySelector('[data-back]').onclick = () => history.back();
  root.querySelector('[data-menu]').onclick = () => menuSheet('Carta', [
    { label: 'Rileva armi', run: () => { if (st.mode === 'bands') detect(); else toast('Prima insegna le icone'); } },
    { label: 'Reimposta icone', run: resetIcons },
    { label: 'Elimina tutte le fasce', danger: true, run: () => { st.bands = []; st.sel = -1; st.draft = null; renderFoot(); schedule(); } }
  ]);

  async function resetIcons() {
    const ok = await confirmSheet({
      title: 'Reimpostare le icone?',
      lines: [`Le icone di ${game.name} salvate verranno cancellate e dovrai insegnarle di nuovo da questa carta.`],
      confirmLabel: 'Reimposta', danger: true
    });
    if (!ok) return;
    try { await D.clearIconTemplates(game.id); } catch (err) { toast('Errore: ' + err.message); return; }
    tpls = {}; cache.tpl = null; st.taught = {}; st.box = null; st.step = 'ranged'; st.mode = 'teach';
    renderFoot(); schedule();
  }

  // ----- fascia -> PNG -----
  function bandCanvas(b, maxSide) {
    const x = Math.round(b.x0), y = Math.round(b.y0);
    const w = Math.max(1, Math.round(b.x1) - x), h = Math.max(1, Math.round(b.y1) - y);
    const k = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const cg = c.getContext('2d');
    cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = 'high';
    cg.drawImage(card, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  async function bandImages(b) {
    const full = bandCanvas(b, MAX_BAND);
    const blob = await toBlob(full);
    const tk = Math.min(1, THUMB_SIDE / Math.max(full.width, full.height));
    const tc = document.createElement('canvas');
    tc.width = Math.max(1, Math.round(full.width * tk)); tc.height = Math.max(1, Math.round(full.height * tk));
    const tg = tc.getContext('2d');
    tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = 'high';
    tg.drawImage(full, 0, 0, tc.width, tc.height);
    return { blob, width: full.width, height: full.height, thumb: await toBlob(tc) };
  }

  // ----- conferma: un campo "Arma" per fascia -----
  async function openConfirm() {
    if (!st.bands.length || st.busy) return;
    const [weapons, units] = await Promise.all([D.listWeaponsOfFaction(faction.id), unit ? Promise.resolve([unit]) : D.listUnits(faction.id)]);
    const byId = new Map(weapons.map((w) => [w.id, w]));
    const linked = unit ? new Set(weapons.filter((w) => w.unitIds.includes(unit.id)).map((w) => w.id)) : new Set();
    const bands = [...st.bands].sort((a, b) => a.y0 - b.y0);
    if (!st.draft || st.draft.bands.length !== bands.length) {
      st.draft = {
        unit: unit ? String(unit.id) : (units.length ? String(units[0].id) : 'new'), unitName: '',
        bands: bands.map((b) => ({ w: 'new', name: '', kind: b.kind }))
      };
    }
    const d = st.draft;
    const previews = bands.map((b) => bandCanvas(b, 480).toDataURL('image/jpeg', 0.7));

    const weaponOptions = (sel) => `<option value="new"${sel === 'new' ? ' selected' : ''}>Nuova arma…</option>` +
      weapons.map((w) => `<option value="${w.id}"${String(w.id) === sel ? ' selected' : ''}>${esc(w.name)}${linked.has(w.id) ? ' · già collegata' : ''}${w.imageId != null ? ' · ha profilo' : ''}</option>`).join('');
    const kindOptions = (sel) => Object.entries(KIND_LABEL).map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');

    const unitBlock = unit
      ? `<p class="sheet-text">${esc(L.unit)}: <b>${esc(unit.name)}</b></p>`
      : `<label class="field"><span>${esc(L.unit)} a cui collegare</span><select name="unit">
          ${units.map((u) => `<option value="${u.id}"${String(u.id) === d.unit ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
          <option value="new"${d.unit === 'new' ? ' selected' : ''}>Nuovo…</option></select></label>
        <label class="field" data-unitname${d.unit === 'new' ? '' : ' hidden'}><span>Nome del nuovo ${esc(lc(L.unit))} (in inglese)</span>
          <input type="text" name="unitName" value="${esc(d.unitName)}" autocomplete="off" autocapitalize="words" spellcheck="false"></label>`;

    const sheet = openSheet(`
      <h3 class="sheet-title">Assegna ${esc(lc(L.weapon))} alle fasce</h3>
      ${unitBlock}
      ${bands.map((b, i) => `
        <div class="band-card" data-i="${i}">
          <img class="band-prev checker-bg" src="${previews[i]}" alt="Fascia ${i + 1}">
          <label class="field"><span>${i + 1}. ${esc(L.weapon)}</span><select name="w${i}">${weaponOptions(d.bands[i].w)}</select></label>
          <div data-new${d.bands[i].w === 'new' ? '' : ' hidden'}>
            <label class="field"><span>Nome (in inglese)</span>
              <input type="text" name="n${i}" value="${esc(d.bands[i].name)}" autocomplete="off" autocapitalize="words" spellcheck="false"></label>
            <label class="field"><span>Tipo</span><select name="k${i}">${kindOptions(d.bands[i].kind)}</select></label>
          </div>
        </div>`).join('')}
      <div class="row">
        <button type="button" data-cancel>Indietro</button>
        <button type="button" class="primary" data-save>Salva ${bands.length} ${bands.length === 1 ? 'fascia' : 'fasce'}</button>
      </div>`);

    const val = (name) => sheet.querySelector(`[name="${name}"]`);
    const sync = () => {
      if (!unit) { d.unit = val('unit').value; d.unitName = val('unitName').value; sheet.querySelector('[data-unitname]').hidden = d.unit !== 'new'; }
      bands.forEach((_, i) => {
        d.bands[i] = { w: val('w' + i).value, name: val('n' + i).value, kind: val('k' + i).value };
        sheet.querySelector(`[data-i="${i}"] [data-new]`).hidden = d.bands[i].w !== 'new';
      });
    };
    sheet.addEventListener('input', sync);
    sheet.addEventListener('change', sync);
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    const saveBtn = sheet.querySelector('[data-save]');
    saveBtn.onclick = async () => {
      sync();
      saveBtn.disabled = true;
      try { await save(bands, byId, weapons); } finally { saveBtn.disabled = false; }
    };
  }

  // Chiede cosa fare con i profili gia' presenti: 'replace' | 'keep' | 'cancel'.
  function askReplace(names) {
    return new Promise((resolve) => {
      let answer = 'cancel';
      const sh = openSheet(`
        <h3 class="sheet-title">Profilo già presente</h3>
        <p class="sheet-text">Queste armi hanno già un profilo salvato:</p>
        <ul class="sheet-text">${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        <div class="sheet-menu">
          <button type="button" class="primary" data-a="replace">Sostituisci i profili</button>
          <button type="button" data-a="keep">Tieni quelli esistenti (collega soltanto)</button>
        </div>
        <button type="button" class="sheet-cancel" data-a="cancel">Torna indietro</button>`, { onClose: () => resolve(answer) });
      sh.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { answer = b.dataset.a; closeSheet(); }));
    });
  }

  async function save(bands, byId, weapons) {
    const d = st.draft;
    const fail = (m) => { toast(m); return null; };

    // 1. controlli
    let unitName = '';
    if (!unit && d.unit === 'new') {
      unitName = d.unitName.trim();
      if (!unitName) return fail(`Scrivi il nome del nuovo ${lc(L.unit)}`);
    }
    const plan = [], usedIds = new Set(), usedNames = new Set();
    for (let i = 0; i < bands.length; i++) {
      const c = d.bands[i];
      let weaponId = null, name = '';
      if (c.w === 'new') {
        name = c.name.trim();
        if (!name) return fail(`Fascia ${i + 1}: scrivi il nome dell'arma`);
        const dup = weapons.find((w) => norm(w.name) === norm(name)); // stesso nome = stessa arma, niente doppioni
        if (dup) weaponId = dup.id;
        else if (usedNames.has(norm(name))) return fail(`Il nome «${name}» è usato due volte`);
        else usedNames.add(norm(name));
      } else weaponId = Number(c.w);
      if (weaponId != null) {
        if (usedIds.has(weaponId)) return fail(`«${byId.get(weaponId).name}» è scelta per due fasce`);
        usedIds.add(weaponId);
      }
      plan.push({ band: bands[i], weaponId, name, kind: c.kind });
    }

    // 2. profili gia' presenti: mai sovrascritti senza conferma
    const conflicts = plan.filter((p) => p.weaponId != null && byId.get(p.weaponId).imageId != null);
    const keepImage = new Set();
    if (conflicts.length) {
      const ans = await askReplace(conflicts.map((p) => byId.get(p.weaponId).name));
      if (ans === 'cancel') { openConfirm(); return null; } // riapre il pannello con le scelte gia' fatte
      if (ans === 'keep') conflicts.forEach((p) => keepImage.add(p.weaponId));
    }

    // 3. scrittura
    st.busy = true;
    try {
      let unitId = unit ? unit.id : Number(d.unit);
      if (!unit && d.unit === 'new') unitId = await D.addUnit(faction.id, unitName);
      const ids = [];
      let saved = 0;
      for (const p of plan) {
        const imgs = await bandImages(p.band);
        let wid = p.weaponId;
        if (wid == null) wid = await D.addWeapon({ factionId: faction.id, unitId, name: p.name, kind: p.kind });
        ids.push(wid);
        if (!keepImage.has(wid)) { await D.setWeaponImage(wid, imgs.blob, imgs.width, imgs.height, imgs.thumb); saved++; }
      }
      const current = (await D.listWeaponsOfUnit(unitId)).map((w) => w.id);
      await D.setUnitWeapons(unitId, [...new Set([...current, ...ids])]);
      closeSheet();
      toast(`${plan.length} ${plan.length === 1 ? 'arma collegata' : 'armi collegate'}${saved < plan.length ? `, ${saved} profili salvati` : ''}`);
      st.busy = false;
      await offerUnitCrop(unitId);
    } catch (err) {
      console.error(err);
      st.busy = false;
      toast('Salvataggio non riuscito: ' + err.message);
    }
    return null;
  }

  // Facoltativo: ritaglio della miniatura dalla stessa carta.
  async function offerUnitCrop(unitId) {
    const u = await D.getUnit(unitId);
    const has = u && u.imageId != null;
    const ans = await new Promise((resolve) => {
      let answer = 'done';
      const sh = openSheet(`
        <h3 class="sheet-title">Ritagliare anche la miniatura?</h3>
        <p class="sheet-text">Puoi ritagliare l'immagine di «${esc(u ? u.name : '')}» da questa stessa carta.${has ? ' Sostituirà l\'immagine attuale solo se salvi il ritaglio.' : ''}</p>
        <div class="sheet-menu">
          <button type="button" class="primary" data-a="crop">Ritaglia la miniatura</button>
          <button type="button" data-a="done">No, ho finito</button>
        </div>`, { onClose: () => resolve(answer) });
      sh.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { answer = b.dataset.a; closeSheet(); }));
    });
    if (ans === 'crop') {
      try {
        const src = await toBlob(card, 'image/jpeg', 0.92);
        const out = await cropImage(src);
        if (out) { await D.setUnitImage(unitId, out.blob, out.width, out.height, out.thumb); toast('Immagine salvata'); }
      } catch (err) { console.error(err); toast('Ritaglio non riuscito: ' + err.message); }
    }
    leave(unitId);
  }

  function leave(unitId) {
    if (unit) history.back(); // si era partiti dalla scheda miniatura: un solo "indietro" per Android
    else location.replace(`#/libreria/g${game.id}/f${faction.id}/u${unitId}`);
  }

  renderFoot();
  resize();
  if (st.mode === 'bands') detect();
}
