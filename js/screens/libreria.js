// Libreria: giochi > fazioni > miniature > scheda miniatura (con armi).
// Route a hash: #/libreria, #/libreria/g1, #/libreria/g1/f2, #/libreria/g1/f2/u3

import * as D from '../db.js';
import { toast } from '../app.js';
import { esc, menuSheet, confirmSheet, formSheet } from '../ui.js';

const KIND_LABEL = { ranged: 'A distanza', melee: 'Mischia', other: 'Altro' };
const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
const lc = (s) => String(s || '').toLowerCase();
const link = (...parts) => '#/libreria' + parts.map((p) => '/' + p).join('');

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
  const ctx = { el, refresh, game, faction, unit };

  let html, wire;
  if (unit) ({ html, wire } = await unitScreen(ctx));
  else if (faction) ({ html, wire } = await factionScreen(ctx));
  else if (game) ({ html, wire } = await gameScreen(ctx));
  else ({ html, wire } = await gamesScreen(ctx));

  if (my !== token) return; // nel frattempo l'utente e' andato altrove
  el.innerHTML = html;
  wire(el);
  window.scrollTo(0, 0);
}

// ---------- componenti ----------

function crumbs(parts) {
  return `<nav class="crumbs" aria-label="Percorso">${parts.map((p, i) =>
    i < parts.length - 1 ? `<a href="${p.href}">${esc(p.label)}</a><span class="sep">›</span>` : `<span class="cur">${esc(p.label)}</span>`
  ).join('')}</nav>`;
}

function sectionHead(title, key) {
  return `<div class="section-head"><h2>${esc(title)}</h2>
    <button type="button" class="add" data-add="${key}" aria-label="Aggiungi">+</button></div>`;
}

function listHTML(key, items, { href, meta, empty }) {
  if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<ul class="list" data-list="${key}">${items.map((it) => `
    <li class="item">
      ${href ? `<a class="item-main" href="${href(it)}">` : '<div class="item-main">'}
        <span class="item-name">${it.fav ? '<span class="star">★</span> ' : ''}${esc(it.name)}</span>
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
  const factions = await D.listFactions(game.id);
  const L = game.labels;
  const html = `
    ${crumbs([{ label: 'Libreria', href: link() }, { label: game.name }])}
    <h1>${esc(game.name)}</h1>
    ${sectionHead(L.faction, 'faction')}
    ${listHTML('faction', factions, { href: (f) => link('g' + game.id, 'f' + f.id), empty: `Vuoto. Tocca + per aggiungere: ${L.faction}.` })}`;

  const wire = (root) => {
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
  const [units, weapons] = await Promise.all([D.listUnits(faction.id), D.listWeaponsOfFaction(faction.id)]);
  const html = `
    ${crumbs([{ label: 'Libreria', href: link() }, { label: game.name, href: link('g' + game.id) }, { label: faction.name }])}
    <h1>${esc(faction.name)}</h1>
    ${sectionHead(L.unit, 'unit')}
    ${listHTML('unit', units, { href: (u) => link('g' + game.id, 'f' + faction.id, 'u' + u.id), empty: `Vuoto. Tocca + per aggiungere: ${L.unit}.` })}
    ${sectionHead(`${L.weapon} della fazione`, 'weapon')}
    ${listHTML('weapon', weapons, { meta: (w) => `${KIND_LABEL[w.kind] || ''}${w.unitIds.length ? '' : ' · non collegata'}`, empty: `Nessuna: aggiungila dalla scheda di una miniatura o con +.` })}`;

  const wire = (root) => {
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
  const html = `
    ${crumbs([{ label: 'Libreria', href: link() }, { label: game.name, href: link('g' + game.id) }, { label: faction.name, href: link('g' + game.id, 'f' + faction.id) }, { label: unit.name }])}
    <div class="title-row">
      <h1>${unit.fav ? '<span class="star">★</span> ' : ''}${esc(unit.name)}</h1>
      <button type="button" class="kebab" data-unit-menu aria-label="Menu miniatura">⋮</button>
    </div>
    <div class="img-ph" role="img" aria-label="Segnaposto immagine"><span>Immagine</span><small>Si potrà aggiungere più avanti</small></div>
    <h2>${esc(L.weapon)} (${weapons.length})</h2>
    ${listHTML('weapon', weapons, { meta: (w) => KIND_LABEL[w.kind] || '', empty: `Nessuna ${lc(L.weapon)} collegata.` })}
    <div class="row">
      <button type="button" class="primary" data-add-weapon>Aggiungi ${esc(lc(L.weapon))}</button>
      <button type="button" data-link-weapon>Collega ${esc(lc(L.weapon))} della fazione</button>
    </div>`;

  const wire = (root) => {
    root.querySelector('[data-unit-menu]').addEventListener('click', () => unitMenu(ctx, unit, L, () => ctx.refresh()));
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
  const extra = unit ? [{
    label: 'Scollega da questa miniatura',
    run: async () => { await guard(async () => { await D.unlinkWeapon(w.id, unit.id); toast('Scollegata'); ctx.refresh(); }); }
  }] : [];
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
