// Crea (home): ricerca, schede Recenti / Preferiti / Azioni / Sfoglia.
//
// - Ricerca e chip del gioco: indice in memoria (js/search.js), aggiornato da solo a ogni modifica del database.
// - Recenti e Preferiti mostrano gli sticker disegnati con renderSticker (cache in memoria): tocco = Anteprima,
//   tocco lungo (500 ms, vibrazione breve) = salva subito con lo stesso template.
// - Sfoglia: #/crea?tab=sfoglia&f=<fazione> (la fazione aperta sta nell'indirizzo, cosi' "indietro" torna all'elenco).
// - Stato (testo cercato, scheda, gioco) conservato in memoria: tornando dall'Anteprima si ritrova com'era.

import * as D from '../db.js';
import { createLiveIndex, searchIndex, normalize } from '../search.js';
import { renderStickerFor, stickerNameParts, isPngAction } from '../stickerinput.js';
import { saveBlob, stickerFilename } from '../export.js';
import { toast, parseHash, canGoBack } from '../app.js';
import { esc, openSheet, closeSheet } from '../ui.js';

const live = createLiveIndex(D.db);

const TABS = [['recenti', 'Recenti'], ['preferiti', 'Preferiti'], ['azioni', 'Azioni'], ['sfoglia', 'Sfoglia']];
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;
const THUMB_CACHE_MAX = 80;

// Stato che sopravvive al cambio di schermata (il modulo resta caricato).
const ui = { q: '', tab: 'recenti', gameId: null, loaded: false, scroll: 0, restore: false };

let token = 0;
let cur = null; // risorse della schermata aperta: { observer, urls, alive }

// ---------- cache degli sticker disegnati (in memoria, con revoca degli URL piu' vecchi) ----------

const thumbCache = new Map(); // firma -> URL del Blob
function cachePut(sig, url) {
  thumbCache.set(sig, url);
  while (thumbCache.size > THUMB_CACHE_MAX) {
    const [oldSig, oldUrl] = thumbCache.entries().next().value;
    thumbCache.delete(oldSig);
    URL.revokeObjectURL(oldUrl);
  }
}

// Template: letti una volta per schermata. Se il template salvato non c'e' piu' (o e' di un altro tipo) si usa il predefinito.
let tplCache = new Map();
async function templateFor(templateId, kind) {
  const k = `${kind}:${templateId ?? ''}`;
  if (tplCache.has(k)) return tplCache.get(k);
  let row = templateId != null ? await D.getTemplate(templateId) : null;
  if (!row || row.kind !== kind) row = await D.getDefaultTemplate(kind);
  tplCache.set(k, row);
  return row;
}

// Dati per disegnare lo sticker di un elemento (recente, preferito o azione) con gli interruttori predefiniti del template.
// Azioni 'png': nessun template (tpl null), lo sticker e' il PNG importato, identico.
async function stickerFor(item) {
  const src = await D.getStickerSource({ unitId: item.unitId, weaponId: item.weaponId, actionId: item.actionId });
  if (isPngAction(src)) return { src, tpl: null };
  const tpl = await templateFor(item.templateId, src.action ? 'action' : 'activation');
  if (!tpl) throw new Error('Nessun template disponibile');
  return { src, tpl };
}

function signature(item, tpl) {
  const { u, w, a } = item;
  return [tpl ? tpl.id : 'png', tpl ? JSON.stringify(tpl.config) : '',
    u ? `u${u.id}:${u.name}:${u.imageId}` : '', w ? `w${w.id}:${w.name}:${w.imageId}` : '',
    a ? `a${a.id}:${a.name}:${a.label || ''}:${a.mode || ''}:${a.imageId}:${a.accentColor}` : ''].join('|');
}

async function thumbUrl(item) {
  const { src, tpl } = await stickerFor(item);
  const sig = signature(item, tpl);
  const hit = thumbCache.get(sig);
  if (hit) { thumbCache.delete(sig); thumbCache.set(sig, hit); return hit; } // piu' recente in fondo
  const blob = await renderStickerFor(src, tpl);
  const url = URL.createObjectURL(blob);
  cachePut(sig, url);
  return url;
}

