// Libreria: giochi > fazioni > miniature > scheda miniatura (con armi).
// Route a hash: #/libreria, #/libreria/g1, #/libreria/g1/f2, #/libreria/g1/f2/u3

import * as D from '../db.js';
import { toast } from '../app.js';
import { esc, menuSheet, confirmSheet, formSheet } from '../ui.js';
import { pickImage, cropImage } from '../crop.js';
import { startCardImport } from './carta.js';
import { startPdfImport } from './pdfimport.js';

const KIND_LABEL = { ranged: 'A distanza', melee: 'Mischia', other: 'Altro' };
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
// Profilo testuale di un'arma importata dal PDF: "ATK 4 · HIT 3+ · DMG 3/4 · Range 8", Piercing 1".
const profileText = (w) => (w.profile ? `ATK ${w.profile.atk} · HIT ${w.profile.hit} · DMG ${w.profile.dmg}${w.profile.rules && w.profile.rules.length ? ' · ' + w.profile.rules.join(', ') : ''}` : '');
const RULE_TITLES = [['factionRule', 'Regola di fazione'], ['ploy-strategy', 'Stratagemmi Strategy'], ['ploy-firefight', 'Stratagemmi Firefight'], ['equipment', 'Equipaggiamento']];

function rulesHTML(rules) {
  if (!rules.length) return '';
  return `<h2>Regole</h2>${RULE_TITLES.map(([kind, title]) => {
    const rows = rules.filter((r) => r.kind === kind);
    if (!rows.length) return '';
    return `<details class="pdf-op"><summary><span class="pdf-op-name">${esc(title)}</span><span class="meta">${rows.length}</span></summary>${rows.map((r) =>
      `<p class="pdf-txt"><b>${esc(r.name)}</b>${r.cost ? ` <span class="pdf-cost">${esc(r.cost)}</span>` : ''} ${esc(r.text)}</p>`).join('')}</details>`;
  }).join('')}`;
}

function statsHTML(unit) {
  const s = unit.stats;
  if (!s) return '';
  return `<div class="unit-stats">${[['APL', s.apl], ['MOVE', s.move], ['SAVE', s.save], ['WOUNDS', s.wounds]].map(([l, v]) =>
    `<div><small>${l}</small><b>${esc(v ?? '–')}</b></div>`).join('')}</div>`;
}

function textBlocksHTML(unit) {
  const ab = unit.abilities || [], ac = unit.actions || [], kw = unit.keywords || [];
  if (!ab.length && !ac.length && !kw.length) return '';
  return `${ab.length ? `<h2>Abilità</h2>${ab.map((a) => `<p class="pdf-txt"><b>${esc(a.name)}</b> ${esc(a.text)}</p>`).join('')}` : ''}
    ${ac.length ? `<h2>Azioni</h2>${ac.map((a) => `<p class="pdf-txt"><b>${esc(a.name)}</b> <span class="pdf-cost">${esc(a.cost)}</span> ${esc(a.text)}</p>`).join('')}` : ''}
    ${kw.length ? `<p class="meta">${esc(kw.join(', '))}</p>` : ''}`;
}

const lc = (s) => String(s || '').toLowerCase();
const link = (...parts) => '#/libreria' + parts.map((p) => '/' + p).join('');

// Colori accento delle azioni (valore salvato: '#rrggbb' oppure '' = nessuno).
const ACTION_COLORS = [
  ['', 'Nessuno'], ['#e53935', 'Rosso'], ['#fb8c00', 'Arancione'], ['#fdd835', 'Giallo'],
  ['#43a047', 'Verde'], ['#00acc1', 'Azzurro'], ['#1e88e5', 'Blu'], ['#8e24aa', 'Viola'],
  ['#ec407a', 'Rosa'], ['#bdbdbd', 'Grigio'], ['#ffffff', 'Bianco']
];

function colorField(current) {
  const cur = String(current || '').toLowerCase();
  const options = ACTION_COLORS.map(([value, label]) => ({ value, label }));
  // Un colore non in elenco (es. impostato in futuro) resta selezionabile e non va perso.
  if (cur && !ACTION_COLORS.some(([v]) => v === cur)) options.push({ value: cur, label: `Personalizzato (${cur})` });
  return { name: 'color', label: 'Colore accento (facoltativo)', type: 'select', value: cur, options };
}

