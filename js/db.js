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

// Versione 3 (Passo 10): log della partita. Ripete tutte le tabelle della v2.
db.version(3).stores({
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
  rules: '++id, factionId, kind, name',
  matches: '++id, gameId, status, startedAt',
  matchUnits: '++id, matchId, side',
  matchEvents: '++id, matchId, [matchId+seq]'
});

// Versione 4 (Passo 11): coda degli sticker gia' disegnati (PNG in attesa di Salva tutti / Condividi tutti).
// Ripete tutte le tabelle della v3.
db.version(4).stores({
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
  rules: '++id, factionId, kind, name',
  matches: '++id, gameId, status, startedAt',
  matchUnits: '++id, matchId, side',
  matchEvents: '++id, matchId, [matchId+seq]',
  queue: '++id, &key'
});

// ---------- segnatore di modifica (Passo 12) ----------
// Serve all'avviso di backup in Crea: `settings.lastChangeAt` = istante dell'ultima scrittura SUCCESSIVA a una modifica dei
// dati che il backup contiene (tutte le tabelle tranne `settings` e `recents`). Gli aggiornamenti che toccano solo
// `lastUsed`/`useCount` (uso di uno sticker) non contano. `settings.firstChangeAt` = prima modifica registrata (serve
// quando non c'e' ancora nessun backup). Si scrive a transazione conclusa, mai dentro l'hook; durante l'avvio (semi dei
// dati iniziali) e durante un ripristino il segnatore e' spento (`withoutChangeTracking`).
export const CHANGE_TABLES = ['games', 'factions', 'units', 'weapons', 'actions', 'images', 'cards', 'templates', 'fonts',
  'rules', 'matches', 'matchUnits', 'matchEvents', 'queue'];
const USE_ONLY_FIELDS = new Set(['lastUsed', 'useCount']);
let trackOff = 0;
function sameValue(a, b) {
  if (a === b) return true;
  if (typeof Blob !== 'undefined' && (a instanceof Blob || b instanceof Blob)) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}
let changeWrites = Promise.resolve();

function persistChange(t) {
  changeWrites = changeWrites.then(() => db.transaction('rw', db.settings, async () => {
    const last = await db.settings.get('lastChangeAt');
    if (!last || last.value < t) await db.settings.put({ key: 'lastChangeAt', value: t });
    if (!(await db.settings.get('firstChangeAt'))) await db.settings.put({ key: 'firstChangeAt', value: t });
  })).catch((err) => console.warn('lastChangeAt non salvato', err));
}

{
  const noted = new WeakSet();
  const note = (trans) => {
    if (trackOff > 0 || !trans || !trans.on || noted.has(trans)) return;
    noted.add(trans);
    trans.on('complete', () => persistChange(Date.now()));
  };
  for (const name of CHANGE_TABLES) {
    const t = db[name];
    t.hook('creating', (primKey, obj, trans) => { note(trans); });
    t.hook('deleting', (primKey, obj, trans) => { note(trans); });
    t.hook('updating', (mods, primKey, obj, trans) => {
      // Dexie riscrive da solo i campi con indice multi-valore (weapons.unitIds) con lo stesso valore: non e' una modifica.
      if (Object.keys(mods).some((k) => !USE_ONLY_FIELDS.has(k.split('.')[0]) && !(!k.includes('.') && sameValue(mods[k], obj[k])))) note(trans);
    });
  }
}

// Esegue fn con il segnatore spento (le transazioni avviate dentro fn non contano come modifiche).
export async function withoutChangeTracking(fn) {
  trackOff++;
  try { return await fn(); } finally { trackOff--; }
}

// Attende che le scritture di lastChangeAt gia' avviate siano finite (usato prima di leggerlo).
export const changeSettled = () => changeWrites;

// ---------- utilita' ----------

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export const byName = (a, b) => collator.compare(a.name, b.name);

function cleanName(name) {
  const n = String(name ?? '').trim();
  if (!n) throw new Error('Il nome non può essere vuoto');
  return n;
}

const DEFAULT_LABELS = { faction: 'Fazione', unit: 'Unità', weapon: 'Arma', turn: 'Turno' };
function cleanLabels(labels = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_LABELS)) out[k] = String(labels[k] ?? '').trim() || DEFAULT_LABELS[k];
  return out;
}