// ---------- coda di disegno (2 alla volta) ----------

const queue = [];
let running = 0;
function enqueue(job) { queue.push(job); pump(); }
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift();
    running++;
    job().catch((e) => console.warn(e)).finally(() => { running--; pump(); });
  }
}

// ---------- utilita' ----------

const intParam = (q, name) => { const v = q.get(name); return v !== null && /^\d+$/.test(v) ? Number(v) : null; };
const lc = (s) => String(s || '').toLowerCase();

function anteprimaHash({ unitId = null, weaponId = null, actionId = null, templateId = null }) {
  const p = new URLSearchParams();
  if (actionId != null) p.set('action', actionId);
  else { if (unitId != null) p.set('unit', unitId); if (weaponId != null) p.set('weapon', weaponId); }
  if (templateId != null) p.set('template', templateId);
  return '#/anteprima?' + p.toString();
}

// Voce di recente/preferito -> elemento con i dati dell'indice; null se punta a qualcosa di eliminato.
function resolveCombo(row, index) {
  const u = row.unitId != null ? index.byId.units.get(row.unitId) : null;
  const w = row.weaponId != null ? index.byId.weapons.get(row.weaponId) : null;
  const a = row.actionId != null ? index.byId.actions.get(row.actionId) : null;
  if ((row.unitId != null && !u) || (row.weaponId != null && !w) || (row.actionId != null && !a)) return null;
  if (!u && !w && !a) return null;
  const gameId = (u && u.gameId) ?? (w && w.gameId) ?? (a && a.gameId) ?? null;
  return { key: row.key, unitId: row.unitId ?? null, weaponId: row.weaponId ?? null, actionId: row.actionId ?? null, templateId: row.templateId ?? null, u, w, a, gameId };
}
const inActiveGame = (item) => ui.gameId == null || item.gameId == null || item.gameId === ui.gameId;
const captionOf = (it) => (it.a ? it.a.name : [it.u && it.u.name, it.w && it.w.name].filter(Boolean).join(' · '));

// ---------- immagini piccole (miniature e armi), caricate solo quando entrano nella vista ----------

const visibleHandlers = new Map(); // selettore -> funzione da chiamare quando l'elemento entra nella vista

function loadImg(img) {
  const id = Number(img.dataset.imgId);
  if (!Number.isFinite(id)) return;
  D.getImage(id).then((r) => {
    if (!r || !img.isConnected) return;
    const url = URL.createObjectURL(r.thumb || r.blob);
    const done = () => URL.revokeObjectURL(url);
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    img.src = url;
    img.hidden = false;
  }).catch((e) => console.warn(e));
}

function observe(root, selector, onVisible) {
  const els = [...root.querySelectorAll(selector)];
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) { els.forEach(onVisible); return; }
  els.forEach((el) => cur.observer.observe(el));
  visibleHandlers.set(selector, onVisible);
}

function newObserver() {
  if (!('IntersectionObserver' in window)) return { observe() {}, unobserve() {}, disconnect() {} };
  return new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      cur.observer.unobserve(e.target);
      for (const [sel, fn] of visibleHandlers) if (e.target.matches(sel)) fn(e.target);
    }
  }, { rootMargin: '300px 0px' });
}

// ---------- HTML dei componenti ----------

function thumbHTML(imageId) {
  return imageId != null
    ? `<span class="thumb checker-bg" data-lazy><img alt="" data-img-id="${imageId}" hidden></span>`
    : '<span class="thumb empty" aria-hidden="true"></span>';
}

function stickerGridHTML(items) {
  return `<div class="stk-grid">${items.map((it, i) => `
    <button type="button" class="stk" data-i="${i}" aria-label="${esc(captionOf(it))}">
      <span class="stk-img checker-bg"><img alt="" draggable="false" hidden><span class="stk-wait">…</span></span>
      <span class="stk-cap">${esc(captionOf(it))}</span>
    </button>`).join('')}</div>`;
}