// Azioni sulle immagini, per tipo di elemento.
const IMG_API = {
  unit: { set: D.setUnitImage, remove: D.removeUnitImage },
  weapon: { set: D.setWeaponImage, remove: D.removeWeaponImage }
};

let token = 0;

function parseRoute() {
  const segs = location.hash.replace(/^#\/?/, '').split('/').slice(1).filter(Boolean);
  const ids = {};
  for (const s of segs) {
    const m = /^([gfu])(\d+)$/.exec(s);
    if (m) ids[m[1]] = Number(m[2]);
  }
  return ids;
}

export async function render(el) {
  const my = ++token;
  try {
    await D.ready();
  } catch (err) {
    console.error(err);
    el.innerHTML = '<h1>Libreria</h1><p>Impossibile aprire il database. Controlla che il browser non sia in navigazione privata.</p>';
    return;
  }
  const bounce = (hash) => { location.replace(hash); };
  const ids = parseRoute();

  let game = null, faction = null, unit = null;
  if (ids.g) {
    game = await D.getGame(ids.g);
    if (!game) return bounce('#/libreria');
  }
  if (ids.f) {
    faction = game && await D.getFaction(ids.f);
    if (!faction || faction.gameId !== game.id) return bounce(game ? link('g' + game.id) : '#/libreria');
  }
  if (ids.u) {
    unit = faction && await D.getUnit(ids.u);
    if (!unit || unit.factionId !== faction.id) return bounce(faction ? link('g' + game.id, 'f' + faction.id) : '#/libreria');
  }

  const refresh = () => render(el);
  const ctx = { el, refresh, game, faction, unit, urls: [] };

  let html, wire;
  if (unit) ({ html, wire } = await unitScreen(ctx));
  else if (faction) ({ html, wire } = await factionScreen(ctx));
  else if (game) ({ html, wire } = await gameScreen(ctx));
  else ({ html, wire } = await gamesScreen(ctx));

  if (my !== token) { // nel frattempo l'utente e' andato altrove
    ctx.urls.forEach((u) => URL.revokeObjectURL(u));
    return;
  }
  el.innerHTML = html;
  watchImages(el);
  wire(el);
  window.scrollTo(0, 0);
}

// ---------- componenti ----------

function crumbs(parts) {
  return `<nav class="crumbs" aria-label="Percorso">${parts.map((p, i) =>
    i < parts.length - 1 ? `<a href="${p.href}">${esc(p.label)}</a><span class="sep">›</span>` : `<span class="cur">${esc(p.label)}</span>`
  ).join('')}</nav>`;
}

// URL temporaneo per un Blob: viene revocato appena l'<img> lo ha caricato (vedi watchImages).
function blobUrl(ctx, blob) {
  const u = URL.createObjectURL(blob);
  ctx.urls.push(u);
  return u;
}

function watchImages(root) {
  root.querySelectorAll('img[data-revoke]').forEach((img) => {
    const done = () => URL.revokeObjectURL(img.src);
    if (img.complete) done();
    else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  });
}

function thumbHTML(url) {
  return url
    ? `<span class="thumb checker-bg"><img src="${url}" alt="" data-revoke></span>`
    : '<span class="thumb empty" aria-hidden="true"></span>';
}

// Restituisce una funzione arma -> URL della miniatura (o null).
async function weaponThumbs(ctx, weapons) {
  const imgs = await D.getImagesById(weapons.map((w) => w.imageId).filter((x) => x != null));
  return (w) => {
    const r = w.imageId != null ? imgs.get(w.imageId) : null;
    return r ? blobUrl(ctx, r.thumb || r.blob) : null;
  };
}

function sectionHead(title, key) {
  return `<div class="section-head"><h2>${esc(title)}</h2>
    <button type="button" class="add" data-add="${key}" aria-label="Aggiungi">+</button></div>`;
}

function listHTML(key, items, { href, meta, empty, thumb, dot }) {
  if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<ul class="list" data-list="${key}">${items.map((it) => `
    <li class="item">
      ${thumb ? thumbHTML(thumb(it)) : ''}
      ${href ? `<a class="item-main" href="${href(it)}">` : '<div class="item-main">'}
        <span class="item-name">${it.fav ? '<span class="star">★</span> ' : ''}${dot && dot(it) ? `<span class="dot" style="background:${esc(dot(it))}"></span>` : ''}${esc(it.name)}</span>
        ${meta && meta(it) ? `<span class="item-meta">${esc(meta(it))}</span>` : ''}
      ${href ? '<span class="chev">›</span></a>' : '</div>'}
      <button type="button" class="kebab" data-menu="${it.id}" aria-label="Menu di ${esc(it.name)}">⋮</button>
    </li>`).join('')}</ul>`;
}

function onAdd(root, key, handler) {
  const b = root.querySelector(`[data-add="${key}"]`);
  if (b) b.addEventListener('click', handler);
}

function onMenu(root, key, items, handler) {
  root.querySelectorAll(`[data-list="${key}"] [data-menu]`).forEach((b) =>
    b.addEventListener('click', () => handler(items.find((i) => i.id === Number(b.dataset.menu)))));
}

// Menu ⋮ comune: Rinomina, Preferito, Elimina (piu' voci extra opzionali).
function entityMenu(item, { rename, table, remove, extra = [], ctx }) {
  menuSheet(item.name, [
    { label: 'Rinomina', run: rename },
    { label: item.fav ? '☆ Togli dai preferiti' : '★ Segna come preferito', run: async () => { await D.toggleFav(table, item.id); ctx.refresh(); } },
    ...extra,
    { label: 'Elimina…', danger: true, run: remove }
  ]);
}

function countLines(rows) {
  const lines = rows.filter(([, n]) => n > 0).map(([label, n]) => `${label}: ${n}`);
  return lines.length ? ['Verranno eliminati anche:', ...lines] : ['Non contiene altri elementi.'];
}

async function guard(fn) {
  try { await fn(); } catch (err) { console.error(err); toast('Errore: ' + err.message); }
}

// ---------- livello 0: giochi ----------

async function gamesScreen(ctx) {
  const games = await D.listGames();
  const html = `
    ${crumbs([{ label: 'Libreria' }])}
    <h1>Libreria</h1>
    ${sectionHead('Giochi', 'game')}
    ${listHTML('game', games, { href: (g) => link('g' + g.id), meta: (g) => `${g.labels.faction} · ${g.labels.unit} · ${g.labels.weapon}`, empty: 'Nessun gioco. Tocca + per aggiungerne uno.' })}`;

  const labelFields = (labels = {}) => [
    { name: 'faction', label: 'Etichetta per le fazioni (es. Squadra, Esercito)', value: labels.faction ?? '', type: 'text' },
    { name: 'unit', label: 'Etichetta per le miniature (es. Operativo, Unità)', value: labels.unit ?? '', type: 'text' },
    { name: 'weapon', label: 'Etichetta per le armi', value: labels.weapon ?? 'Arma', type: 'text' }
  ];

  const wire = (root) => {
    onAdd(root, 'game', async () => {
      const v = await formSheet({
        title: 'Nuovo gioco',
        fields: [{ name: 'name', label: 'Nome del gioco', type: 'text', required: true }, ...labelFields({ faction: 'Fazione', unit: 'Unità', weapon: 'Arma' })]
      });
      if (!v) return;
      await guard(async () => { await D.addGame(v.name, v); ctx.refresh(); });
    });
    onMenu(root, 'game', games, (g) => entityMenu(g, {
      ctx, table: 'games',
      rename: async () => {
        const v = await formSheet({ title: 'Rinomina gioco', fields: [{ name: 'name', label: 'Nome', value: g.name, type: 'text', required: true }, ...labelFields(g.labels)] });
        if (!v) return;
        await guard(async () => { await D.patch('games', g.id, { name: v.name, labels: v }); ctx.refresh(); });
      },
      remove: async () => {
        const c = await D.countGameContents(g.id);
        const ok = await confirmSheet({
          title: `Eliminare «${g.name}»?`,
          lines: countLines([[g.labels.faction, c.factions], [g.labels.unit, c.units], [g.labels.weapon, c.weapons], ['Azioni', c.actions], ['Carte', c.cards]]),
          confirmLabel: 'Elimina', danger: true
        });
        if (!ok) return;
        await guard(async () => { await D.deleteGame(g.id); toast('Gioco eliminato'); ctx.refresh(); });
      }
    }));
  };
  return { html, wire };
}

// ---------- livello 1: fazioni di un gioco ----------

async function gameScreen(ctx) {
  const { game } = ctx;
  const [factions, actions] = await Promise.all([D.listFactions(game.id), D.listActions(game.id)]);
  const L = game.labels;
  const html = `
    ${crumbs([{ label: 'Libreria', href: link() }, { label: game.name }])}
    <h1>${esc(game.name)}</h1>
    <div class="row"><button type="button" class="primary" data-import-pdf>Importa PDF squadra</button></div>
    ${sectionHead(L.faction, 'faction')}
    ${listHTML('faction', factions, { href: (f) => link('g' + game.id, 'f' + f.id), empty: `Vuoto. Tocca + per aggiungere: ${L.faction}.` })}
    ${sectionHead('Azioni', 'action')}
    ${listHTML('action', actions, { dot: (a) => a.accentColor, empty: 'Nessuna azione. Tocca + per aggiungerne una (es. Overwatch, Charge).' })}`;

  const wire = (root) => {
    root.querySelector('[data-import-pdf]').addEventListener('click', () => startPdfImport({ gameId: game.id }));
    onAdd(root, 'action', async () => {
      const v = await formSheet({
        title: 'Nuova azione',
        fields: [{ name: 'name', label: 'Nome', type: 'text', required: true }, colorField('')]
      });
      if (!v) return;
      await guard(async () => { await D.addAction(game.id, v.name, v.color); ctx.refresh(); });
    });
    onMenu(root, 'action', actions, (a) => entityMenu(a, {
      ctx, table: 'actions',
      extra: [{
        label: 'Anteprima sticker',
        run: () => { location.hash = `#/anteprima?action=${a.id}`; }
      }, {
        label: 'Colore accento',
        run: async () => {
          const v = await formSheet({ title: `Colore: ${a.name}`, fields: [colorField(a.accentColor)] });
          if (!v) return;
          await guard(async () => { await D.setActionColor(a.id, v.color); ctx.refresh(); });
        }
      }],
      rename: async () => {
        const v = await formSheet({ title: 'Rinomina azione', fields: [{ name: 'name', label: 'Nome', value: a.name, type: 'text', required: true }] });
        if (!v) return;
        await guard(async () => { await D.patch('actions', a.id, { name: v.name }); ctx.refresh(); });
      },
      remove: async () => {
        const ok = await confirmSheet({ title: `Eliminare «${a.name}»?`, confirmLabel: 'Elimina', danger: true });
        if (!ok) return;
        await guard(async () => { await D.deleteAction(a.id); toast('Eliminata'); ctx.refresh(); });
      }
    }));

    onAdd(root, 'faction', async () => {
      const v = await formSheet({ title: `Nuova ${lc(L.faction)}`, fields: [{ name: 'name', label: 'Nome', type: 'text', required: true }] });
      if (!v) return;
      await guard(async () => { await D.addFaction(game.id, v.name); ctx.refresh(); });
    });
    onMenu(root, 'faction', factions, (f) => entityMenu(f, {
      ctx, table: 'factions',
      rename: async () => {
        const v = await formSheet({ title: `Rinomina ${lc(L.faction)}`, fields: [{ name: 'name', label: 'Nome', value: f.name, type: 'text', required: true }] });
        if (!v) return;
        await guard(async () => { await D.patch('factions', f.id, { name: v.name }); ctx.refresh(); });
      },
      remove: async () => {
        const c = await D.countFactionContents(f.id);
        const ok = await confirmSheet({
          title: `Eliminare «${f.name}»?`,
          lines: countLines([[L.unit, c.units], [L.weapon, c.weapons], ['Carte', c.cards]]),
          confirmLabel: 'Elimina', danger: true
        });
        if (!ok) return;
        await guard(async () => { await D.deleteFaction(f.id); toast('Eliminato'); ctx.refresh(); });
      }
    }));
  };
  return { html, wire };
}