const nextOrder = (rows) => rows.reduce((m, r) => Math.max(m, r.order ?? 0), -1) + 1;

export const WEAPON_KINDS = ['ranged', 'melee', 'other'];

// ---------- primo avvio ----------

const SEED_GAMES = [
  { name: 'Kill Team', labels: { faction: 'Squadra', unit: 'Operativo', weapon: 'Arma', turn: 'Turning Point' } },
  { name: 'Warhammer 40,000', labels: { faction: 'Esercito', unit: 'Unità', weapon: 'Arma', turn: 'Turno' } },
  { name: 'The Old World', labels: { faction: 'Esercito', unit: 'Unità', weapon: 'Arma', turn: 'Turno' } }
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
      image: { show: true, side: 'left', height: 140, radius: 12 },
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
  trackOff++; // i semi dei dati iniziali non sono modifiche dell'utente
  try { await initInner(); } finally { trackOff--; }
}

async function initInner() {
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
  await seedResultTemplate();
  await seedActions();
  await migrateTurnLabels();
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
      await db.settings.put({ key: 'templatesRev', value: 3 }); // i predefiniti nascono gia' alla revisione 3
      return;
    }
    // Revisione 2 (Passo 4, dopo la prova): targa spenta in "Attivazione" e profilo arma al posto del nome.
    const rev = await db.settings.get('templatesRev');
    if (!rev || rev.value < 2) {
      for (const t of SEED_TEMPLATES) {
        const row = await db.templates.where('kind').equals(t.kind).filter((r) => r.name === t.name).first();
        if (row) await db.templates.update(row.id, { config: structuredClone(t.config) });
      }
      await db.settings.put({ key: 'templatesRev', value: 2 });
    }
    // Revisione 3 (Passo 9): l'icona dell'azione la decide il template (`image.show`). Fino al Passo 8 l'icona era
    // mostrata sempre se esisteva, quindi i template di tipo action esistenti passano a show: true (senza icona
    // non cambia nulla: l'aspetto di nessuno sticker cambia). Non tocca i template creati dopo (rev >= 3).
    const rev3 = await db.settings.get('templatesRev');
    if (!rev3 || rev3.value < 3) {
      const rows = await db.templates.where('kind').equals('action').toArray();
      for (const r of rows) {
        const cfg = structuredClone(r.config || {});
        cfg.image = { ...(cfg.image || {}), show: true };
        await db.templates.update(r.id, { config: cfg });
      }
      await db.settings.put({ key: 'templatesRev', value: 3 });
    }
  });
}

// Template predefinito "Risultato" (Passo 11), creato una sola volta (settings.seededResultTemplate) anche per chi
// aveva gia' i template degli altri tipi. Non tocca nessun altro template.
const SEED_RESULT_TEMPLATE = {
  name: 'Risultato', kind: 'result',
  config: {
    width: 1080, padding: 24, trim: true,
    plate: { show: true, color: '#111111', opacity: 0.85, radius: 20, padding: 28, border: { width: 4, color: '#E8B04A' } },
    image: { show: true, side: 'left', height: 170, radius: 12, border: { width: 3, color: '#FFFFFF' } },
    weaponImage: { show: false, position: 'below', maxHeight: 200, replaceText: false, radius: 10 },
    lines: [
      { source: 'target', font: 'Bebas Neue', size: 96, minSize: 52, color: '#FFFFFF', stroke: { width: 6, color: '#000000' }, shadow: true, upper: true, align: 'left' },
      { source: 'damageLeft', font: 'Oswald', weight: 500, size: 72, minSize: 36, color: '#E8B04A', stroke: { width: 4, color: '#000000' }, shadow: false, upper: false, align: 'left' },
      { source: 'status', font: 'Bebas Neue', size: 72, minSize: 40, color: '#FF4D4D', stroke: { width: 5, color: '#000000' }, shadow: true, upper: true, align: 'left' }
    ]
  }
};