function resultRow(kind, id, { thumb, dot, name, meta }) {
  return `<li class="item">${thumb || ''}
    <button type="button" class="item-main" data-res="${kind}:${id}">
      <span class="item-name">${dot ? `<span class="dot" style="background:${esc(dot)}"></span>` : ''}${esc(name)}</span>
      ${meta ? `<span class="item-meta">${esc(meta)}</span>` : ''}
      <span class="chev">›</span>
    </button></li>`;
}

// ---------- tocco / tocco lungo sugli sticker ----------

let saving = false;

// Un dito appoggiato: la griglia non si ridisegna sotto di lui (il tocco lungo salva, poi aggiorna al rilascio).
let fingerDown = false;
let suppressClick = false; // dopo un tocco lungo il click del rilascio non deve aprire l'Anteprima
for (const t of ['pointerdown']) document.addEventListener(t, () => { fingerDown = true; }, true);
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { fingerDown = false; }, true);
function refreshWhenIdle() {
  if (!fingerDown) { if (cur && cur.alive()) cur.refreshBody(); return; }
  const once = () => {
    document.removeEventListener('pointerup', once, true);
    document.removeEventListener('pointercancel', once, true);
    setTimeout(() => { if (cur && cur.alive() && ui.tab === 'recenti' && !ui.q) cur.refreshBody(); }, 80);
  };
  document.addEventListener('pointerup', once, true);
  document.addEventListener('pointercancel', once, true);
}

async function quickSave(item) {
  if (saving) return;
  saving = true;
  try {
    const { src, tpl } = await stickerFor(item);
    const blob = await renderStickerFor(src, tpl);
    saveBlob(blob, stickerFilename(stickerNameParts(src)));
    await D.recordUse({ unitId: item.unitId, weaponId: item.weaponId, actionId: item.actionId, templateId: tpl ? tpl.id : null });
    toast('Salvato');
    if (ui.tab === 'recenti' && !ui.q) refreshWhenIdle();
  } catch (err) {
    console.error(err);
    toast('Errore: ' + err.message);
  } finally {
    setTimeout(() => { saving = false; }, 600);
  }
}

// Gestisce tocco e tocco lungo sui pulsanti .stk dentro root. items[i] corrisponde a data-i.
function wireStickers(root, items, { longPress, onTap }) {
  const btns = [...root.querySelectorAll('.stk')];
  const paint = (btn) => {
    const item = items[Number(btn.dataset.i)];
    const img = btn.querySelector('img');
    const wait = btn.querySelector('.stk-wait');
    const my = cur;
    enqueue(async () => {
      if (!my.alive() || !btn.isConnected) return;
      try {
        const url = await thumbUrl(item);
        if (!my.alive() || !btn.isConnected) return;
        img.src = url;
        img.hidden = false;
        wait.hidden = true;
      } catch (err) {
        wait.textContent = 'Errore';
        console.warn(err);
      }
    });
  };
  btns.forEach((b) => { visibleHandlers.set('.stk', paint); cur.observer.observe(b); });
  if (!('IntersectionObserver' in window)) btns.forEach(paint);

  let timer = 0, start = null;
  const cancel = () => { clearTimeout(timer); timer = 0; start = null; };
  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.stk');
    if (!btn || e.button > 0) return;
    suppressClick = false;
    if (!longPress) return;
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      suppressClick = true;
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* non supportata */ } }
      quickSave(items[Number(btn.dataset.i)]);
    }, LONG_PRESS_MS);
  });
  root.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => root.addEventListener(t, cancel));
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.stk')) e.preventDefault(); });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.stk');
    if (!btn) return;
    if (suppressClick) { suppressClick = false; e.preventDefault(); return; } // il tocco lungo non apre anche l'Anteprima
    onTap(items[Number(btn.dataset.i)]);
  });
}

// ---------- pannelli: miniatura e scelta della miniatura per un'arma ----------

