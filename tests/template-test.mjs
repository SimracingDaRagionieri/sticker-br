// Prove delle parti pure dell'editor dei template: node tests/template-test.mjs
import { setAt, getAt, moveItem, groupsFor, LINE_CONTROLS, newLine, sourcesFor, hex6, uniqueName } from '../js/templateedit.js';
import { normalizeConfig } from '../js/render.js';

let fails = 0, n = 0;
const check = (c, m) => { n++; console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

// percorsi
const o = {};
setAt(o, 'plate.border.width', 6);
check(o.plate.border.width === 6, 'setAt crea gli oggetti intermedi');
setAt(o, 'plate.border', undefined);
check(!('border' in o.plate), 'setAt con undefined toglie la chiave');
check(getAt({ a: { b: 1 } }, 'a.b') === 1 && getAt({}, 'a.b.c') === undefined, 'getAt');

// ordine righe
const arr = ['a', 'b', 'c'];
check(moveItem(arr, 0, -1) === 0 && arr.join('') === 'abc', 'moveItem fuori dai limiti non fa nulla');
check(moveItem(arr, 0, 1) === 1 && arr.join('') === 'bac', 'moveItem scambia');

// schema: ogni percorso e' coerente col motore e i valori effettivi stanno dentro i limiti dei cursori
for (const kind of ['activation', 'action']) {
  const cfg = normalizeConfig({ lines: [newLine(kind)] });
  const ctrls = groupsFor(kind).flatMap((g) => g.controls || []);
  check(ctrls.length > 10, `${kind}: schema con ${ctrls.length} controlli`);
  for (const c of ctrls) {
    if (c.type === 'border') continue;
    const v = getAt(cfg, c.path);
    check(v !== undefined, `${kind}: ${c.path} esiste in normalizeConfig`);
    if (c.type === 'range') {
      const shown = v * (c.scale || 1);
      check(shown >= c.min && shown <= c.max, `${kind}: ${c.path} (${shown}) dentro ${c.min}-${c.max}`);
    }
  }
  const line = cfg.lines[0];
  for (const c of LINE_CONTROLS) check(getAt(line, c.path) !== undefined || c.path.startsWith('stroke'), `riga: ${c.path} letto da normLine`);
}
check(!groupsFor('action').some((g) => g.id === 'weapon'), 'azione: nessun gruppo "Immagine arma"');
check(groupsFor('activation').some((g) => g.id === 'weapon'), 'attivazione: gruppo "Immagine arma"');
check(groupsFor('action').find((g) => g.id === 'image').title === 'Icona azione', 'azione: il gruppo immagine si chiama "Icona azione"');

// i template predefiniti si leggono per intero dal motore (stessi valori di prima)
check(normalizeConfig({ image: { show: true } }).image.show === true, 'image.show true letto');
check(JSON.stringify(sourcesFor('action')) === '["action","text"]' && sourcesFor('action', 'unit').includes('unit'), 'origini per tipo');
check(hex6('#abc') === '#aabbcc' && hex6('zzz', '#000000') === '#000000' && hex6('E8B04A') === '#e8b04a', 'hex6');
check(uniqueName('Prova', ['prova', 'Prova 2']) === 'Prova 3' && uniqueName('X', []) === 'X', 'uniqueName');

console.log(fails ? `\n${fails} FALLITI su ${n}` : `\nTutti i controlli passati (${n})`);
process.exit(fails ? 1 : 0);