async function seedResultTemplate() {
  await db.transaction('rw', db.templates, db.settings, async () => {
    if (await db.settings.get('seededResultTemplate')) return;
    const id = await db.templates.add({ name: SEED_RESULT_TEMPLATE.name, kind: SEED_RESULT_TEMPLATE.kind, config: structuredClone(SEED_RESULT_TEMPLATE.config) });
    const prev = await db.settings.get('defaultTemplates');
    await db.settings.put({ key: 'defaultTemplates', value: { ...(prev ? prev.value : {}), result: id } });
    await db.settings.put({ key: 'seededResultTemplate', value: 1 });
  });
}

// Una sola volta (settings.turnLabelsRev, Passo 10): `games.labels.turn` ai giochi che non ce l'hanno
// ("Turning Point" per i giochi chiamati Kill Team, "Turno" per gli altri). Non tocca chi l'ha gia'.
async function migrateTurnLabels() {
  await db.transaction('rw', db.games, db.settings, async () => {
    if (await db.settings.get('turnLabelsRev')) return;
    for (const g of await db.games.toArray()) {
      if (g.labels && g.labels.turn) continue;
      const turn = sameName(g.name, 'Kill Team') ? 'Turning Point' : 'Turno';
      await db.games.update(g.id, { labels: { ...DEFAULT_LABELS, ...(g.labels || {}), turn } });
    }
    await db.settings.put({ key: 'turnLabelsRev', value: 1 });
  });
}

// Etichetta del turno di un gioco ("Turno" se il gioco non ce l'ha: giochi creati prima del Passo 10).
export const turnLabelOf = (game) => (game && game.labels && game.labels.turn) || 'Turno';

// Una sola volta (settings.seededActions): azioni generate di Kill Team. Se il gioco "Kill Team" non c'e' (eliminato o
// rinominato) non si crea nulla; i nomi gia' presenti (nel gioco o tra le globali) non si duplicano.
const SEED_ACTIONS = ['Reposition', 'Dash', 'Fall Back', 'Charge', 'Shoot', 'Fight', 'Pick Up Marker', 'Place Marker'];