async function openUnitSheet(unitId) {
  const index = await live.ensure();
  const u = index.byId.units.get(unitId);
  if (!u) { toast('Elemento non trovato'); return; }
  const game = index.byId.games.get(u.gameId);
  const L = (game && game.labels) || { unit: 'Unità', weapon: 'Arma' };
  const weapons = await D.listWeaponsOfUnit(unitId);
  const sheet = openSheet(`
    <h3 class="sheet-title">${esc(u.name)}</h3>
    <p class="meta">${esc([u.factionName, game && game.name].filter(Boolean).join(' · '))}</p>
    <div class="sheet-menu">
      <button type="button" class="primary" data-solo>Solo ${esc(lc(L.unit))}</button>
      ${weapons.length ? `<h4 class="sheet-sub">${esc(L.weapon === 'Arma' ? 'Armi' : L.weapon)}</h4>` : ''}
      ${weapons.map((w) => `<button type="button" class="sheet-weapon" data-w="${w.id}">${thumbHTML(w.imageId)}<span>${esc(w.name)}</span></button>`).join('')}
    </div>
    ${weapons.length ? '' : `<p class="meta">Nessuna ${esc(lc(L.weapon))} collegata: la trovi o la importi dalla Libreria.</p>`}
    <button type="button" class="sheet-cancel" data-cancel>Annulla</button>`);
  sheet.querySelectorAll('img[data-img-id]').forEach(loadImg);
  sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
  sheet.querySelector('[data-solo]').addEventListener('click', () => { location.hash = anteprimaHash({ unitId }); });
  sheet.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
    location.hash = anteprimaHash({ unitId, weaponId: Number(b.dataset.w) });
  }));
}

// Arma toccata fuori da una miniatura: se ne ha piu' di una chiede con quale.
async function openWeapon(weaponId, preferUnitId = null) {
  const index = await live.ensure();
  const w = index.byId.weapons.get(weaponId);
  if (!w) { toast('Elemento non trovato'); return; }
  if (w.unitIds.length === 0) { location.hash = anteprimaHash({ weaponId }); return; }
  if (w.unitIds.length === 1) { location.hash = anteprimaHash({ unitId: w.unitIds[0], weaponId }); return; }
  const game = index.byId.games.get(w.gameId);
  const L = (game && game.labels) || { unit: 'Unità' };
  const units = w.unitIds.map((id) => index.byId.units.get(id)).filter(Boolean).sort((a, b) => (a.id === preferUnitId ? -1 : b.id === preferUnitId ? 1 : a.name.localeCompare(b.name)));
  const sheet = openSheet(`
    <h3 class="sheet-title">${esc(w.name)}</h3>
    <p class="meta">Con quale ${esc(lc(L.unit))}?</p>
    <div class="sheet-menu">
      ${units.map((u) => `<button type="button" class="sheet-weapon" data-u="${u.id}">${thumbHTML(u.imageId)}<span>${esc(u.name)}</span></button>`).join('')}
    </div>
    <button type="button" class="sheet-cancel" data-cancel>Annulla</button>`);
  sheet.querySelectorAll('img[data-img-id]').forEach(loadImg);
  sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => {
    location.hash = anteprimaHash({ unitId: Number(b.dataset.u), weaponId });
  }));
}

// ---------- contenuto delle schede ----------

function emptyHTML(text) { return `<p class="empty">${esc(text)}</p>`; }

async function recentiTab(index) {
  const rows = await D.listRecents();
  const items = rows.map((r) => resolveCombo(r, index)).filter((x) => x && inActiveGame(x));
  if (!items.length) {
    return { html: emptyHTML('Ancora nessuno sticker salvato. Cerca una miniatura qui sopra, oppure sfoglia le squadre.'), wire() {} };
  }
  return {
    html: `<p class="meta stk-hint">Tocco: apre l'Anteprima · tocco lungo: salva subito.</p>${stickerGridHTML(items)}`,
    wire(root) { wireStickers(root, items, { longPress: true, onTap: (it) => { location.hash = anteprimaHash(it); } }); }
  };
}

