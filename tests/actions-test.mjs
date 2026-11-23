// Prove delle parti pure del Passo 8 (js/actionfiles.js): nomi dai file, firma PNG, piano di importazione.
//   node tests/actions-test.mjs
import { nameFromFile, isPngBytes, planImport } from '../js/actionfiles.js';

let fails = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : '  -> ' + JSON.stringify(a) + ' invece di ' + JSON.stringify(b)}`);

eq(nameFromFile('reposition.png'), 'Reposition', 'reposition.png');
eq(nameFromFile('pick_up_marker.png'), 'Pick Up Marker', 'pick_up_marker.png');
eq(nameFromFile('Fall-Back.PNG'), 'Fall Back', 'trattino ed estensione maiuscola');
eq(nameFromFile('fall back (1).png'), 'Fall Back', '"(1)" del browser tolto');
eq(nameFromFile('/storage/emulated/0/Download/place_marker.png'), 'Place Marker', 'percorso tolto');
eq(nameFromFile('C:\\foto\\dash.png'), 'Dash', 'percorso Windows tolto');
eq(nameFromFile('UAV_scan.png'), 'UAV Scan', 'sigla maiuscola intatta');
eq(nameFromFile('__.png'), '', 'nome vuoto -> stringa vuota');
eq(nameFromFile('overwatch'), 'Overwatch', 'senza estensione');

check(isPngBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), 'firma PNG riconosciuta');
check(!isPngBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), 'JPEG rifiutato');
check(!isPngBytes(new Uint8Array([0x89, 0x50])), 'file troppo corto rifiutato');
check(isPngBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer), 'ArrayBuffer accettato');

const plan = planImport(
  [{ name: 'Dash' }, { name: 'Charge' }, { name: ' dash ' }, { name: 'FALL  BACK' }, { name: '' }],
  [{ id: 5, name: 'Fall Back' }, { id: 6, name: 'Shoot' }]
);
eq(plan.fresh.map((x) => x.name), ['Dash', 'Charge'], 'nuove');
eq(plan.replace.map((x) => [x.item.name, x.existing.id]), [['FALL  BACK', 5]], 'da sostituire (senza badare a maiuscole e spazi)');
eq(plan.dupInBatch.map((x) => x.name), [' dash '], 'doppione nella selezione saltato');

console.log(fails ? `\n${fails} controlli falliti` : '\nTutti i controlli passati');
process.exit(fails ? 1 : 0);