// ---------- livello 2: miniature (e armi) di una fazione ----------

async function factionScreen(ctx) {
  const { game, faction } = ctx;
  const L = game.labels;
  const [units, weapons, rules] = await Promise.all([D.listUnits(faction.id), D.listWeaponsOfFaction(faction.id), D.listRules(faction.id)]);
  const wThumb = await weaponThumbs(ctx, weapons);
  const html = `
    ${crumbs([{ label: 'Libreria', href: link() }, { label: game.name, href: link('g' + game.id) }, { label: faction.name }])}
    <h1>${esc(faction.name)}</h1>
    <div class="row"><button type="button" class="primary" data-import-pdf>Importa PDF squadra</button><button type="button" data-import-card>Importa carta</button></div>
    ${sectionHead(L.unit, 'unit')}
    ${listHTML('unit', units, { href: (u) => link('g' + game.id, 'f' + faction.id, 'u' + u.id), empty: `Vuoto. Tocca + per aggiungere: ${L.unit}.` })}
    ${sectionHead(`${L.weapon} della fazione`, 'weapon')}
    ${listHTML('weapon', weapons, { thumb: wThumb, meta: (w) => [KIND_LABEL[w.kind] || '', profileText(w), w.unitIds.length ? '' : 'non collegata'].filter(Boolean).join(' · '), empty: `Nessuna: aggiungila dalla scheda di una miniatura o con +.` })}
    ${rulesHTML(rules)}`;

  const wire = (root) => {
    root.querySelector('[data-import-card]').addEventListener('click', () => startCardImport({ gameId: game.id, factionId: faction.id }));
    root.querySelector('[data-import-pdf]').addEventListener('click', () => startPdfImport({ gameId: game.id, factionId: faction.id }));
    onAdd(root, 'unit', async () => {
      const v = await formSheet({ title: `Nuovo ${lc(L.unit)}`, fields: [{ name: 'name', label: 'Nome', type: 'text', required: true }] });
      if (!v) return;
      await guard(async () => { await D.addUnit(faction.id, v.name); ctx.refresh(); });
    });
    onMenu(root, 'unit', units, (u) => unitMenu(ctx, u, L, () => ctx.refresh()));

    onAdd(root, 'weapon', () => addWeaponForm(ctx, null, L));
    onMenu(root, 'weapon', weapons, (w) => weaponMenu(ctx, w, L, null));
  };
  return { html, wire };
}

