// Prove della ricerca in memoria (js/search.js, parte pura): node tests/search-test.mjs
import { normalize, tokens, matchesAll, buildIndex, searchIndex } from '../js/search.js';

let ok = 0;
const fails = [];
function check(cond, msg) {
  if (cond) ok++; else { fails.push(msg); console.log('  FAIL ' + msg); }
}
const names = (list) => list.map((e) => e.name);

// ---- normalizzazione ----
check(normalize('  Éclaireur  Sergeant! ') === 'eclaireur sergeant', 'accenti e spazi');
check(normalize('Bolt-rifle (short range)') === 'bolt rifle short range', 'punteggiatura');
check(normalize('Ørjan Straße') === 'orjan strasse', 'lettere speciali');
check(normalize('') === '' && normalize(null) === '' && normalize(undefined) === '', 'vuoti');
check(JSON.stringify(tokens('a  b-c')) === '["a","b","c"]', 'tokens');
check(matchesAll(['int', 'ser'], ['intercessor', 'sergeant']), 'int ser trova Intercessor Sergeant');
check(matchesAll(['ser', 'int'], ['intercessor', 'sergeant']), 'ordine delle parole libero');
check(!matchesAll(['tercessor'], ['intercessor']), 'solo inizio parola, non a meta\'');
check(!matchesAll([], ['x']), 'ricerca vuota non trova nulla');

// ---- indice ----
const games = [{ id: 1, name: 'Kill Team' }, { id: 2, name: 'Warhammer 40,000' }];
const factions = [{ id: 10, gameId: 1, name: 'Spectre Squad' }, { id: 11, gameId: 2, name: 'Marines' }];
const units = [
  { id: 100, factionId: 10, gameId: 1, name: 'Intercessor Sergeant' },
  { id: 101, factionId: 10, gameId: 1, name: 'Intercessor Warrior', fav: 1 },
  { id: 102, factionId: 10, gameId: 1, name: 'Éclaireur' },
  { id: 103, factionId: 11, gameId: 2, name: 'Intercessor Squad' },
  { id: 104, factionId: 10, gameId: 1, name: 'Heavy Intercessor' }
];
const weapons = [
  { id: 200, factionId: 10, unitIds: [100, 101], name: 'Bolt rifle', kind: 'ranged' },
  { id: 201, factionId: 10, unitIds: [101], name: 'Fists', kind: 'melee' },
  { id: 202, factionId: 11, unitIds: [103], name: 'Bolt pistol' },
  { id: 203, factionId: 10, unitIds: [], name: 'Bolter orfano' },
  { id: 204, factionId: 10, unitIds: [999], name: 'Arma con miniatura eliminata' }
];
const actions = [
  { id: 300, gameId: 1, name: 'Fall Back' }, { id: 301, gameId: 2, name: 'Charge' },
  { id: 302, gameId: null, name: 'Fall Guy globale' }
];
const idx = buildIndex({ games, factions, units, weapons, actions });

