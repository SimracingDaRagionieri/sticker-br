// Database IndexedDB (Dexie 4). Dexie arriva come script classico (vendor/dexie.min.js)
// caricato da index.html prima dei moduli, quindi qui e' disponibile come globale.

const Dexie = globalThis.Dexie;
if (!Dexie) throw new Error('Dexie non caricato: manca vendor/dexie.min.js');

export const db = new Dexie('sticker-br');

db.version(1).stores({
  games: '++id, name',
  factions: '++id, gameId, name',
  units: '++id, factionId, gameId, name, fav, lastUsed',
  weapons: '++id, factionId, *unitIds, name, fav, lastUsed',
  actions: '++id, gameId, name, fav, lastUsed',
  images: '++id, kind, cardId',
  cards: '++id, factionId, createdAt',
  templates: '++id, kind',
  fonts: '++id, family',
  recents: '++id, &key, usedAt',
  settings: 'key'
});

// Versione 2 (Passo 6): tabella rules (regola di fazione, stratagemmi, equipaggiamento). Ripete tutte le tabelle della v1.
db.version(2).stores({
  games: '++id, name',
  factions: '++id, gameId, name',
  units: '++id, factionId, gameId, name, fav, lastUsed',
  weapons: '++id, factionId, *unitIds, name, fav, lastUsed',
  actions: '++id, gameId, name, fav, lastUsed',
  images: '++id, kind, cardId',
  cards: '++id, factionId, createdAt',
  templates: '++id, kind',
  fonts: '++id, family',
  recents: '++id, &key, usedAt',
  settings: 'key',
  rules: '++id, factionId, kind, name'
});

// ---------- utilita' ----------

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export const byName = (a, b) => collator.compare(a.name, b.name);

function cleanName(name) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('Il nome non puo\' essere vuoto');
  return n;
}

const DEFAULT_LABELS = { faction: 'Fazione', unit: 'Unità', weapon: 'Arma' };
function cleanLabels(labels = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_LABELS)) out[k] = String(labels[k] ?? '').trim() || DEFAULT_LABELS[k];
  return out;
}

const nextOrder = (rows) => rows.reduce((m, r) => Math.max(m, r.order ?? 0), -1) + 1;

export const WEAPON_KINDS = ['ranged', 'melee', 'other'];

// ---------- primo avvio ----------

const SEED_GAMES = [
  { name: 'Kill Team', labels: { faction: 'Squadra', unit: 'Operativo', weapon: 'Arma' } },
  { name: 'Warhammer 40,000', labels: { faction: 'Esercito', unit: 'Unità', weapon: 'Arma' } },
  { name: 'The Old World', labels: { faction: 'Esercito', unit: 'Unità', weapon: 'Arma' } }
];

// Template predefiniti (tabella templates). Config come in SPEC.md sezione 2.
// "Azione" non definisce plate.border: se l'azione ha un colore accento, diventa il bordo della targa.
const SEED_TEMPLATES = [
  {
    key: 'activation', name: 'Attivazione', kind: 'activation',
    config: {
      width: 1080, padding: 24, trim: true,
      plate: { show: false, color: '#111111', opacity: 0.85, radius: 20, padding: 28, border: { width: 4, color: '#E8B04A' } },
      image: { show: true, side: 'left', height: 220, radius: 12, border: { width: 3, color: '#FFFFFF' } },
      weaponImage: { show: true, position: 'below', maxHeight: 240, replaceText: true, radius: 10 },
      lines: [
        { source: 'unit', font: 'Bebas Neue', size: 96, minSize: 56, color: '#FFFFFF', stroke: { width: 6, color: '#000000' }, shadow: true, upper: true, align: 'left' },
        { source: 'weapon', font: 'Oswald', weight: 500, size: 60, minSize: 36, color: '#E8B04A', stroke: { width: 4, color: '#000000' }, shadow: false, upper: false, align: 'left' }
      ]
    }
  },
  {
    key: 'textonly', name: 'Solo testo', kind: 'activation',
    config: {
      width: 1080, padding: 24, trim: true,
      plate: { show: false, color: '#111111', opacity: 0.85, radius: 20, padding: 28 },
      image: { show: false, side: 'left', height: 220, radius: 12, border: { width: 3, color: '#FFFFFF' } },
      weaponImage: { show: false, position: 'below', maxHeight: 240, replaceText: true, radius: 10 },
      lines: [
        { source: 'unit', font: 'Bebas Neue', size: 96, minSize: 56, color: '#FFFFFF', stroke: { width: 6, color: '#000000' }, shadow: true, upper: true, align: 'left' },
        { source: 'weapon', font: 'Oswald', weight: 500, size: 60, minSize: 36, color: '#E8B04A', stroke: { width: 4, color: '#000000' }, shadow: true, upper: false, align: 'left' }
      ]
    }
  },
  {
    key: 'action', name: 'Azione', kind: 'action',
    config: {
      width: 1080, padding: 24, trim: true,
      plate: { show: true, color: '#111111', opacity: 0.85, radius: 20, padding: 28 },
      image: { show: false, side: 'left', height: 140, radius: 12 },
      weaponImage: { show: false, position: 'below', maxHeight: 200 },
      lines: [
        { source: 'action', font: 'Bebas Neue', size: 120, minSize: 60, color: '#FFFFFF', stroke: { width: 6, color: '#000000' }, shadow: true, upper: true, align: 'center' }
      ]
    }
  }
];

