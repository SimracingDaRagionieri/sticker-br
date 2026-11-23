// Solo per i test (spostato da js/ al Passo 13, non fa parte dell'app): dati di prova per controllare la velocita' di Crea.
// Uso: `await (await import('/tests/testdata.js')).generateTestData()` dentro la pagina servita dal test.
// Nomi inventati, nessun contenuto di giochi reali. Tutto sta in un gioco marcato `test: 1`, quindi
// "Elimina dati di prova" lo toglie con la normale eliminazione a cascata e poi ripulisce recenti e preferiti.

import { db, comboKey, deleteGame, getSetting, setSetting, getDefaultTemplate } from '../js/db.js';

const ROLES = ['Warden', 'Sentinel', 'Marauder', 'Vanguard', 'Reaver', 'Scout', 'Harrier', 'Bulwark', 'Pathfinder', 'Zealot'];
const KINDS = ['Captain', 'Gunner', 'Medic', 'Sniper', 'Breacher', 'Fighter', 'Heavy', 'Leader', 'Operator', 'Driver'];
const WTYPE = ['Bolt', 'Arc', 'Plasma', 'Flame', 'Needle', 'Rail', 'Pulse', 'Shock'];
const WFORM = ['pistol', 'rifle', 'carbine', 'blade', 'hammer', 'launcher', 'cannon', 'gauntlet'];
const FACTIONS = 10, UNITS = 100, WEAPONS = 160, ACTIONS = 40;

export async function findTestGames() {
  return (await db.games.toArray()).filter((g) => g.test === 1);
}

export async function testDataStats() {
  const games = await findTestGames();
  if (!games.length) return null;
  const ids = games.map((g) => g.id);
  const factions = await db.factions.where('gameId').anyOf(ids).primaryKeys();
  return {
    units: await db.units.where('gameId').anyOf(ids).count(),
    weapons: await db.weapons.where('factionId').anyOf(factions).count(),
    actions: await db.actions.where('gameId').anyOf(ids).count()
  };
}

function pngBlob(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob fallito'))), 'image/png'));
}