// ---------- livello 3: scheda miniatura ----------

async function unitScreen(ctx) {
  const { game, faction, unit } = ctx;
  const L = game.labels;
  const weapons = await D.listWeaponsOfUnit(unit.id);
  const wThumb = await weaponThumbs(ctx, weapons);
  const imgRow = unit.imageId != null ? await D.getImage(unit.imageId) : null;
  const imgHTML = imgRow
    ? `<button type="button" class="img-box checker-bg" data-img-menu aria-label="Immagine di ${esc(unit.name)}: tocca per le opzioni"><img src="${blobUrl(ctx, imgRow.blob)}" alt="Immagine di ${esc(unit.name)}" data-revoke></button>`
    : `<button type="button" class="img-ph" data-img-import><span>Importa immagine</span><small>Foto o screenshot di una carta</small></button>`;
  const html = `
    ${crumbs([{ label: 'Libreria', href: link() }, { label: game.name, href: link('g' + game.id) }, { label: faction.name, href: link('g' + game.id, 'f' + faction.id) }, { label: unit.name }])}
    <div class="title-row">
      <h1>${unit.fav ? '<span class="star">★</span> ' : ''}${esc(unit.name)}</h1>
      <button type="button" class="kebab" data-unit-menu aria-label="Menu miniatura">⋮</button>
    </div>
    ${statsHTML(unit)}
    ${imgHTML}
    <h2>${esc(L.weapon)} (${weapons.length})</h2>
    ${listHTML('weapon', weapons, { href: (w) => `#/anteprima?unit=${unit.id}&weapon=${w.id}`, thumb: wThumb, meta: (w) => [KIND_LABEL[w.kind] || '', profileText(w)].filter(Boolean).join(' · '), empty: `Nessuna ${lc(L.weapon)} collegata.` })}
    ${textBlocksHTML(unit)}
    <div class="row">
      <button type="button" class="primary" data-preview-unit>Sticker solo ${esc(lc(L.unit))}</button>
    </div>
    <div class="row">
      <button type="button" data-import-card>Importa carta (profili ${esc(lc(L.weapon))})</button>
    </div>
    <div class="row">
      <button type="button" data-add-weapon>Aggiungi ${esc(lc(L.weapon))}</button>
      <button type="button" data-link-weapon>Collega ${esc(lc(L.weapon))} della fazione</button>
    </div>`;

  const wire = (root) => {
    root.querySelector('[data-unit-menu]').addEventListener('click', () => unitMenu(ctx, unit, L, () => ctx.refresh()));
    const imp = root.querySelector('[data-img-import]');
    if (imp) imp.addEventListener('click', () => imageFlow(ctx, 'unit', unit, 'pick'));
    const imgMenu = root.querySelector('[data-img-menu]');
    if (imgMenu) imgMenu.addEventListener('click', () => imageMenu(ctx, 'unit', unit, `Immagine di ${unit.name}`));
    root.querySelector('[data-import-card]').addEventListener('click', () => startCardImport({ gameId: game.id, factionId: faction.id, unitId: unit.id }));
    root.querySelector('[data-preview-unit]').addEventListener('click', () => { location.hash = `#/anteprima?unit=${unit.id}`; });
    root.querySelector('[data-add-weapon]').addEventListener('click', () => addWeaponForm(ctx, unit, L));
    root.querySelector('[data-link-weapon]').addEventListener('click', async () => {
      const all = await D.listWeaponsOfFaction(faction.id);
      if (!all.length) { toast(`La fazione non ha ${lc(L.weapon)}: aggiungine una`); return; }
      const v = await formSheet({
        title: `Collega ${lc(L.weapon)} della fazione`,
        fields: [{
          name: 'ids', label: `${L.weapon} di ${faction.name}`, type: 'checks',
          options: all.map((w) => ({ value: String(w.id), label: `${w.name} (${KIND_LABEL[w.kind] || ''})`, checked: w.unitIds.includes(unit.id) }))
        }]
      });
      if (!v) return;
      await guard(async () => { await D.setUnitWeapons(unit.id, v.ids.map(Number)); ctx.refresh(); });
    });
    onMenu(root, 'weapon', weapons, (w) => weaponMenu(ctx, w, L, unit));
  };
  return { html, wire };
}

