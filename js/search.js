// Ricerca in memoria per la schermata Crea (Passo 7).
//
// Parte pura (nessuna dipendenza, testabile in Node): normalize, tokens, matchesAll, buildIndex, searchIndex.
// Parte con database: createLiveIndex(db) tiene l'indice aggiornato agganciandosi agli hook di Dexie.
//
// Regola di ricerca: ogni parola digitata deve essere l'INIZIO di una parola del nome ("int ser" trova
// "Intercessor Sergeant"; l'ordine delle parole non conta). Minuscolo, senza accenti e senza punteggiatura.

const SPECIAL = { 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'þ': 'th' };

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øßæœđłþ]/g, (c) => SPECIAL[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const tokens = (s) => { const n = normalize(s); return n ? n.split(' ') : []; };

// Ogni parola cercata e' l'inizio di almeno una parola del testo.
export function matchesAll(queryWords, words) {
  if (!queryWords.length) return false;
  return queryWords.every((q) => words.some((w) => w.startsWith(q)));
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

// rows = { games, factions, units, weapons, actions } (righe del database, anche parziali).
// Restituisce { units, weapons, actions, factions, games, byId } dove byId.<tipo> e' una Map id -> voce.
export function buildIndex({ games = [], factions = [], units = [], weapons = [], actions = [] }) {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const factionById = new Map(factions.map((f) => [f.id, f]));
  const unitRowById = new Map(units.map((u) => [u.id, u]));

  const entry = (type, row, extra) => ({
    type, id: row.id, name: row.name, norm: normalize(row.name), words: tokens(row.name),
    fav: row.fav ? 1 : 0, lastUsed: row.lastUsed || 0, imageId: row.imageId ?? null, ...extra
  });

  const unitEntries = units.map((u) => {
    const f = factionById.get(u.factionId);
    const gameId = u.gameId ?? (f ? f.gameId : null);
    return entry('unit', u, {
      factionId: u.factionId, gameId,
      factionName: f ? f.name : '', gameName: gameById.get(gameId)?.name || ''
    });
  });

  const weaponEntries = weapons.map((w) => {
    const f = factionById.get(w.factionId);
    const gameId = f ? f.gameId : null;
    const ids = (w.unitIds || []).filter((id) => unitRowById.has(id));
    const unitNames = ids.map((id) => unitRowById.get(id).name);
    const e = entry('weapon', w, {
      factionId: w.factionId, gameId, unitIds: ids, unitNames, kind: w.kind || 'other',
      factionName: f ? f.name : '', gameName: gameById.get(gameId)?.name || ''
    });
    // Le armi si trovano anche scrivendo parole del nome di UNA delle loro miniature ("bolt int"),
    // mai mescolando parole di miniature diverse.
    e.unitWordSets = unitNames.map(tokens);
    return e;
  });

  const actionEntries = actions.map((a) => entry('action', a, {
    factionId: null, gameId: a.gameId ?? null, accentColor: a.accentColor || null,
    mode: a.mode === 'png' ? 'png' : 'generated', label: a.label || null,
    gameName: a.gameId == null ? 'Tutti i giochi' : (gameById.get(a.gameId)?.name || '')
  }));

  const sortFn = (a, b) => (b.fav - a.fav) || collator.compare(a.name, b.name);
  const byId = {
    units: new Map(unitEntries.map((e) => [e.id, e])),
    weapons: new Map(weaponEntries.map((e) => [e.id, e])),
    actions: new Map(actionEntries.map((e) => [e.id, e])),
    factions: new Map(factions.map((f) => [f.id, { id: f.id, name: f.name, gameId: f.gameId, fav: f.fav ? 1 : 0 }])),
    games: new Map(games.map((g) => [g.id, { id: g.id, name: g.name, labels: g.labels }]))
  };
  return {
    units: unitEntries.sort(sortFn), weapons: weaponEntries.sort(sortFn), actions: actionEntries.sort(sortFn),
    byId, builtAt: Date.now()
  };
}

// Filtro per gioco: le azioni con gameId null valgono per tutti i giochi.
const inGame = (e, gameId) => gameId == null || e.gameId === gameId || (e.type === 'action' && e.gameId == null);

// 0 = il nome comincia come la ricerca, 1 = tutte le parole nel nome, 2 = solo tramite le miniature (armi).
function rank(e, qNorm, qWords) {
  if (e.norm.startsWith(qNorm)) return 0;
  return matchesAll(qWords, e.words) ? 1 : 2;
}

function pick(list, qNorm, qWords, gameId, max, viaUnits) {
  const hits = [];
  for (const e of list) {
    if (!inGame(e, gameId)) continue;
    const own = matchesAll(qWords, e.words);
    if (!own && !(viaUnits && e.unitWordSets.some((uw) => matchesAll(qWords, [...e.words, ...uw])))) continue;
    hits.push(e);
  }
  hits.sort((a, b) => (rank(a, qNorm, qWords) - rank(b, qNorm, qWords)) || (b.fav - a.fav) || collator.compare(a.name, b.name));
  return { items: hits.slice(0, max), total: hits.length };
}

// Per un'arma: nome della miniatura da mostrare accanto ("Bolt rifle · Intercessor Warrior").
// Preferisce la prima miniatura con cui la ricerca corrisponde (nome arma + nome miniatura), poi una che
// contiene almeno una parola cercata; "+N" se ce ne sono altre.
function weaponLabel(e, qWords) {
  if (!e.unitNames.length) return { unitId: null, unitName: '', extra: 0 };
  let i = e.unitWordSets.findIndex((uw) => matchesAll(qWords, [...e.words, ...uw]));
  if (i < 0) i = e.unitWordSets.findIndex((uw) => uw.some((w) => qWords.some((q) => w.startsWith(q))));
  if (i < 0) i = 0;
  return { unitId: e.unitIds[i], unitName: e.unitNames[i], extra: e.unitNames.length - 1 };
}

// searchIndex(index, 'int ser', { gameId: 3, max: 8 })
//   -> { units: [...], weapons: [...], actions: [...], more: { units, weapons, actions } }  (more = quanti altri non mostrati)
export function searchIndex(index, query, { gameId = null, max = 8 } = {}) {
  const qWords = tokens(query);
  const empty = { units: [], weapons: [], actions: [], more: { units: 0, weapons: 0, actions: 0 } };
  if (!index || !qWords.length) return empty;
  const qNorm = qWords.join(' ');
  const u = pick(index.units, qNorm, qWords, gameId, max, false);
  const w = pick(index.weapons, qNorm, qWords, gameId, max, true);
  const a = pick(index.actions, qNorm, qWords, gameId, max, false);
  return {
    units: u.items,
    weapons: w.items.map((e) => ({ ...e, via: weaponLabel(e, qWords) })),
    actions: a.items,
    more: { units: u.total - u.items.length, weapons: w.total - w.items.length, actions: a.total - a.items.length }
  };
}

// ---------- indice vivo agganciato al database ----------

const INDEXED_FIELDS = new Set(['name', 'factionId', 'gameId', 'unitIds', 'fav', 'imageId', 'accentColor', 'labels', 'mode', 'label']);
const TABLES = ['games', 'factions', 'units', 'weapons', 'actions'];

// Costruisce l'indice al primo uso e lo ricostruisce (in modo pigro) dopo ogni modifica alle tabelle.
// Gli hook segnano "da rifare" subito e di nuovo a transazione conclusa, cosi' una lettura fatta a meta'
// di una scrittura non lascia un indice vecchio.
export function createLiveIndex(db) {
  let index = null;
  let dirty = true;
  let building = null;
  const seen = new WeakSet();
  const mark = () => { dirty = true; };
  const markAfter = (trans) => {
    mark();
    if (trans && trans.on && !seen.has(trans)) {
      seen.add(trans);
      trans.on('complete', mark);
    }
  };

  for (const name of TABLES) {
    const t = db[name];
    t.hook('creating', (primKey, obj, trans) => { markAfter(trans); });
    t.hook('deleting', (primKey, obj, trans) => { markAfter(trans); });
    t.hook('updating', (mods, primKey, obj, trans) => {
      if (Object.keys(mods).some((k) => INDEXED_FIELDS.has(k.split('.')[0]))) markAfter(trans);
    });
  }

  async function build() {
    for (;;) {
      dirty = false;
      const [games, factions, units, weapons, actions] = await Promise.all(TABLES.map((n) => db[n].toArray()));
      index = buildIndex({ games, factions, units, weapons, actions });
      if (!dirty) return index;
    }
  }

  return {
    // Restituisce l'indice aggiornato (lo ricostruisce solo se serve).
    async ensure() {
      if (!dirty && index) return index;
      if (!building) building = build().finally(() => { building = null; });
      return building;
    },
    isDirty: () => dirty || !index,
    current: () => index,
    markDirty: mark
  };
}
