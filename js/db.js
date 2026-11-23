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
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      if (first || !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch (err) {
      console.warn('storage.persist non riuscito', err);
    }
  }
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