let readyPromise = null;

// Apre il database, crea i dati iniziali (una sola volta) e chiede l'archiviazione persistente.
export function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  await db.open();
  let first = false;
  await db.transaction('rw', db.games, db.settings, async () => {
    if (await db.settings.get('seeded')) return;
    first = true;
    for (let i = 0; i < SEED_GAMES.length; i++) {
      await db.games.add({ ...SEED_GAMES[i], order: i, fav: 0 });
    }
    await db.settings.put({ key: 'seeded', value: 1 });
  });
  await seedTemplates();
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      if (first || !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (err) {
      console.warn('storage.persist non riuscito', err);
    }
  }
}

// Una sola volta (settings.seededTemplates), anche per chi aveva gia' i giochi del Passo 2.
async function seedTemplates() {
  await db.transaction('rw', db.templates, db.settings, async () => {
    if (!(await db.settings.get('seededTemplates'))) {
      const defaults = {};
      for (const t of SEED_TEMPLATES) {
        const id = await db.templates.add({ name: t.name, kind: t.kind, config: structuredClone(t.config) });
        if (!(t.kind in defaults)) defaults[t.kind] = id;
      }
      const prev = await db.settings.get('defaultTemplates');
      await db.settings.put({ key: 'defaultTemplates', value: { ...defaults, ...(prev ? prev.value : {}) } });
      await db.settings.put({ key: 'seededTemplates', value: 1 });
      await db.settings.put({ key: 'templatesRev', value: 2 });
      return;
    }
    // Revisione 2 (Passo 4, dopo la prova): targa spenta in "Attivazione" e profilo arma al posto del nome.
    // Gli editor dei template arrivano al Passo 7, quindi i predefiniti non sono ancora modificabili dall'utente.
    const rev = await db.settings.get('templatesRev');
    if (!rev || rev.value < 2) {
      for (const t of SEED_TEMPLATES) {
        const row = await db.templates.where('kind').equals(t.kind).filter((r) => r.name === t.name).first();
        if (row) await db.templates.update(row.id, { config: structuredClone(t.config) });
      }
      await db.settings.put({ key: 'templatesRev', value: 2 });
    }
  });
}

// ---------- lettura ----------

export const getGame = (id) => db.games.get(id);
export const getFaction = (id) => db.factions.get(id);
export const getUnit = (id) => db.units.get(id);
export const getWeapon = (id) => db.weapons.get(id);

export async function listGames() { return (await db.games.toArray()).sort(byName); }
export async function listFactions(gameId) { return (await db.factions.where('gameId').equals(gameId).toArray()).sort(byName); }
export async function listUnits(factionId) { return (await db.units.where('factionId').equals(factionId).toArray()).sort(byName); }
export async function listWeaponsOfFaction(factionId) { return (await db.weapons.where('factionId').equals(factionId).toArray()).sort(byName); }
export async function listWeaponsOfUnit(unitId) { return (await db.weapons.where('unitIds').equals(unitId).toArray()).sort(byName); }

// ---------- template e uso degli sticker ----------

export const TEMPLATE_KINDS = ['activation', 'action'];

export async function listTemplates(kind) {
  const rows = kind ? await db.templates.where('kind').equals(kind).toArray() : await db.templates.toArray();
  return rows.sort((a, b) => a.id - b.id);
}

export const getTemplate = (id) => db.templates.get(id);