let r = searchIndex(idx, 'int ser');
check(names(r.units).join() === 'Intercessor Sergeant', '"int ser" -> solo Intercessor Sergeant: ' + names(r.units));
r = searchIndex(idx, 'inter');
check(r.units.length === 4, 'inter -> 4 miniature (tutti i giochi)');
check(r.units[0].name === 'Intercessor Warrior', 'rango: a parita\' prima il preferito, poi i nomi che cominciano uguale');
check(r.units[3].name === 'Heavy Intercessor', 'rango: le parole interne in fondo');
r = searchIndex(idx, 'inter', { gameId: 1 });
check(r.units.length === 3 && r.units.every((u) => u.gameId === 1), 'filtro per gioco');
r = searchIndex(idx, 'ecla');
check(names(r.units).join() === 'Éclaireur', 'senza accenti: ecla -> Éclaireur');
r = searchIndex(idx, 'BOLT');
check(names(r.weapons).join() === 'Bolt pistol,Bolt rifle,Bolter orfano', 'armi: bolt -> Bolt pistol, Bolt rifle, Bolter orfano (inizio parola): ' + names(r.weapons));
r = searchIndex(idx, 'bolt rifle');
const rifle = r.weapons[0];
check(rifle.name === 'Bolt rifle' && rifle.via.unitName === 'Intercessor Sergeant' && rifle.via.extra === 1, 'arma con due miniature: prima miniatura +1: ' + JSON.stringify(rifle.via));
r = searchIndex(idx, 'bolt warr');
check(r.weapons.length === 1 && r.weapons[0].name === 'Bolt rifle' && r.weapons[0].via.unitName === 'Intercessor Warrior', 'arma trovata anche con parole della miniatura; mostra quella cercata');
const mixed = buildIndex({ games, factions, units: [
  { id: 1, factionId: 10, gameId: 1, name: 'Alpha Beta' }, { id: 2, factionId: 10, gameId: 1, name: 'Gamma Delta' }
], weapons: [{ id: 1, factionId: 10, unitIds: [1, 2], name: 'Rifle' }], actions: [] });
check(searchIndex(mixed, 'rifle alpha').weapons.length === 1, 'arma + parola di una sua miniatura: trovata');
check(searchIndex(mixed, 'alpha delta').weapons.length === 0, 'parole di miniature diverse non si mescolano');
check(searchIndex(mixed, 'rifle delta').weapons[0].via.unitName === 'Gamma Delta', 'mostra la miniatura che corrisponde alla ricerca');
r = searchIndex(idx, 'fists');
check(r.weapons[0].via.extra === 0 && r.weapons[0].via.unitId === 101, 'arma con una sola miniatura');
r = searchIndex(idx, 'orfano');
check(r.weapons.length === 1 && r.weapons[0].via.unitId === null, 'arma senza miniature: unitId null');
r = searchIndex(idx, 'eliminata');
check(r.weapons.length === 1 && r.weapons[0].unitIds.length === 0, 'riferimenti a miniature eliminate ignorati');
r = searchIndex(idx, 'fall');
check(names(r.actions).sort().join() === 'Fall Back,Fall Guy globale', 'azioni: anche quelle globali (gameId null)');
r = searchIndex(idx, 'fall', { gameId: 2 });
check(names(r.actions).join() === 'Fall Guy globale', 'azioni filtrate per gioco + globali');
check(searchIndex(idx, '   ').units.length === 0, 'ricerca vuota: nessun risultato');
check(searchIndex(idx, 'zzzz').units.length === 0, 'nessuna corrispondenza');
check(searchIndex(null, 'a').units.length === 0, 'indice assente');

// ---- massimo per gruppo e "altri" ----
const many = Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i, factionId: 10, gameId: 1, name: `Warden ${String.fromCharCode(65 + (i % 26))}${i}` }));
const big = buildIndex({ games, factions, units: many, weapons: [], actions: [] });
r = searchIndex(big, 'ward');
check(r.units.length === 8 && r.more.units === 22, 'massimo 8 per gruppo, altri 22: ' + r.units.length + '/' + r.more.units);
r = searchIndex(big, 'ward', { max: 3 });
check(r.units.length === 3 && r.more.units === 27, 'max configurabile');

// ---- ordinamento numerico dei nomi ----
const num = buildIndex({ games, factions, units: [
  { id: 1, factionId: 10, gameId: 1, name: 'Drone 10' }, { id: 2, factionId: 10, gameId: 1, name: 'Drone 2' }
], weapons: [], actions: [] });
check(names(searchIndex(num, 'drone').units).join() === 'Drone 2,Drone 10', 'ordine numerico: Drone 2 prima di Drone 10');

// ---- velocita': 5000 voci ----
const bigUnits = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, factionId: 10, gameId: 1, name: `Operativo ${i} Sergeant Alfa${i % 97}` }));
const bigWeapons = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, factionId: 10, unitIds: [i + 1, ((i + 7) % 5000) + 1], name: `Arma ${i} rifle` }));
const bigIdx = buildIndex({ games, factions, units: bigUnits, weapons: bigWeapons, actions: [] });
const t0 = performance.now();
for (let i = 0; i < 20; i++) searchIndex(bigIdx, 'oper ser alf' + (i % 97));
const per = (performance.now() - t0) / 20;
console.log(`  ricerca su 10000 voci: ${per.toFixed(2)} ms per interrogazione`);
check(per < 30, 'ricerca su 10000 voci sotto 30 ms');

console.log(fails.length ? `\n${fails.length} FALLITI su ${ok + fails.length}` : `\n${ok}/${ok} controlli superati.`);
process.exit(fails.length ? 1 : 0);