// ---------- azioni condivise ----------

function unitMenu(ctx, u, L, after) {
  entityMenu(u, {
    ctx, table: 'units',
    rename: async () => {
      const v = await formSheet({ title: `Rinomina ${lc(L.unit)}`, fields: [{ name: 'name', label: 'Nome', value: u.name, type: 'text', required: true }] });
      if (!v) return;
      await guard(async () => { await D.patch('units', u.id, { name: v.name }); after(); });
    },
    remove: async () => {
      const p = await D.previewDeleteUnit(u.id);
      const lines = [];
      if (p.deleted) lines.push(`${L.weapon} collegate solo a questo elemento, che verranno eliminate: ${p.deleted}`);
      if (p.kept) lines.push(`${L.weapon} condivise con altri, che restano: ${p.kept}`);
      if (!lines.length) lines.push(`Nessuna ${lc(L.weapon)} collegata.`);
      const ok = await confirmSheet({ title: `Eliminare «${u.name}»?`, lines, confirmLabel: 'Elimina', danger: true });
      if (!ok) return;
      await guard(async () => {
        await D.deleteUnit(u.id);
        toast('Eliminato');
        // Se ero sulla scheda della miniatura torno alla fazione senza lasciare la scheda nello storico.
        if (ctx.unit && ctx.unit.id === u.id) location.replace(link('g' + ctx.game.id, 'f' + ctx.faction.id));
        else ctx.refresh();
      });
    }
  });
}