// Template predefinito del tipo (settings.defaultTemplates); se manca o e' stato eliminato, il primo del tipo.
export async function getDefaultTemplate(kind) {
  const s = await db.settings.get('defaultTemplates');
  const id = s && s.value ? s.value[kind] : null;
  const row = id != null ? await db.templates.get(id) : null;
  if (row && row.kind === kind) return row;
  return (await listTemplates(kind))[0] || null;
}

// Tutto cio' che serve a disegnare uno sticker: righe del database e Blob delle immagini.
export async function getStickerSource({ unitId = null, weaponId = null, actionId = null }) {
  const [unit, weapon, action] = await Promise.all([
    unitId != null ? db.units.get(unitId) : null,
    weaponId != null ? db.weapons.get(weaponId) : null,
    actionId != null ? db.actions.get(actionId) : null
  ]);
  const factionId = unit ? unit.factionId : weapon ? weapon.factionId : null;
  const faction = factionId != null ? await db.factions.get(factionId) : null;
  const gameId = faction ? faction.gameId : action ? action.gameId : null;
  const game = gameId != null ? await db.games.get(gameId) : null;
  const imgIds = [unit && unit.imageId, weapon && weapon.imageId].filter((x) => x != null);
  const imgs = await getImagesById(imgIds);
  const blobOf = (row) => (row && row.imageId != null && imgs.get(row.imageId) ? imgs.get(row.imageId).blob : null);
  return { unit, weapon, action, faction, game, unitImage: blobOf(unit), weaponImage: blobOf(weapon) };
}

const MAX_RECENTS = 30;

// Dopo Salva/Condividi: aggiorna lastUsed/useCount e la tabella recents (chiave unica, massimo 30).
export async function recordUse({ unitId = null, weaponId = null, actionId = null, templateId = null }) {
  const now = Date.now();
  const key = [
    unitId != null ? 'u' + unitId : '', weaponId != null ? 'w' + weaponId : '',
    actionId != null ? 'a' + actionId : '', templateId != null ? 't' + templateId : ''
  ].filter(Boolean).join('-');
  if (!key) return;
  await db.transaction('rw', db.units, db.weapons, db.actions, db.recents, async () => {
    if (unitId != null) {
      const u = await db.units.get(unitId);
      if (u) await db.units.update(unitId, { lastUsed: now, useCount: (u.useCount || 0) + 1 });
    }
    if (weaponId != null) await db.weapons.update(weaponId, { lastUsed: now });
    if (actionId != null) await db.actions.update(actionId, { lastUsed: now });
    const row = { key, unitId, weaponId, actionId, templateId, usedAt: now };
    const old = await db.recents.where('key').equals(key).first();
    if (old) await db.recents.update(old.id, row);
    else await db.recents.add(row);
    const extra = (await db.recents.count()) - MAX_RECENTS;
    if (extra > 0) {
      const ids = await db.recents.orderBy('usedAt').limit(extra).primaryKeys();
      await db.recents.bulkDelete(ids);
    }
  });
}

// ---------- immagini (tabella images) ----------

export const getImage = (id) => db.images.get(id);

// Restituisce una Map id -> riga images (gli id mancanti non compaiono).
export async function getImagesById(ids) {
  const rows = await db.images.bulkGet(ids);
  const map = new Map();
  rows.forEach((r) => { if (r) map.set(r.id, r); });
  return map;
}

// Crea il nuovo record, punta il proprietario (unita' o arma) al nuovo id ed elimina il vecchio record.
// thumb (opzionale): miniatura PNG piccola per gli elenchi, cosi' non si decodificano le immagini grandi.
async function replaceImage(table, kind, ownerId, blob, width, height, thumb) {
  if (!(blob instanceof Blob)) throw new Error('Immagine non valida');
  return db.transaction('rw', db[table], db.images, async () => {
    const row = await db[table].get(ownerId);
    if (!row) throw new Error('Elemento non trovato');
    const id = await db.images.add({ kind, blob, width, height, thumb: thumb || null, createdAt: Date.now() });
    await db[table].update(ownerId, { imageId: id });
    if (row.imageId != null) await db.images.delete(row.imageId);
    return id;
  });
}

async function dropImage(table, ownerId) {
  await db.transaction('rw', db[table], db.images, async () => {
    const row = await db[table].get(ownerId);
    if (!row) return;
    if (row.imageId != null) await db.images.delete(row.imageId);
    await db[table].update(ownerId, { imageId: null });
  });
}