async function seedActions() {
  await db.transaction('rw', db.games, db.actions, db.settings, async () => {
    if (await db.settings.get('seededActions')) return;
    const kt = (await db.games.toArray()).find((g) => sameName(g.name, 'Kill Team'));
    if (kt) {
      const have = (await db.actions.toArray()).filter((a) => a.gameId == null || a.gameId === kt.id);
      for (const name of SEED_ACTIONS) {
        if (have.some((a) => sameName(a.name, name))) continue;
        await db.actions.add({ gameId: kt.id, name, label: null, mode: 'generated', imageId: null, accentColor: null, fav: 0, lastUsed: 0 });
      }
    }
    await db.settings.put({ key: 'seededActions', value: 1 });
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

export const TEMPLATE_KINDS = ['activation', 'action', 'result'];

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

// ---- Gestione template (Passo 9) ----
const sameTplName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

async function assertTemplateName(kind, name, exceptId = null) {
  const n = cleanName(name);
  const clash = (await listTemplates(kind)).find((t) => t.id !== exceptId && sameTplName(t.name, n));
  if (clash) throw new Error('Esiste già un template con questo nome');
  return n;
}

export async function renameTemplate(id, name) {
  const t = await db.templates.get(id);
  if (!t) throw new Error('Template non trovato');
  const n = await assertTemplateName(t.kind, name, id);
  await db.templates.update(id, { name: n });
  return n;
}

// Salva la config (salvataggio automatico dell'editor). Restituisce false se il template non esiste piu'.
export async function setTemplateConfig(id, config) {
  const t = await db.templates.get(id);
  if (!t) return false;
  await db.templates.update(id, { config: structuredClone(config) });
  return true;
}

// Copia di un template: stesso tipo, nome unico ("X (copia)", "X (copia 2)"...), mai predefinito.
export async function duplicateTemplate(id) {
  const t = await db.templates.get(id);
  if (!t) throw new Error('Template non trovato');
  const names = (await listTemplates(t.kind)).map((x) => x.name);
  let name = `${t.name} (copia)`;
  for (let i = 2; names.some((n) => sameTplName(n, name)); i++) name = `${t.name} (copia ${i})`;
  return db.templates.add({ name, kind: t.kind, config: structuredClone(t.config) });
}

export async function setDefaultTemplate(id) {
  const t = await db.templates.get(id);
  if (!t) throw new Error('Template non trovato');
  const prev = (await db.settings.get('defaultTemplates')) || { value: {} };
  await db.settings.put({ key: 'defaultTemplates', value: { ...(prev.value || {}), [t.kind]: id } });
}

// Elimina un template, mai l'ultimo del suo tipo. Se era il predefinito, il predefinito diventa il primo rimasto.
// Recenti e preferiti che lo citano restano: Crea e Anteprima ricadono sul predefinito se il template non c'e'.
export async function deleteTemplate(id) {
  await db.transaction('rw', db.templates, db.settings, async () => {
    const t = await db.templates.get(id);
    if (!t) return;
    const same = await db.templates.where('kind').equals(t.kind).toArray();
    if (same.length <= 1) throw new Error('Non si può eliminare l\'ultimo template di questo tipo');
    await db.templates.delete(id);
    const s = await db.settings.get('defaultTemplates');
    const defs = (s && s.value) || {};
    if (defs[t.kind] === id) {
      const first = same.filter((x) => x.id !== id).sort((a, b) => a.id - b.id)[0];
      await db.settings.put({ key: 'defaultTemplates', value: { ...defs, [t.kind]: first.id } });
    }
  });
}

// ---------- coda degli sticker (Passo 11) ----------
// Tabella queue = { id, key, name, label, blob, createdAt }. L'ordine e' quello degli id (ordine di inserimento).
// `key` e' unica: rigenerare lo stesso sticker dal log (stessa chiave) sostituisce la riga vecchia, che va in coda.
// Ogni modifica avvisa le schermate con l'evento 'sbr-queue' (contatore).

const queueChanged = () => { try { globalThis.dispatchEvent(new Event('sbr-queue')); } catch { /* fuori dal browser */ } };

export async function queueAdd({ key, name, label = '', blob }) {
  if (!blob) throw new Error('Sticker mancante');
  const k = String(key || `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const id = await db.transaction('rw', db.queue, async () => {
    await db.queue.where('key').equals(k).delete();
    return db.queue.add({ key: k, name: String(name || 'sticker.png'), label: String(label || ''), blob, createdAt: Date.now() });
  });
  queueChanged();
  return id;
}
export const queueList = async () => (await db.queue.toArray()).sort((a, b) => a.id - b.id);
export const queueCount = () => db.queue.count();
export async function queueRemove(id) { await db.queue.delete(id); queueChanged(); }
export async function queueClear() { await db.queue.clear(); queueChanged(); }

// ---- Font importati (Passo 9): tabella fonts { family, blob, format } ----
export const FONT_FORMATS = ['ttf', 'otf', 'woff2', 'woff'];
export async function listFonts() { return (await db.fonts.toArray()).sort((a, b) => byName({ name: a.family }, { name: b.family })); }
export async function addFont(family, blob, format) {
  const f = cleanName(family);
  if ((await db.fonts.toArray()).some((x) => sameTplName(x.family, f))) throw new Error('Esiste già un font con questo nome');
  return db.fonts.add({ family: f, blob, format });
}
export const deleteFont = (id) => db.fonts.delete(id);

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
  const imgIds = [unit && unit.imageId, weapon && weapon.imageId, action && action.imageId].filter((x) => x != null);
  const imgs = await getImagesById(imgIds);
  const blobOf = (row) => (row && row.imageId != null && imgs.get(row.imageId) ? imgs.get(row.imageId).blob : null);
  // actionImage: icona di un'azione disegnata, oppure il PNG originale di un'azione 'png' (da esportare identico).
  return { unit, weapon, action, faction, game, unitImage: blobOf(unit), weaponImage: blobOf(weapon), actionImage: blobOf(action) };
}

const MAX_RECENTS = 30;

// Chiave unica di una combinazione sticker (recenti e preferiti), es. "u12-w40-t1".
export function comboKey({ unitId = null, weaponId = null, actionId = null, templateId = null } = {}) {
  return [
    unitId != null ? 'u' + unitId : '', weaponId != null ? 'w' + weaponId : '',
    actionId != null ? 'a' + actionId : '', templateId != null ? 't' + templateId : ''
  ].filter(Boolean).join('-');
}

// Dopo Salva/Condividi: aggiorna lastUsed/useCount e la tabella recents (chiave unica, massimo 30).
export async function recordUse({ unitId = null, weaponId = null, actionId = null, templateId = null }) {
  const now = Date.now();
  const key = comboKey({ unitId, weaponId, actionId, templateId });
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

// Recenti, dal piu' recente. Le righe possono riferirsi a elementi eliminati: chi legge deve ignorarle.
export async function listRecents() {
  return db.recents.orderBy('usedAt').reverse().toArray();
}

// ---------- impostazioni e combinazioni preferite (Passo 7) ----------

export async function getSetting(key, fallback = null) {
  const s = await db.settings.get(key);
  return s && s.value !== undefined ? s.value : fallback;
}
export const setSetting = (key, value) => db.settings.put({ key, value });

// settings.favCombos = [{ key, unitId, weaponId, actionId, templateId, addedAt }]
export async function listFavCombos() {
  const v = await getSetting('favCombos', []);
  return Array.isArray(v) ? v : [];
}

export async function isFavCombo(parts) {
  const key = comboKey(parts);
  return !!key && (await listFavCombos()).some((c) => c.key === key);
}

// Aggiunge o toglie la combinazione; restituisce il nuovo stato (true = preferita).
export async function toggleFavCombo({ unitId = null, weaponId = null, actionId = null, templateId = null }) {
  const key = comboKey({ unitId, weaponId, actionId, templateId });
  if (!key) return false;
  return db.transaction('rw', db.settings, async () => {
    const list = await listFavCombos();
    const has = list.some((c) => c.key === key);
    const next = has ? list.filter((c) => c.key !== key) : [...list, { key, unitId, weaponId, actionId, templateId, addedAt: Date.now() }];
    await setSetting('favCombos', next);
    return !has;
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

// IndexedDB non indicizza `null`: le azioni "valide per tutti i giochi" (gameId null) non compaiono in
// where('gameId').equals(...). Si leggono con un filtro sull'intera tabella (poche righe).
export async function listGlobalActions() {
  return (await db.actions.filter((a) => a.gameId == null).toArray()).sort(byName);
}

// Azioni di un gioco; con includeGlobal (predefinito) anche quelle valide per tutti i giochi.
// gameId null = solo le globali. Per una lista "solo di questo gioco" (es. Libreria) usare includeGlobal: false.
export async function listActions(gameId, { includeGlobal = true } = {}) {
  if (gameId == null) return listGlobalActions();
  const own = await db.actions.where('gameId').equals(gameId).toArray();
  const rows = includeGlobal ? [...own, ...(await db.actions.filter((a) => a.gameId == null).toArray())] : own;
  return rows.sort(byName);
}

// mode: 'generated' (disegnata dal template Azione; image = icona facoltativa) oppure 'png'
// (PNG importato, esce identico; image = il PNG). Le righe create prima del Passo 8 non hanno `mode`: sono 'generated'.
export const actionMode = (a) => (a && a.mode === 'png' ? 'png' : 'generated');

const sameName = (a, b) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim() === String(b || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Azione con lo stesso nome nello stesso ambito (gameId oppure null = tutti i giochi).
export async function findActionByName(gameId, name) {
  const rows = gameId == null ? await db.actions.filter((a) => a.gameId == null).toArray() : await db.actions.where('gameId').equals(gameId).toArray();
  return rows.find((a) => sameName(a.name, name)) || null;
}

// gameId null = valida per tutti i giochi. extra: { label (testo a schermo), mode, image: { blob, width, height, thumb } }.
export async function addAction(gameId, name, accentColor = null, extra = {}) {
  if (gameId != null && !(await db.games.get(gameId))) throw new Error('Gioco non trovato');
  const mode = extra.mode === 'png' ? 'png' : 'generated';
  if (mode === 'png' && !extra.image) throw new Error('Serve il file PNG');
  return db.transaction('rw', db.actions, db.images, async () => {
    const id = await db.actions.add({
      gameId: gameId ?? null, name: cleanName(name), label: cleanLabel(extra.label), mode, imageId: null,
      accentColor: cleanColor(accentColor), fav: 0, lastUsed: 0
    });
    if (extra.image) await setActionImage(id, extra.image.blob, extra.image.width, extra.image.height, extra.image.thumb);
    return id;
  });
}

// Testo a schermo facoltativo (se vuoto lo sticker scrive il nome).
function cleanLabel(label) {
  const l = String(label ?? '').trim();
  return l || null;
}

// Modifica nome, testo a schermo, colore, ambito. changes: { name?, label?, accentColor?, gameId? }.
export async function updateAction(id, changes) {
  const c = {};
  if ('name' in changes) c.name = cleanName(changes.name);
  if ('label' in changes) c.label = cleanLabel(changes.label);
  if ('accentColor' in changes) c.accentColor = cleanColor(changes.accentColor);
  if ('gameId' in changes) {
    if (changes.gameId != null && !(await db.games.get(changes.gameId))) throw new Error('Gioco non trovato');
    c.gameId = changes.gameId ?? null;
  }
  await db.actions.update(id, c);
}

export const setActionImage = (id, blob, width, height, thumb) => replaceImage('actions', 'action', id, blob, width, height, thumb);
export const removeActionImage = (id) => dropImage('actions', id);

// Sostituisce il PNG di un'azione 'png' (o trasforma un'azione disegnata in azione PNG).
export async function setActionPng(id, blob, width, height, thumb) {
  await db.transaction('rw', db.actions, db.images, async () => {
    await setActionImage(id, blob, width, height, thumb);
    await db.actions.update(id, { mode: 'png' });
  });
}

export async function deleteAction(id) {
  await db.transaction('rw', db.actions, db.images, async () => {
    const a = await db.actions.get(id);
    if (!a) return;
    if (a.imageId != null) await db.images.delete(a.imageId);
    await db.actions.delete(id);
  });
}

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
    const acts = await db.actions.where('gameId').equals(id).toArray();
    await db.images.bulkDelete(acts.map((a) => a.imageId).filter((x) => x != null));
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


// ---------- log della partita (Passo 10) ----------
// Tabelle v3: matches, matchUnits (rosa), matchEvents (seq = ordine). Lo stato si ricostruisce con js/matchlog.js.
// Il log e' indipendente dal resto: nomi di gioco, squadra, operativi, azioni e armi sono COPIATI nelle righe,
// quindi eliminare giochi/fazioni/miniature/azioni/armi non tocca il log (i riferimenti mancanti si ignorano).

import * as ML from './matchlog.js';

const MATCH_TABLES = () => [db.matches, db.matchUnits, db.matchEvents];

export async function listMatches() {
  return (await db.matches.toArray()).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}
export const getMatch = (id) => db.matches.get(id);
export async function listMatchUnits(matchId) {
  return (await db.matchUnits.where('matchId').equals(matchId).toArray()).sort((a, b) => a.side - b.side || a.id - b.id);
}
export async function listMatchEvents(matchId) {
  return (await db.matchEvents.where('matchId').equals(matchId).toArray()).sort((a, b) => a.seq - b.seq);
}

// sides: [{ player, factionId|null, factionName }, { ... }]. mode: 'live' | 'rebuild'.
export async function createMatch({ gameId, name = '', mission = '', sides, mode = 'live' }) {
  const game = gameId != null ? await db.games.get(gameId) : null;
  const sd = [0, 1].map((i) => {
    const s = (sides && sides[i]) || {};
    return { player: String(s.player || '').trim(), factionId: s.factionId ?? null, factionName: String(s.factionName || '').trim(), color: ML.teamColorKey(s.color) };
  });
  return db.matches.add({
    gameId: gameId ?? null, gameName: game ? game.name : '', name: String(name || '').trim(), mission: String(mission || '').trim(),
    status: 'live', mode: mode === 'rebuild' ? 'rebuild' : 'live', startedAt: Date.now(), endedAt: null, sides: sd, notes: '',
    turnLabel: turnLabelOf(game), dismissed: []
  });
}

// Cambia il gioco di una partita: aggiorna nome gioco ed etichetta dei turni; le fazioni scelte dall'elenco del
// vecchio gioco restano come testo (factionId azzerato). Rosa ed eventi non cambiano.
export async function changeMatchGame(id, gameId) {
  const game = await db.games.get(gameId);
  if (!game) throw new Error('Il gioco non esiste');
  const m = await db.matches.get(id);
  if (!m) return;
  const sides = (m.sides || []).map((s) => ({ ...s, factionId: null }));
  await db.matches.update(id, { gameId: game.id, gameName: game.name, turnLabel: turnLabelOf(game), sides });
}

export async function updateMatch(id, changes) {
  await db.matches.update(id, changes);
}

export async function deleteMatch(id) {
  await db.transaction('rw', MATCH_TABLES(), async () => {
    await db.matchEvents.where('matchId').equals(id).delete();
    await db.matchUnits.where('matchId').equals(id).delete();
    await db.matches.delete(id);
  });
}

// Nuova partita con la stessa rosa (ferite piene, nessun evento).
export async function duplicateMatchRoster(id) {
  return db.transaction('rw', MATCH_TABLES(), async () => {
    const m = await db.matches.get(id);
    if (!m) return null;
    const { id: _drop, ...rest } = m;
    const newId = await db.matches.add({ ...rest, name: m.name ? `${m.name} (copia)` : '', status: 'live', startedAt: Date.now(), endedAt: null, notes: '', dismissed: [] });
    const units = await db.matchUnits.where('matchId').equals(id).toArray();
    for (const u of units) { const { id: _u, ...r } = u; await db.matchUnits.add({ ...r, matchId: newId }); }
    return newId;
  });
}

// Aggiunge alla rosa. Se il nome esiste gia' nello stesso lato aggiunge un numero ("Intercessor 2").
export async function addMatchUnit(matchId, { side, unitId = null, name, maxWounds = null, note = '' }) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Il nome non può essere vuoto');
  return db.transaction('rw', db.matchUnits, async () => {
    const same = await db.matchUnits.where('matchId').equals(matchId).filter((u) => u.side === side).toArray();
    return db.matchUnits.add({ matchId, side, unitId, name: ML.uniqueRosterName(same.map((u) => u.name), nm), maxWounds: ML.parseWounds(maxWounds), note });
  });
}

// Aggiunge molte miniature della fazione in un colpo (nome e units.stats.wounds copiati).
export async function addMatchUnitsFromFaction(matchId, side, unitIds) {
  const out = [];
  for (const uid of unitIds) {
    const u = await db.units.get(uid);
    if (!u) continue;
    out.push(await addMatchUnit(matchId, { side, unitId: u.id, name: u.name, maxWounds: u.stats ? u.stats.wounds : null }));
  }
  return out;
}

export async function updateMatchUnit(id, changes) {
  const c = { ...changes };
  if ('name' in c) { c.name = String(c.name || '').trim(); if (!c.name) throw new Error('Il nome non può essere vuoto'); }
  if ('maxWounds' in c) c.maxWounds = ML.parseWounds(c.maxWounds);
  await db.transaction('rw', MATCH_TABLES(), async () => {
    const u = await db.matchUnits.get(id);
    if (!u) return;
    await db.matchUnits.update(id, c);
    await recalcMatch(u.matchId); // le ferite massime cambiano le ferite rimaste
  });
}

export const countUnitEvents = async (matchId, unitRef) =>
  (await db.matchEvents.where('matchId').equals(matchId).filter((e) => e.unitRef === unitRef || e.targetRef === unitRef).count());

// Toglie dalla rosa solo se nessun evento la cita (altrimenti restituisce false).
export async function removeMatchUnit(id) {
  return db.transaction('rw', MATCH_TABLES(), async () => {
    const u = await db.matchUnits.get(id);
    if (!u) return true;
    if (await countUnitEvents(u.matchId, id)) return false;
    await db.matchUnits.delete(id);
    return true;
  });
}

// Riscrive `seq` (1..n) e i valori calcolati dal replay. Da chiamare dentro una transazione sulle tre tabelle.
// Restituisce { rep, units, events } con gli eventi gia' aggiornati.
async function recalcMatch(matchId) {
  const m = await db.matches.get(matchId);
  const units = await listMatchUnits(matchId);
  let events = await listMatchEvents(matchId);
  const tidy = ML.renumber(events);
  for (let i = 0; i < events.length; i++) {
    if (events[i].seq !== tidy[i].seq) await db.matchEvents.update(events[i].id, { seq: tidy[i].seq });
  }
  events = tidy;
  const rep = ML.replay(units, events, { dismissed: (m && m.dismissed) || [] });
  for (const { index, changes } of ML.derivedChanges(events, rep)) {
    await db.matchEvents.update(events[index].id, changes);
    Object.assign(events[index], changes);
  }
  return { rep, units, events };
}

// Stato attuale della partita (replay degli eventi salvati, nessuna scrittura).
export async function getMatchState(matchId) {
  const [m, units, events] = await Promise.all([db.matches.get(matchId), listMatchUnits(matchId), listMatchEvents(matchId)]);
  const rep = ML.replay(units, events, { dismissed: (m && m.dismissed) || [] });
  return { match: m, units, events, rep };
}

// Aggiunge un evento in coda o nella posizione `pos` (0..n: gli eventi da `pos` in poi scalano). Restituisce l'id.
export async function addMatchEvent(matchId, ev, pos = null) {
  return db.transaction('rw', MATCH_TABLES(), async () => {
    const m = await db.matches.get(matchId);
    if (!m) throw new Error('Partita non trovata');
    const units = await listMatchUnits(matchId);
    const events = await listMatchEvents(matchId);
    const p = pos == null ? events.length : Math.max(0, Math.min(pos, events.length));
    const row = ML.completeEvent({ ...ev, matchId, turn: 0, at: m.mode === 'rebuild' ? null : Date.now() }, units);
    // fa posto: gli eventi da p in poi scalano di 1
    for (let i = events.length - 1; i >= p; i--) await db.matchEvents.update(events[i].id, { seq: events[i].seq + 1 });
    row.seq = p + 1;
    const id = await db.matchEvents.add(row);
    if (row.type === 'damage' && row.targetRef != null && (m.dismissed || []).includes(row.targetRef)) {
      await db.matches.update(matchId, { dismissed: m.dismissed.filter((x) => x !== row.targetRef) });
    }
    await recalcMatch(matchId);
    return id;
  });
}

// Modifica campi di un evento (type, unitRef, targetRef, actionId, weaponId, data, note, side...) e ricalcola.
export async function updateMatchEvent(id, changes) {
  return db.transaction('rw', MATCH_TABLES(), async () => {
    const e = await db.matchEvents.get(id);
    if (!e) return null;
    const units = await listMatchUnits(e.matchId);
    const merged = ML.completeEvent({ ...e, ...changes, data: changes.data ? { ...changes.data } : e.data }, units);
    delete merged.id;
    await db.matchEvents.update(id, merged);
    return recalcMatch(e.matchId);
  });
}

// Eventi che sparirebbero eliminando `id` (lui e quelli che lo citano come sorgente).
export async function previewDeleteEvent(id) {
  const e = await db.matchEvents.get(id);
  if (!e) return [];
  return ML.cascadeIds(await listMatchEvents(e.matchId), id);
}

export async function deleteMatchEvent(id, { cascade = true } = {}) {
  return db.transaction('rw', MATCH_TABLES(), async () => {
    const e = await db.matchEvents.get(id);
    if (!e) return null;
    const ids = cascade ? ML.cascadeIds(await listMatchEvents(e.matchId), id) : [id];
    await db.matchEvents.bulkDelete(ids);
    return recalcMatch(e.matchId);
  });
}

// Annulla l'ultima voce (o quella in posizione `index`, 0-based, se si sta inserendo in mezzo). Restituisce l'evento tolto.
export async function undoMatchEvent(matchId, index = null) {
  return db.transaction('rw', MATCH_TABLES(), async () => {
    const events = await listMatchEvents(matchId);
    const i = index == null ? events.length - 1 : index;
    const e = events[i];
    if (!e) return null;
    await db.matchEvents.bulkDelete(ML.cascadeIds(events, e.id));
    await recalcMatch(matchId);
    return e;
  });
}

// "Non incapacitato": nasconde la proposta per questa unita' finche' non subisce altro danno.
export async function dismissIncapacitated(matchId, unitRef) {
  const m = await db.matches.get(matchId);
  if (!m) return;
  const set = new Set([...(m.dismissed || []), unitRef]);
  await db.matches.update(matchId, { dismissed: [...set] });
}

export async function endMatch(id, done = true) {
  await db.matches.update(id, done ? { status: 'done', endedAt: Date.now() } : { status: 'live', endedAt: null });
}