// ---------- immagini di miniature e armi ----------

// how: 'pick' = sceglie un file nuovo; 'recrop' = riapre l'immagine gia' ritagliata e salvata.
// Il selettore file va aperto subito dentro il tocco dell'utente: niente await prima di pickImage().
function imageFlow(ctx, kind, row, how) {
  return guard(async () => {
    let source;
    if (how === 'recrop') {
      const img = row.imageId != null ? await D.getImage(row.imageId) : null;
      if (!img) throw new Error('immagine non trovata');
      source = img.blob;
    } else {
      source = await pickImage();
      if (!source) return;
    }
    const out = await cropImage(source);
    if (!out) return; // annullato (Annulla o tasto indietro)
    await IMG_API[kind].set(row.id, out.blob, out.width, out.height, out.thumb);
    toast('Immagine salvata');
    ctx.refresh();
  });
}

function imageMenu(ctx, kind, row, title) {
  if (row.imageId == null) {
    menuSheet(title, [{ label: 'Importa immagine', run: () => imageFlow(ctx, kind, row, 'pick') }]);
    return;
  }
  menuSheet(title, [
    { label: 'Sostituisci', run: () => imageFlow(ctx, kind, row, 'pick') },
    { label: 'Ritaglia di nuovo', run: () => imageFlow(ctx, kind, row, 'recrop') },
    {
      label: 'Rimuovi', danger: true,
      run: async () => {
        const ok = await confirmSheet({ title: 'Rimuovere l\'immagine?', lines: ['L\'immagine ritagliata verrà eliminata.'], confirmLabel: 'Rimuovi', danger: true });
        if (!ok) return;
        await guard(async () => { await IMG_API[kind].remove(row.id); toast('Immagine rimossa'); ctx.refresh(); });
      }
    }
  ]);
}