export const setUnitImage = (unitId, blob, width, height, thumb) => replaceImage('units', 'unit', unitId, blob, width, height, thumb);
export const removeUnitImage = (unitId) => dropImage('units', unitId);
export const setWeaponImage = (weaponId, blob, width, height, thumb) => replaceImage('weapons', 'weapon', weaponId, blob, width, height, thumb);
export const removeWeaponImage = (weaponId) => dropImage('weapons', weaponId);

// Diagnostica: immagini di miniature/armi non referenziate da nessuna riga (non dovrebbero esistere).
export async function imageStats() {
  const [images, units, weapons] = await Promise.all([db.images.toArray(), db.units.toArray(), db.weapons.toArray()]);
  const used = new Set([...units, ...weapons].map((x) => x.imageId).filter((x) => x != null));
  const own = images.filter((i) => i.kind === 'unit' || i.kind === 'weapon');
  return {
    total: images.length,
    unit: images.filter((i) => i.kind === 'unit').length,
    weapon: images.filter((i) => i.kind === 'weapon').length,
    orphans: own.filter((i) => !used.has(i.id)).length
  };
}

// ---------- icone di riferimento per il riconoscimento delle carte (Passo 5) ----------
// settings.iconTemplates = { [gameId]: { ranged?: Blob, melee?: Blob } }  (PNG in grigio alla scala di lavoro)

export async function getIconTemplates(gameId) {
  const s = await db.settings.get('iconTemplates');
  return (s && s.value && s.value[gameId]) || {};
}

// parts: { ranged?: Blob, melee?: Blob }; unisce alle icone gia' salvate del gioco.
export async function setIconTemplates(gameId, parts) {
  await db.transaction('rw', db.settings, async () => {
    const s = await db.settings.get('iconTemplates');
    const all = { ...(s ? s.value : {}) };
    all[gameId] = { ...(all[gameId] || {}), ...parts };
    await db.settings.put({ key: 'iconTemplates', value: all });
  });
}

export async function clearIconTemplates(gameId) {
  await db.transaction('rw', db.settings, async () => {
    const s = await db.settings.get('iconTemplates');
    if (!s || !s.value || !(gameId in s.value)) return;
    const all = { ...s.value };
    delete all[gameId];
    await db.settings.put({ key: 'iconTemplates', value: all });
  });
}

// ---------- scrittura generica ----------

// Modifica campi di un record (nome, accentColor, ecc.).
export async function patch(table, id, changes) {
  const c = { ...changes };
  if ('name' in c) c.name = cleanName(c.name);
  if ('labels' in c) c.labels = cleanLabels(c.labels);
  await db[table].update(id, c);
}

// Preferito: booleano salvato come 0/1.
export async function toggleFav(table, id) {
  const row = await db[table].get(id);
  if (!row) return;
  await db[table].update(id, { fav: row.fav ? 0 : 1 });
}

// ---------- giochi ----------

export async function addGame(name, labels) {
  const order = nextOrder(await db.games.toArray());
  return db.games.add({ name: cleanName(name), labels: cleanLabels(labels), order, fav: 0 });
}

// ---------- fazioni ----------

export async function addFaction(gameId, name) {
  const order = nextOrder(await db.factions.where('gameId').equals(gameId).toArray());
  return db.factions.add({ gameId, name: cleanName(name), order, accentColor: null, fav: 0 });
}

// ---------- azioni ----------