async function preferitiTab(index) {
  const combos = (await D.listFavCombos()).slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    .map((r) => resolveCombo(r, index)).filter((x) => x && inActiveGame(x));
  const g = (e) => e.gameId;
  const favUnits = index.units.filter((e) => e.fav && (ui.gameId == null || g(e) === ui.gameId));
  const favWeapons = index.weapons.filter((e) => e.fav && (ui.gameId == null || g(e) === ui.gameId));
  const favActions = index.actions.filter((e) => e.fav && (ui.gameId == null || e.gameId == null || g(e) === ui.gameId));
  if (!combos.length && !favUnits.length && !favWeapons.length && !favActions.length) {
    return { html: emptyHTML('Nessun preferito. Usa la stella in Anteprima per una combinazione, oppure il menu ⋮ in Libreria.'), wire() {} };
  }
  const list = (title, rows) => (rows.length ? `<h2>${title}</h2><ul class="list">${rows.join('')}</ul>` : '');
  const html = `
    ${combos.length ? `<h2>Combinazioni</h2><p class="meta stk-hint">Tocco: apre l'Anteprima · tocco lungo: salva subito.</p>${stickerGridHTML(combos)}` : ''}
    ${list('Miniature', favUnits.map((e) => resultRow('unit', e.id, { thumb: thumbHTML(e.imageId), name: e.name, meta: e.factionName })))}
    ${list('Armi', favWeapons.map((e) => resultRow('weapon', e.id, { thumb: thumbHTML(e.imageId), name: e.name, meta: e.unitNames[0] ? e.unitNames[0] + (e.unitNames.length > 1 ? ` +${e.unitNames.length - 1}` : '') : e.factionName })))}
    ${list('Azioni', favActions.map((e) => resultRow('action', e.id, { dot: e.accentColor, name: e.name, meta: e.gameName })))}`;
  return {
    html,
    wire(root) {
      if (combos.length) wireStickers(root, combos, { longPress: true, onTap: (it) => { location.hash = anteprimaHash(it); } });
    }
  };
}

async function azioniTab(index) {
  const actions = index.actions.filter((e) => ui.gameId == null || e.gameId == null || e.gameId === ui.gameId);
  if (!actions.length) {
    return { html: emptyHTML('Nessuna azione. Aggiungile dalla Libreria, dentro il gioco.'), wire() {} };
  }
  const items = actions.map((a) => ({ key: 'a' + a.id, unitId: null, weaponId: null, actionId: a.id, templateId: null, u: null, w: null, a, gameId: a.gameId }));
  return {
    html: stickerGridHTML(items),
    wire(root) { wireStickers(root, items, { longPress: false, onTap: (it) => { location.hash = anteprimaHash({ actionId: it.actionId }); } }); }
  };
}

async function sfogliaTab(index, factionId) {
  const factions = [...index.byId.factions.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  const countOf = new Map();
  for (const u of index.units) countOf.set(u.factionId, (countOf.get(u.factionId) || 0) + 1);

  const faction = factionId != null ? index.byId.factions.get(factionId) : null;
  if (faction) {
    const units = index.units.filter((u) => u.factionId === faction.id).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
    const game = index.byId.games.get(faction.gameId);
    const html = `
      <div class="browse-head"><button type="button" class="back" data-browse-back aria-label="Indietro">‹</button>
        <div><b>${esc(faction.name)}</b><div class="meta">${esc(game ? game.name : '')}</div></div></div>
      ${units.length ? `<div class="unit-grid">${units.map((u) => `
        <button type="button" class="unit-tile" data-unit="${u.id}">
          <span class="unit-pic checker-bg"${u.imageId != null ? ' data-lazy' : ''}>${u.imageId != null ? `<img alt="" data-img-id="${u.imageId}" hidden>` : '<span class="unit-ph" aria-hidden="true">?</span>'}</span>
          <span class="unit-name">${esc(u.name)}</span>
        </button>`).join('')}</div>` : emptyHTML('Nessuna miniatura in questa fazione.')}`;
    return {
      html,
      wire(root) {
        root.querySelector('[data-browse-back]').addEventListener('click', () => {
          if (canGoBack()) history.back(); else location.replace('#/crea?tab=sfoglia');
        });
        root.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => openUnitSheet(Number(b.dataset.unit))));
      }
    };
  }

  const shown = factions.filter((f) => ui.gameId == null || f.gameId === ui.gameId);
  if (!shown.length) return { html: emptyHTML('Nessuna fazione. Importa un PDF squadra o aggiungila dalla Libreria.'), wire() {} };
  const groups = new Map();
  for (const f of shown) { if (!groups.has(f.gameId)) groups.set(f.gameId, []); groups.get(f.gameId).push(f); }
  const html = [...groups.entries()].map(([gid, list]) => {
    const game = index.byId.games.get(gid);
    return `${ui.gameId == null ? `<h2>${esc(game ? game.name : '')}</h2>` : ''}
      <ul class="list">${list.map((f) => `<li class="item"><a class="item-main" href="#/crea?tab=sfoglia&f=${f.id}">
        <span class="item-name">${esc(f.name)}</span><span class="item-meta">${countOf.get(f.id) || 0} ${(countOf.get(f.id) || 0) === 1 ? 'miniatura' : 'miniature'}</span><span class="chev">›</span></a></li>`).join('')}</ul>`;
  }).join('');
  return { html, wire() {} };
}

// ---------- risultati di ricerca ----------

function resultsView(index) {
  const res = searchIndex(index, ui.q, { gameId: ui.gameId, max: 8 });
  const multi = ui.gameId == null;
  const more = (n) => (n > 0 ? `<p class="meta">+${n} altri: scrivi di più per restringere.</p>` : '');
  const html = [
    res.units.length ? `<h2>Miniature</h2><ul class="list">${res.units.map((e) => resultRow('unit', e.id, {
      thumb: thumbHTML(e.imageId), name: e.name, meta: [e.factionName, multi ? e.gameName : ''].filter(Boolean).join(' · ') })).join('')}</ul>${more(res.more.units)}` : '',
    res.weapons.length ? `<h2>Armi</h2><ul class="list">${res.weapons.map((e) => resultRow('weapon', `${e.id}:${e.via.unitId ?? ''}`, {
      thumb: thumbHTML(e.imageId),
      name: e.via.unitName ? `${e.name} · ${e.via.unitName}` : e.name,
      meta: [e.via.extra > 0 ? `+${e.via.extra} ${e.via.extra === 1 ? 'altra miniatura' : 'altre miniature'}` : '', e.factionName, multi ? e.gameName : ''].filter(Boolean).join(' · ') })).join('')}</ul>${more(res.more.weapons)}` : '',
    res.actions.length ? `<h2>Azioni</h2><ul class="list">${res.actions.map((e) => resultRow('action', e.id, {
      dot: e.accentColor, name: e.name, meta: multi ? e.gameName : '' })).join('')}</ul>${more(res.more.actions)}` : ''
  ].join('');
  const empty = !res.units.length && !res.weapons.length && !res.actions.length;
  return { html: empty ? emptyHTML(`Nessun risultato per «${ui.q.trim()}».`) : html, wire() {} };
}

// ---------- schermata ----------

export async function render(el) {
  const my = ++token;
  const res = { observer: null, alive: () => my === token && el.isConnected, refreshBody: () => {} };
  cur = res;
  res.observer = newObserver();
  visibleHandlers.clear();
  queue.length = 0;
  tplCache = new Map();

  try {
    await D.ready();
  } catch (err) {
    console.error(err);
    el.innerHTML = '<h1>Crea</h1><p>Impossibile aprire il database. Controlla che il browser non sia in navigazione privata.</p>';
    return;
  }
  const games = await D.listGames();
  if (!res.alive()) return;

  if (!ui.loaded) {
    const saved = await D.getSetting('lastGameId', 'all');
    ui.gameId = games.some((g) => g.id === saved) ? saved : null;
    ui.loaded = true;
  }
  if (ui.gameId != null && !games.some((g) => g.id === ui.gameId)) ui.gameId = null;

  const q = parseHash().query;
  const urlTab = q.get('tab');
  let factionId = intParam(q, 'f');
  if (urlTab && TABS.some(([k]) => k === urlTab)) ui.tab = urlTab;
  if (factionId != null) ui.tab = 'sfoglia';

  el.innerHTML = `
    <div class="crea-top">
      <input type="search" id="crea-q" class="crea-q" placeholder="Cerca miniatura, arma o azione…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Cerca">
      <div class="chips scroll" role="group" aria-label="Gioco">
        <button type="button" class="chip" data-game="all" aria-pressed="${ui.gameId == null}">Tutti</button>
        ${games.map((g) => `<button type="button" class="chip" data-game="${g.id}" aria-pressed="${ui.gameId === g.id}">${esc(g.name)}</button>`).join('')}
      </div>
    </div>
    <div id="crea-body"></div>`;
  const input = el.querySelector('#crea-q');
  const body = el.querySelector('#crea-body');
  input.value = ui.q;

  let bodyGen = 0;
  async function renderBody() {
    const gen = ++bodyGen;
    res.observer.disconnect();
    visibleHandlers.clear();
    queue.length = 0;
    let index;
    try { index = await live.ensure(); } catch (err) { console.error(err); body.innerHTML = emptyHTML('Errore nel leggere i dati.'); return; }
    if (gen !== bodyGen || !res.alive()) return;

    let view, header = '';
    if (normalize(ui.q)) {
      view = resultsView(index);
    } else {
      header = `<div class="seg" role="tablist" aria-label="Sezioni">${TABS.map(([k, label]) =>
        `<button type="button" role="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${label}</button>`).join('')}</div>`;
      if (ui.tab === 'preferiti') view = await preferitiTab(index);
      else if (ui.tab === 'azioni') view = await azioniTab(index);
      else if (ui.tab === 'sfoglia') view = await sfogliaTab(index, factionId);
      else view = await recentiTab(index);
      if (gen !== bodyGen || !res.alive()) return;
    }
    body.innerHTML = header + `<div id="crea-view">${view.html}</div>`;
    const viewEl = body.querySelector('#crea-view');

    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      if (ui.tab === b.dataset.tab && factionId == null) return;
      ui.tab = b.dataset.tab;
      factionId = null;
      history.replaceState(history.state, '', '#/crea?tab=' + ui.tab);
      renderBody();
    }));
    viewEl.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', () => {
      const [kind, id, hint] = b.dataset.res.split(':');
      if (kind === 'unit') openUnitSheet(Number(id));
      else if (kind === 'weapon') openWeapon(Number(id), hint ? Number(hint) : null);
      else location.hash = anteprimaHash({ actionId: Number(id) });
    }));
    view.wire(viewEl);
    // Si osservano i contenitori (un <img hidden> non e' mai "visibile" per l'osservatore).
    observe(viewEl, '[data-lazy]', (box) => { const img = box.querySelector('img[data-img-id]'); if (img) loadImg(img); });
    if (ui.restore) {
      ui.restore = false;
      requestAnimationFrame(() => window.scrollTo(0, ui.scroll));
    }
  }
  res.refreshBody = renderBody;

  input.addEventListener('input', () => { ui.q = input.value; ui.restore = false; renderBody(); });
  el.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.game === 'all' ? null : Number(b.dataset.game);
    if (v === ui.gameId) return;
    ui.gameId = v;
    D.setSetting('lastGameId', v == null ? 'all' : v).catch(() => {});
    el.querySelectorAll('[data-game]').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    if (factionId != null) { factionId = null; history.replaceState(history.state, '', '#/crea?tab=' + ui.tab); }
    renderBody();
  }));

  await renderBody();
}

// Chiamata dal router quando si lascia la schermata: libera gli osservatori e ricorda la posizione.
export function cleanup() {
  token++;
  // Il router ha gia' cambiato indirizzo: si ripristina la posizione solo se si va in un'altra schermata
  // (non quando si apre una fazione o si torna all'elenco, che partono dall'alto).
  ui.scroll = window.scrollY;
  ui.restore = parseHash().name !== 'crea';
  if (cur && cur.observer) cur.observer.disconnect();
  queue.length = 0;
  closeSheet();
}