async function addWeaponForm(ctx, unit, L) {
  const v = await formSheet({
    title: `Aggiungi ${lc(L.weapon)}`,
    fields: [
      { name: 'name', label: 'Nome', type: 'text', required: true },
      { name: 'kind', label: 'Tipo', type: 'select', value: 'ranged', options: KIND_OPTIONS }
    ]
  });
  if (!v) return;
  await guard(async () => {
    await D.addWeapon({ factionId: ctx.faction.id, unitId: unit ? unit.id : null, name: v.name, kind: v.kind });
    ctx.refresh();
  });
}

// unit: la miniatura da cui si sta guardando (per "Scollega"), oppure null dalla pagina fazione.
function weaponMenu(ctx, w, L, unit) {
  const extra = [{ label: `Immagine ${lc(L.weapon)}`, run: () => imageMenu(ctx, 'weapon', w, `Immagine: ${w.name}`) }];
  if (unit) extra.push({
    label: 'Scollega da questa miniatura',
    run: async () => { await guard(async () => { await D.unlinkWeapon(w.id, unit.id); toast('Scollegata'); ctx.refresh(); }); }
  });
  entityMenu(w, {
    ctx, table: 'weapons', extra,
    rename: async () => {
      const v = await formSheet({
        title: `Rinomina ${lc(L.weapon)}`,
        fields: [
          { name: 'name', label: 'Nome', value: w.name, type: 'text', required: true },
          { name: 'kind', label: 'Tipo', type: 'select', value: w.kind, options: KIND_OPTIONS }
        ]
      });
      if (!v) return;
      await guard(async () => { await D.patch('weapons', w.id, { name: v.name, kind: v.kind }); ctx.refresh(); });
    },
    remove: async () => {
      const ok = await confirmSheet({
        title: `Eliminare «${w.name}»?`,
        lines: w.unitIds.length > 1 ? [`Verrà tolta da tutte le miniature a cui è collegata (${w.unitIds.length}).`] : [],
        confirmLabel: 'Elimina', danger: true
      });
      if (!ok) return;
      await guard(async () => { await D.deleteWeapon(w.id); toast('Eliminata'); ctx.refresh(); });
    }
  });
}