// Colore accento: stringa '#rrggbb' oppure null (nessun colore). Campo senza indice.
function cleanColor(color) {
  const c = String(color ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
}

export async function listActions(gameId) { return (await db.actions.where('gameId').equals(gameId).toArray()).sort(byName); }

export async function addAction(gameId, name, accentColor = null) {
  if (!(await db.games.get(gameId))) throw new Error('Gioco non trovato');
  return db.actions.add({ gameId, name: cleanName(name), accentColor: cleanColor(accentColor), fav: 0, lastUsed: 0 });
}

export async function deleteAction(id) { await db.actions.delete(id); }

export async function setActionColor(id, accentColor) {
  await db.actions.update(id, { accentColor: cleanColor(accentColor) });
}

// ---------- miniature ----------

export async function addUnit(factionId, name) {
  const faction = await db.factions.get(factionId);
  if (!faction) throw new Error('Fazione non trovata');
  return db.units.add({
    factionId, gameId: faction.gameId, name: cleanName(name),
    imageId: null, fav: 0, lastUsed: 0, useCount: 0
  });
}

// ---------- armi ----------

// unitId opzionale: se presente l'arma nasce collegata a quella miniatura.
export async function addWeapon({ factionId, unitId = null, name, kind = 'other' }) {
  return db.weapons.add({
    factionId, unitIds: unitId == null ? [] : [unitId], name: cleanName(name),
    kind: WEAPON_KINDS.includes(kind) ? kind : 'other',
    imageId: null, fav: 0, lastUsed: 0
  });
}

// Imposta esattamente quali armi della fazione sono collegate alla miniatura.
// Le armi scollegate restano nella fazione anche se non hanno piu' miniature.
export async function setUnitWeapons(unitId, weaponIds) {
  const want = new Set(weaponIds);
  await db.transaction('rw', db.units, db.weapons, async () => {
    const unit = await db.units.get(unitId);
    if (!unit) return;
    const weapons = await db.weapons.where('factionId').equals(unit.factionId).toArray();
    for (const w of weapons) {
      const has = w.unitIds.includes(unitId);
      if (want.has(w.id) && !has) await db.weapons.update(w.id, { unitIds: [...w.unitIds, unitId] });
      else if (!want.has(w.id) && has) await db.weapons.update(w.id, { unitIds: w.unitIds.filter((x) => x !== unitId) });
    }
  });
}

export async function unlinkWeapon(weaponId, unitId) {
  const w = await db.weapons.get(weaponId);
  if (w) await db.weapons.update(weaponId, { unitIds: w.unitIds.filter((x) => x !== unitId) });
}

export async function deleteWeapon(id) {
  await db.transaction('rw', db.weapons, db.images, async () => {
    const w = await db.weapons.get(id);
    if (!w) return;
    if (w.imageId != null) await db.images.delete(w.imageId);
    await db.weapons.delete(id);
  });
}

// ---------- conteggi per le conferme di eliminazione ----------

export async function countGameContents(id) {
  const factionIds = await db.factions.where('gameId').equals(id).primaryKeys();
  const [units, weapons, actions, cards] = await Promise.all([
    db.units.where('gameId').equals(id).count(),
    db.weapons.where('factionId').anyOf(factionIds).count(),
    db.actions.where('gameId').equals(id).count(),
    db.cards.where('factionId').anyOf(factionIds).count()
  ]);
  return { factions: factionIds.length, units, weapons, actions, cards };
}

export async function countFactionContents(id) {
  const [units, weapons, cards] = await Promise.all([
    db.units.where('factionId').equals(id).count(),
    db.weapons.where('factionId').equals(id).count(),
    db.cards.where('factionId').equals(id).count()
  ]);
  return { units, weapons, cards };
}

// Armi che verrebbero eliminate (collegate solo a questa miniatura) e armi condivise che restano.
export async function previewDeleteUnit(id) {
  const weapons = await db.weapons.where('unitIds').equals(id).toArray();
  const orphaned = weapons.filter((w) => w.unitIds.every((x) => x === id));
  return { deleted: orphaned.length, kept: weapons.length - orphaned.length };
}

// ---------- eliminazione a cascata ----------

// Da chiamare dentro una transazione su tutte le tabelle.
async function purgeFactions(factionIds) {
  if (!factionIds.length) return;
  const units = await db.units.where('factionId').anyOf(factionIds).toArray();
  const weapons = await db.weapons.where('factionId').anyOf(factionIds).toArray();
  const cardIds = await db.cards.where('factionId').anyOf(factionIds).primaryKeys();
  const imageIds = new Set([...units, ...weapons].map((x) => x.imageId).filter((x) => x != null));
  if (cardIds.length) (await db.images.where('cardId').anyOf(cardIds).primaryKeys()).forEach((k) => imageIds.add(k));
  await db.images.bulkDelete([...imageIds]);
  await db.rules.where('factionId').anyOf(factionIds).delete();
  await db.cards.bulkDelete(cardIds);
  await db.weapons.bulkDelete(weapons.map((w) => w.id));
  await db.units.bulkDelete(units.map((u) => u.id));
  await db.factions.bulkDelete(factionIds);
}

export async function deleteFaction(id) {
  await db.transaction('rw', db.tables, () => purgeFactions([id]));
}

export async function deleteGame(id) {
  await db.transaction('rw', db.tables, async () => {
    const factionIds = await db.factions.where('gameId').equals(id).primaryKeys();
    await purgeFactions(factionIds);
    await db.actions.where('gameId').equals(id).delete();
    await db.games.delete(id);
  });
}

// Toglie la miniatura dalle sue armi; elimina solo le armi rimaste senza miniature.
export async function deleteUnit(id) {
  await db.transaction('rw', db.tables, async () => {
    const unit = await db.units.get(id);
    if (!unit) return;
    const weapons = await db.weapons.where('unitIds').equals(id).toArray();
    const imageIds = [];
    for (const w of weapons) {
      const rest = w.unitIds.filter((x) => x !== id);
      if (rest.length) {
        await db.weapons.update(w.id, { unitIds: rest });
      } else {
        if (w.imageId != null) imageIds.push(w.imageId);
        await db.weapons.delete(w.id);
      }
    }
    if (unit.imageId != null) imageIds.push(unit.imageId);
    await db.images.bulkDelete(imageIds);
    await db.units.delete(id);
  });
}


// ---------- import PDF squadra (Passo 6) ----------
// Campi extra senza indice (schema v1 invariato): units.stats/keywords/abilities/actions/source, weapons.profile.
// Tabella rules (v2): { factionId, kind: factionRule|ploy-strategy|ploy-firefight|equipment, name, cost, text, page, source:'pdf' }.

export const RULE_KINDS = ['factionRule', 'ploy-strategy', 'ploy-firefight', 'equipment'];
export async function listRules(factionId) {
  return (await db.rules.where('factionId').equals(factionId).toArray()).sort((a, b) => a.id - b.id);
}
export const countRules = (factionId) => db.rules.where('factionId').equals(factionId).count();

const sameKey = (a, b) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim() === String(b || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Cerca la fazione per nome nel gioco (senza crearla).
export async function findFactionByName(gameId, name) {
  return (await db.factions.where('gameId').equals(gameId).toArray()).find((f) => sameKey(f.name, name)) || null;
}

// Riepilogo di cio' che l'import fara' (senza scrivere): serve alla revisione e alla conferma sulle immagini.
// `match` = funzione (existingWeaponRows, groups) -> array id|null (pdfteam.matchWeaponGroups).
export async function previewTeamSave({ gameId, factionId, team, groups, match }) {
  const faction = factionId != null ? await db.factions.get(factionId) : await findFactionByName(gameId, team.faction.name);
  const out = { factionExists: !!faction, factionId: faction ? faction.id : null, unitsNew: 0, unitsUpdated: 0, weaponsNew: 0, weaponsUpdated: 0, weaponImages: [], unitImages: [] };
  if (!faction) {
    out.unitsNew = team.operatives.length; out.weaponsNew = groups.length;
    return out;
  }
  const units = await db.units.where('factionId').equals(faction.id).toArray();
  const weapons = await db.weapons.where('factionId').equals(faction.id).toArray();
  for (const op of team.operatives) {
    const u = units.find((x) => sameKey(x.name, op.name));
    if (u) { out.unitsUpdated++; if (u.imageId != null) out.unitImages.push(op.name); } else out.unitsNew++;
  }
  const ids = match(weapons, groups);
  ids.forEach((id, i) => {
    if (id == null) { out.weaponsNew++; return; }
    out.weaponsUpdated++;
    const w = weapons.find((x) => x.id === id);
    if (w && w.imageId != null) out.weaponImages.push(i);
  });
  return out;
}

// Salva la squadra rivista. Una sola transazione: o tutto o niente.
// opts: { gameId, factionId|null, team, groups, match, images: { weapons: Map(groupIndex -> {blob,width,height,thumb}), units: Map(opName -> {...}) },
//         replaceWeaponImages: Set(groupIndex)|'all', replaceUnitImages: Set(opName)|'all' }
export async function saveTeam(opts) {
  const { gameId, team, groups, match, images = { weapons: new Map(), units: new Map() } } = opts;
  const want = (set, key) => set === 'all' || (set instanceof Set && set.has(key));
  const sum = { factionId: null, unitsNew: 0, unitsUpdated: 0, weaponsNew: 0, weaponsUpdated: 0, imagesSaved: 0, imagesKept: 0, rules: 0 };
  await db.transaction('rw', db.tables, async () => {
    const game = await db.games.get(gameId);
    if (!game) throw new Error('Gioco non trovato');
    let faction = opts.factionId != null ? await db.factions.get(opts.factionId) : await findFactionByName(gameId, team.faction.name);
    if (!faction) {
      const id = await addFaction(gameId, team.faction.name);
      faction = await db.factions.get(id);
    }
    sum.factionId = faction.id;
    if (team.faction.keywords && team.faction.keywords.length) await db.factions.update(faction.id, { keywords: team.faction.keywords });

    // miniature
    const units = await db.units.where('factionId').equals(faction.id).toArray();
    const unitId = new Map();
    for (const op of team.operatives) {
      const fields = {
        stats: { ...op.stats }, keywords: [...op.keywords],
        abilities: op.abilities.map((a) => ({ name: a.name, text: a.text })),
        actions: op.actions.map((a) => ({ name: a.name, cost: a.cost, text: a.text })),
        source: 'pdf'
      };
      const u = units.find((x) => sameKey(x.name, op.name));
      if (u) { await db.units.update(u.id, fields); unitId.set(op.name, u.id); sum.unitsUpdated++; }
      else {
        const id = await db.units.add({ factionId: faction.id, gameId: faction.gameId, name: cleanName(op.name), imageId: null, fav: 0, lastUsed: 0, useCount: 0, ...fields });
        unitId.set(op.name, id); sum.unitsNew++;
      }
    }

    // armi: stessa arma e stesso profilo su piu' operativi = una riga collegata a tutti
    const existing = await db.weapons.where('factionId').equals(faction.id).toArray();
    const ids = match(existing, groups);
    const weaponId = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const display = g.mode ? `${g.name} (${g.mode})` : g.name;
      const linked = g.operatives.map((n) => unitId.get(n)).filter((x) => x != null);
      const row = ids[i] != null ? existing.find((x) => x.id === ids[i]) : null;
      if (row) {
        const unitIds = [...new Set([...(row.unitIds || []), ...linked])];
        const changes = { name: display, unitIds, profile: { ...g.profile, rules: [...g.profile.rules] } };
        if (g.kind && g.kind !== 'other') changes.kind = g.kind; else if (!row.kind) changes.kind = 'other';
        await db.weapons.update(row.id, changes);
        weaponId.push(row.id); sum.weaponsUpdated++;
      } else {
        const id = await db.weapons.add({
          factionId: faction.id, unitIds: [...new Set(linked)], name: cleanName(display),
          kind: WEAPON_KINDS.includes(g.kind) ? g.kind : 'other', imageId: null, fav: 0, lastUsed: 0,
          profile: { ...g.profile, rules: [...g.profile.rules] }
        });
        weaponId.push(id); sum.weaponsNew++;
      }
    }

    // immagini: mai sostituire senza consenso
    const putImage = async (table, ownerId, kind, img, replace) => {
      const row = await db[table].get(ownerId);
      if (row.imageId != null && !replace) { sum.imagesKept++; return; }
      const id = await db.images.add({ kind, blob: img.blob, width: img.width, height: img.height, thumb: img.thumb || null, createdAt: Date.now() });
      await db[table].update(ownerId, { imageId: id });
      if (row.imageId != null) await db.images.delete(row.imageId);
      sum.imagesSaved++;
    };
    for (const [i, img] of images.weapons) if (weaponId[i] != null) await putImage('weapons', weaponId[i], 'weapon', img, want(opts.replaceWeaponImages, i));
    for (const [n, img] of images.units) if (unitId.has(n)) await putImage('units', unitId.get(n), 'unit', img, want(opts.replaceUnitImages, n));

    // regole: l'import precedente (source 'pdf') viene sostituito, cosi' non nascono doppioni
    await db.rules.where('factionId').equals(faction.id).filter((r) => r.source === 'pdf').delete();
    const rows = [
      ...team.factionRule.map((r) => ({ kind: 'factionRule', name: r.name, cost: null, text: r.text, page: r.page })),
      ...team.ploys.map((r) => ({ kind: r.kind === 'strategy' ? 'ploy-strategy' : 'ploy-firefight', name: r.name, cost: r.cost, text: r.text, page: r.page })),
      ...team.equipment.map((r) => ({ kind: 'equipment', name: r.name, cost: null, text: r.text, page: r.page }))
    ].map((r) => ({ factionId: faction.id, source: 'pdf', ...r }));
    if (rows.length) await db.rules.bulkAdd(rows);
    sum.rules = rows.length;
  });
  return sum;
}