async function fakeImage(w, h, hue, label) {
  const draw = (ctx, W, H) => {
    ctx.fillStyle = `hsl(${hue} 45% 35%)`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `hsl(${hue} 60% 60%)`;
    ctx.fillRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
    ctx.fillStyle = '#111';
    ctx.font = `700 ${Math.round(H * 0.3)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, H / 2);
  };
  const [blob, thumb] = await Promise.all([pngBlob(w, h, draw), pngBlob(Math.round(w / 4), Math.round(h / 4), draw)]);
  return { blob, thumb, width: w, height: h };
}

async function addImage(kind, img) {
  return db.images.add({ kind, blob: img.blob, width: img.width, height: img.height, thumb: img.thumb, createdAt: Date.now() });
}

// 1 gioco, 10 fazioni, 100 miniature, 160 armi, 40 azioni (300 elementi tra miniature, armi e azioni),
// 28 recenti e 4 combinazioni preferite.
export async function generateTestData() {
  if ((await findTestGames()).length) throw new Error('I dati di prova ci sono gia\': eliminali prima');
  const actTpl = await getDefaultTemplate('action');
  const unitTpl = await getDefaultTemplate('activation');

  // immagini fuori dalla transazione (il canvas e' asincrono)
  const unitImgs = new Map();
  for (let i = 0; i < UNITS; i++) if (i % 5 < 2) unitImgs.set(i, await fakeImage(300, 300, (i * 37) % 360, ROLES[i % 10][0] + KINDS[Math.floor(i / 10) % 10][0]));
  const weaponImgs = new Map();
  for (let i = 0; i < WEAPONS; i++) if (i % 3 === 0) weaponImgs.set(i, await fakeImage(600, 160, (i * 53) % 360, 'ATK ' + (i % 5 + 1)));

  const out = { unitIds: [], weaponIds: [], actionIds: [] };
  await db.transaction('rw', db.tables, async () => {
    const gameId = await db.games.add({
      name: 'Prova (dati di prova)', labels: { faction: 'Squadra', unit: 'Operativo', weapon: 'Arma' },
      order: 99, fav: 0, test: 1
    });
    const factionIds = [];
    for (let f = 0; f < FACTIONS; f++) {
      factionIds.push(await db.factions.add({ gameId, name: `Prova Squadra ${String(f + 1).padStart(2, '0')}`, order: f, accentColor: null, fav: 0 }));
    }
    const perFaction = UNITS / FACTIONS;
    const unitsOf = factionIds.map(() => []);
    for (let i = 0; i < UNITS; i++) {
      const f = i % FACTIONS;
      const img = unitImgs.get(i);
      const imageId = img ? await addImage('unit', img) : null;
      const id = await db.units.add({
        factionId: factionIds[f], gameId, name: `${ROLES[i % 10]} ${KINDS[Math.floor(i / 10) % 10]}`,
        imageId, fav: i % 20 === 0 ? 1 : 0, lastUsed: 0, useCount: 0
      });
      unitsOf[f].push(id); out.unitIds.push(id);
    }
    for (let i = 0; i < WEAPONS; i++) {
      const f = i % FACTIONS;
      const pool = unitsOf[f];
      const n = 1 + (i % 3);
      const linked = [...new Set(Array.from({ length: n }, (_, k) => pool[(Math.floor(i / FACTIONS) + k * 3) % perFaction]))];
      const img = weaponImgs.get(i);
      const imageId = img ? await addImage('weapon', img) : null;
      const id = await db.weapons.add({
        factionId: factionIds[f], unitIds: linked,
        name: `${WTYPE[i % 8]} ${WFORM[Math.floor(i / 8) % 8]}${i >= 64 ? ' Mk ' + (Math.floor(i / 64) + 1) : ''}`,
        kind: i % 2 ? 'melee' : 'ranged', imageId, fav: i % 25 === 0 ? 1 : 0, lastUsed: 0
      });
      out.weaponIds.push(id);
    }
    for (let i = 0; i < ACTIONS; i++) {
      const id = await db.actions.add({
        gameId, name: `Test Action ${String(i + 1).padStart(2, '0')}`,
        accentColor: i % 4 === 0 ? '#e53935' : null, fav: i % 10 === 0 ? 1 : 0, lastUsed: 0
      });
      out.actionIds.push(id);
    }

    // recenti: 24 di attivazione e 4 di azione, con date decrescenti
    const now = Date.now();
    const recents = [];
    const wById = new Map();
    for (const id of out.weaponIds) wById.set(id, await db.weapons.get(id));
    let t = 0;
    for (let i = 0; i < 24; i++) {
      const w = wById.get(out.weaponIds[(i * 7) % WEAPONS]);
      const unitId = w.unitIds[0];
      const parts = i % 6 === 5 ? { unitId, templateId: unitTpl.id } : { unitId, weaponId: w.id, templateId: unitTpl.id };
      recents.push({ ...comboKey_(parts), usedAt: now - (t++) * 60000 });
    }
    for (let i = 0; i < 4; i++) recents.push({ ...comboKey_({ actionId: out.actionIds[i * 3], templateId: actTpl.id }), usedAt: now - (t++) * 60000 });
    await db.recents.bulkAdd(recents);

    const favs = [
      { unitId: wById.get(out.weaponIds[0]).unitIds[0], weaponId: out.weaponIds[0], templateId: unitTpl.id },
      { unitId: wById.get(out.weaponIds[1]).unitIds[0], weaponId: out.weaponIds[1], templateId: unitTpl.id },
      { unitId: wById.get(out.weaponIds[2]).unitIds[0], templateId: unitTpl.id },
      { actionId: out.actionIds[1], templateId: actTpl.id }
    ].map((p, i) => ({ key: comboKey(p), unitId: p.unitId ?? null, weaponId: p.weaponId ?? null, actionId: p.actionId ?? null, templateId: p.templateId, addedAt: now + i }));
    const prev = await getSetting('favCombos', []);
    await setSetting('favCombos', [...(Array.isArray(prev) ? prev : []), ...favs]);
  });
  return out;
}

function comboKey_({ unitId = null, weaponId = null, actionId = null, templateId = null }) {
  return { key: comboKey({ unitId, weaponId, actionId, templateId }), unitId, weaponId, actionId, templateId };
}

// Elimina il gioco di prova e poi recenti/preferiti che puntano a elementi non piu' esistenti.
export async function deleteTestData() {
  for (const g of await findTestGames()) await deleteGame(g.id);
  await db.transaction('rw', db.tables, async () => {
    const [units, weapons, actions] = await Promise.all([db.units.toCollection().primaryKeys(), db.weapons.toCollection().primaryKeys(), db.actions.toCollection().primaryKeys()]);
    const U = new Set(units), W = new Set(weapons), A = new Set(actions);
    const dead = (r) => (r.unitId != null && !U.has(r.unitId)) || (r.weaponId != null && !W.has(r.weaponId)) || (r.actionId != null && !A.has(r.actionId));
    const stale = (await db.recents.toArray()).filter(dead).map((r) => r.id);
    await db.recents.bulkDelete(stale);
    const favs = await getSetting('favCombos', []);
    if (Array.isArray(favs)) await setSetting('favCombos', favs.filter((c) => !dead(c)));
  });
}
