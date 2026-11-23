// node tests/cardscan-test.mjs  -> prova findWeaponRowsGray con carte finte (nessuna dipendenza, nessun DOM).
import { findWeaponRowsGray, resizeGray, SCAN_W } from '../js/cardscan.js';
import { makeCard, teachIcon } from './fakecard.mjs';

const ref = makeCard({ seed: 100, W: 1200, H: 1680, iconSize: 55, pitch: 142, tableTop: 624, kinds: ['ranged', 'melee'], noise: 3 });
const templates = { ranged: teachIcon(ref, 0, SCAN_W), melee: teachIcon(ref, 1, SCAN_W) };

const scenarios = [
  ['dritta, 3 armi', { kinds: ['ranged', 'melee', 'ranged'] }, 6],
  ['dritta, 4 armi', { kinds: ['melee', 'ranged', 'ranged', 'melee'] }, 6],
  ['1 sola arma', { kinds: ['ranged'] }, 5],
  ['icone -15% e rumore forte', { kinds: ['ranged', 'melee', 'melee'], iconSize: 39, noise: 14 }, 6],
  ['icone +20%', { kinds: ['ranged', 'ranged', 'melee'], iconSize: 55 }, 6],
  ['storta 2 gradi', { kinds: ['ranged', 'melee', 'ranged'], tilt: 2 }, 6],
  ['storta -2.5 gradi, 4 armi', { kinds: ['melee', 'ranged', 'melee', 'ranged'], tilt: -2.5, noise: 9 }, 6],
  ['carta senza armi (solo falsi positivi)', { kinds: [] }, 10]
];

let tot = 0, ok = 0, falsePos = 0, miss = 0, badBand = 0, t0 = Date.now();
for (const [name, opt, n] of scenarios) {
  let sOk = 0, sFound = 0, sExp = 0, sFp = 0;
  for (let s = 0; s < n; s++) {
    const W = 800 + ((s * 97) % 5) * 100, H = Math.round(W * 1.4), k = W / 1000;
    const card = makeCard({ seed: 500 + s * 13, W, H, ...opt, iconSize: (opt.iconSize ?? 46) * k, pitch: 118 * k, tableTop: 520 * k });
    // le coordinate attese sono in pixel della carta di larghezza W; si riportano alla scala di lavoro
    const small = resizeGray(card.gray, SCAN_W, Math.round(H * SCAN_W / W));
    const { rows } = findWeaponRowsGray(small, templates, { sensitivity: 0.5 });
    const kk = SCAN_W / W;
    const truth = card.truth.map((t) => ({ ...t, y0: t.y0 * kk, y1: t.y1 * kk }));
    sExp += truth.length; sFound += rows.length;
    let allOk = rows.length === truth.length;
    rows.forEach((r, i) => {
      const t = truth[i];
      if (!t) { sFp++; return; }
      const err0 = Math.abs(r.y0 - t.y0) / (t.y1 - t.y0), kindOk = r.kind === t.kind;
      if (err0 > 0.35 || !kindOk) { allOk = false; badBand++; }
    });
    if (rows.length < truth.length) miss += truth.length - rows.length;
    falsePos += Math.max(0, rows.length - truth.length);
    if (allOk) sOk++;
  }
  tot += n; ok += sOk;
  console.log(`${name.padEnd(40)} carte ok ${sOk}/${n}  righe attese ${sExp} trovate ${sFound}  extra ${sFp}`);
}
console.log(`\nTotale: ${ok}/${tot} carte con TUTTE le righe giuste. Mancanti ${miss}, extra ${falsePos}, fasce sbagliate (tipo o posizione) ${badBand}. ${(Date.now() - t0)} ms`);
process.exit(ok === tot ? 0 : 1);
