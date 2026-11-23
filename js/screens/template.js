// Schermata Template (Passo 9).
//   #/template            elenco per tipo (Attivazione, Azione): Modifica, Duplica, Rinomina, Imposta predefinito, Elimina
//   #/template?id=<id>    editor: anteprima fissa in alto, gruppi a fisarmonica, salvataggio automatico
// Il disegno e' sempre renderSticker (lo stesso di Anteprima e Crea), quindi il PNG esportato e' quello dell'anteprima.

import * as D from '../db.js';
import { renderSticker, normalizeConfig } from '../render.js';
import { toast, parseHash, canGoBack } from '../app.js';
import { esc, menuSheet, confirmSheet, formSheet } from '../ui.js';
import { isPngAction } from '../stickerinput.js';
import { importFont, removeFont, familyFromFilename, fontFamilies, BUILTIN_FONTS } from '../fonts.js';
import {
  SAMPLE, SOURCE_LABELS, sourcesFor, newLine, getAt, setAt, moveItem, groupsFor, LINE_CONTROLS, hex6
} from '../templateedit.js';

const KIND_TITLE = { activation: 'Attivazione', action: 'Azione', result: 'Risultato' };
let token = 0;
let leaveHook = null; // salva le modifiche in sospeso quando si lascia l'editor

export function cleanup() {
  token++;
  if (leaveHook) { const f = leaveHook; leaveHook = null; f(); }
}

const intParam = (q, name) => { const v = q.get(name); return v !== null && /^\d+$/.test(v) ? Number(v) : null; };

export async function render(el) {
  const my = ++token;
  try { await D.ready(); } catch (err) { console.error(err); el.innerHTML = '<h1>Template</h1><p class="empty">Impossibile aprire il database.</p>'; return; }
  if (my !== token) return;
  const id = intParam(parseHash().query, 'id');
  if (id != null) await renderEditor(el, id, my);
  else await renderList(el, my);
}

// ---------- azioni comuni (elenco ed editor) ----------

async function askName(title, value) {
  const r = await formSheet({ title, fields: [{ name: 'name', label: 'Nome', value, required: true }] });
  return r ? r.name : null;
}

// Importa un font: sceglie il file, chiede il nome (si ripete finche' e' valido o si annulla). Restituisce true se importato.
export function pickAndImportFont() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.woff2,.woff,font/ttf,font/otf,font/woff2,font/woff';
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = (v) => { if (done) return; done = true; input.remove(); resolve(v); };
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return finish(false);
      let name = familyFromFilename(file.name);
      for (;;) {
        name = await askName('Nome del font', name);
        if (name == null) return finish(false);
        try {
          await importFont(file, name);
          toast('Font importato: ' + name);
          return finish(true);
        } catch (err) {
          toast(err.message);
        }
      }
    });
    input.addEventListener('cancel', () => finish(false));
    input.click();
  });
}

async function templateMenu(t, { isDefault, countOfKind }, after) {
  const items = [];
  if (after.edit) items.push({ label: 'Modifica', run: () => after.edit(t) });
  items.push({
    label: 'Duplica',
    run: async () => {
      try { const nid = await D.duplicateTemplate(t.id); toast('Template duplicato'); after.duplicated(nid); } catch (err) { toast(err.message); }
    }
  });
  items.push({
    label: 'Rinomina',
    run: async () => {
      const name = await askName('Rinomina template', t.name);
      if (name == null || name === t.name) return;
      try { await D.renameTemplate(t.id, name); after.changed(); } catch (err) { toast(err.message); }
    }
  });
  if (!isDefault) {
    items.push({
      label: 'Imposta predefinito',
      run: async () => { await D.setDefaultTemplate(t.id); toast('Predefinito: ' + t.name); after.changed(); }
    });
  }
  if (countOfKind > 1) {
    items.push({
      label: 'Elimina',
      danger: true,
      run: async () => {
        const ok = await confirmSheet({
          title: `Eliminare "${t.name}"?`,
          lines: ['Gli sticker recenti e preferiti che lo usano passeranno al template predefinito del tipo.'],
          confirmLabel: 'Elimina', danger: true
        });
        if (!ok) return;
        try { await D.deleteTemplate(t.id); toast('Template eliminato'); after.deleted(); } catch (err) { toast(err.message); }
      }
    });
  }
  menuSheet(t.name, items);
}

// ---------- elenco ----------

async function renderList(el, my) {
  const alive = () => my === token && el.isConnected;
  const draw = async () => {
    const [byKind, fonts, defaults] = await Promise.all([
      Promise.all(D.TEMPLATE_KINDS.map(async (k) => [k, await D.listTemplates(k)])),
      D.listFonts(),
      Promise.all(D.TEMPLATE_KINDS.map((k) => D.getDefaultTemplate(k)))
    ]);
    if (!alive()) return;
    const defId = Object.fromEntries(D.TEMPLATE_KINDS.map((k, i) => [k, defaults[i] ? defaults[i].id : null]));
    el.innerHTML = `
      <h1>Template</h1>
      <p class="meta">Un template decide l'aspetto degli sticker. Tocca un template per modificarlo; il predefinito è quello che Crea usa quando non scegli altro.</p>
      ${byKind.map(([k, rows]) => `
        <h2>${KIND_TITLE[k]}</h2>
        <ul class="list" data-kind="${k}">
          ${rows.map((t) => `
            <li class="item">
              <a class="item-main" href="#/template?id=${t.id}">
                <span class="item-name">${esc(t.name)}</span>
                ${t.id === defId[k] ? '<span class="item-meta"><span class="star">★</span> Predefinito</span>' : ''}
                <span class="chev">›</span>
              </a>
              <button type="button" class="kebab" data-menu="${t.id}" aria-label="Azioni per ${esc(t.name)}">⋮</button>
            </li>`).join('')}
        </ul>`).join('')}
      <h2>Font</h2>
      <p class="meta">Oltre a ${BUILTIN_FONTS.join(', ')}, puoi importare font .ttf, .otf, .woff2: restano sul telefono e funzionano anche offline.</p>
      <ul class="list" data-fonts>
        ${fonts.map((f) => `
          <li class="item">
            <div class="item-main"><span class="item-name" style="font-family:'${esc(f.family)}', sans-serif">${esc(f.family)}</span><span class="item-meta">${esc(f.format)}</span></div>
            <button type="button" class="kebab" data-font-menu="${f.id}" aria-label="Azioni per ${esc(f.family)}">⋮</button>
          </li>`).join('') || '<li class="empty">Nessun font importato.</li>'}
      </ul>
      <div class="row"><button type="button" data-import-font>Importa font</button></div>`;

    const kindOf = (id) => byKind.find(([, rows]) => rows.some((t) => t.id === id));
    el.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => {
      const tid = Number(b.dataset.menu);
      const [k, rows] = kindOf(tid) || [];
      const t = rows && rows.find((x) => x.id === tid);
      if (!t) return;
      templateMenu(t, { isDefault: defId[k] === tid, countOfKind: rows.length }, {
        edit: (x) => { location.hash = '#/template?id=' + x.id; },
        duplicated: draw, changed: draw, deleted: draw
      });
    }));
    el.querySelectorAll('[data-font-menu]').forEach((b) => b.addEventListener('click', () => {
      const f = fonts.find((x) => x.id === Number(b.dataset.fontMenu));
      if (!f) return;
      menuSheet(f.family, [{
        label: 'Elimina font', danger: true,
        run: async () => {
          const ok = await confirmSheet({
            title: `Eliminare il font "${f.family}"?`,
            lines: ['I template che lo usano useranno Roboto Condensed.'], confirmLabel: 'Elimina', danger: true
          });
          if (!ok) return;
          await removeFont(f.id);
          toast('Font eliminato');
          draw();
        }
      }]);
    }));
    el.querySelector('[data-import-font]').addEventListener('click', async () => { if (await pickAndImportFont()) draw(); });
  };
  await draw();
}

// ---------- immagini di esempio (solo per l'anteprima dell'editor) ----------

function placeholderBlob(w, h, label, hue) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue} 55% 45%)`);
  g.addColorStop(1, `hsl(${hue + 40} 55% 25%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) / 50));
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - 2 * ctx.lineWidth, h - 2 * ctx.lineWidth);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.font = `700 ${Math.round(Math.min(w, h) / 5)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

// Dati di esempio: l'ultimo recente del tipo (nomi e immagini veri; immagini di esempio dove mancano), altrimenti nomi di esempio.
async function pickSample(kind) {
  const base = SAMPLE[kind];
  const sample = { data: { ...base, accentColor: null, unitImage: null, weaponImage: null }, from: null };
  // Risultato (Passo 11): sempre nomi e testi di esempio (i recenti non hanno risultati), con immagini di esempio.
  if (kind === 'result') {
    sample.data.unitImage = await placeholderBlob(400, 300, 'IMG', 210);
    sample.data.weaponImage = await placeholderBlob(900, 160, 'PROFILO ARMA', 30);
    return sample;
  }
  try {
    for (const r of await D.listRecents()) {
      if (kind === 'action' ? r.actionId == null : r.unitId == null) continue;
      const src = await D.getStickerSource({ unitId: r.unitId, weaponId: r.weaponId, actionId: r.actionId });
      if (kind === 'action') {
        if (!src.action || isPngAction(src)) continue;
        sample.data.actionName = (src.action.label && src.action.label.trim()) || src.action.name;
        sample.data.unitImage = src.actionImage || null;
        sample.data.accentColor = src.action.accentColor || null;
        sample.from = sample.data.actionName;
      } else {
        if (!src.unit) continue;
        sample.data.unitName = src.unit.name;
        sample.data.weaponName = src.weapon ? src.weapon.name : base.weaponName;
        sample.data.factionName = src.faction ? src.faction.name : base.factionName;
        sample.data.unitImage = src.unitImage || null;
        sample.data.weaponImage = src.weaponImage || null;
        sample.from = sample.data.unitName;
      }
      break;
    }
  } catch (err) { console.warn('Dati di esempio', err); }
  if (!sample.data.unitImage) sample.data.unitImage = await placeholderBlob(kind === 'action' ? 256 : 400, kind === 'action' ? 256 : 300, kind === 'action' ? 'ICONA' : 'IMG', 210);
  if (kind === 'activation' && !sample.data.weaponImage) sample.data.weaponImage = await placeholderBlob(900, 160, 'PROFILO ARMA', 30);
  return sample;
}

// ---------- editor ----------

async function renderEditor(el, id, my) {
  const alive = () => my === token && el.isConnected;
  const tpl = await D.getTemplate(id);
  if (!alive()) return;
  const back = () => { if (canGoBack()) history.back(); else location.replace('#/template'); };
  if (!tpl) {
    el.innerHTML = `<div class="title-row"><h1>Template</h1></div><p class="empty">Template non trovato: potrebbe essere stato eliminato.</p>
      <div class="row"><a class="btn btn-link" href="#/template">Elenco template</a></div>`;
    return;
  }
  const kind = tpl.kind;
  const cfg = structuredClone(tpl.config || {});
  const [sample, fonts] = await Promise.all([pickSample(kind), fontFamilies()]);
  if (!alive()) return;
  const groups = groupsFor(kind);

  // --- valori mostrati: quelli effettivi del motore (aprire un template non lo cambia) ---
  const eff = () => normalizeConfig(cfg);
  const lineEff = (i) => {
    const e = eff().lines[i] || {};
    const raw = (cfg.lines && cfg.lines[i]) || {};
    return { ...e, stroke: { width: e.stroke ? e.stroke.width : 0, color: (e.stroke && e.stroke.color) || (raw.stroke && raw.stroke.color) || '#000000' } };
  };
  const valueAt = (p) => {
    const m = /^lines\.(\d+)\.(.+)$/.exec(p);
    return m ? getAt(lineEff(Number(m[1])), m[2]) : getAt(eff(), p);
  };

  // --- HTML dei controlli ---
  const ctl = (c, base = '') => {
    const p = base + c.path;
    if (c.type === 'toggle') return `<label class="check"><input type="checkbox" data-p="${p}"><span>${esc(c.label)}</span></label>`;
    if (c.type === 'color') return `<label class="field tpl-color"><span>${esc(c.label)}</span><input type="color" data-p="${p}"></label>`;
    if (c.type === 'choice') {
      return `<div class="field"><span>${esc(c.label)}</span><div class="chips" role="group" aria-label="${esc(c.label)}">${
        c.options.map(([v, l]) => `<button type="button" class="chip" data-choice="${p}" data-v="${v}" aria-pressed="false">${esc(l)}</button>`).join('')}</div></div>`;
    }
    if (c.type === 'border') {
      return `<div class="tpl-border" data-border="${p}">
        <label class="check"><input type="checkbox" data-bd-on><span>${esc(c.label)}</span></label>
        <div class="tpl-border-f">
          ${ctl({ type: 'range', path: 'width', label: 'Spessore', min: 1, max: 30, step: 1, suffix: ' px' }, p + '.')}
          ${ctl({ type: 'color', path: 'color', label: 'Colore' }, p + '.')}
        </div></div>`;
    }
    return `<div class="field tpl-range"><span>${esc(c.label)}</span>
      <div class="tpl-rr"><input type="range" data-p="${p}" min="${c.min}" max="${c.max}" step="${c.step}" ${c.scale ? `data-scale="${c.scale}"` : ''} aria-label="${esc(c.label)}">
      <input type="number" inputmode="numeric" data-pn="${p}" min="${c.min}" max="${c.max}" step="${c.step}" ${c.scale ? `data-scale="${c.scale}"` : ''} aria-label="${esc(c.label)} (valore)">
      <span class="tpl-unit">${esc((c.suffix || '').trim())}</span></div></div>`;
  };

  const lineHTML = (i) => {
    const l = (cfg.lines || [])[i] || {};
    const cur = l.source || 'text';
    const srcs = sourcesFor(kind, cur);
    const fam = lineEff(i).font;
    const opts = fonts.includes(fam) ? fonts : [...fonts, fam];
    return `<details class="tpl-line" data-line="${i}"${lineOpen.has(i) ? ' open' : ''}>
      <summary><span class="tpl-line-name">Riga ${i + 1} · ${esc(SOURCE_LABELS[cur] || cur)}</span></summary>
      <div class="tpl-line-tools">
        <button type="button" data-line-up aria-label="Sposta su"${i === 0 ? ' disabled' : ''}>▲</button>
        <button type="button" data-line-down aria-label="Sposta giù"${i === (cfg.lines || []).length - 1 ? ' disabled' : ''}>▼</button>
        <button type="button" class="danger" data-line-del aria-label="Rimuovi riga">Rimuovi</button>
      </div>
      <label class="field"><span>Origine del testo</span><select data-p="lines.${i}.source">
        ${srcs.map((s) => `<option value="${s}">${esc(SOURCE_LABELS[s] || s)}</option>`).join('')}</select></label>
      ${cur === 'text' ? `<label class="field"><span>Testo fisso</span><input type="text" data-p="lines.${i}.text" autocomplete="off" spellcheck="false"></label>` : ''}
      <label class="field"><span>Font</span><select data-p="lines.${i}.font">
        ${opts.map((f) => `<option value="${esc(f)}">${esc(f)}${fonts.includes(f) ? '' : ' (non trovato)'}</option>`).join('')}</select></label>
      ${LINE_CONTROLS.map((c) => ctl(c, `lines.${i}.`)).join('')}
    </details>`;
  };
  const lineOpen = new Set([0]);

  const groupHTML = (g) => {
    if (g.lines) {
      return `<div data-lines>${(cfg.lines || []).map((_, i) => lineHTML(i)).join('')}</div>
        <div class="row"><button type="button" data-line-add>+ Riga di testo</button><button type="button" data-import-font>Importa font</button></div>`;
    }
    return g.controls.map((c) => ctl(c)).join('');
  };

  el.innerHTML = `
    <div class="tpl-top">
      <div class="title-row">
        <div class="title-left">
          <button type="button" class="back" data-back aria-label="Indietro">‹</button>
          <h1 class="tpl-h1">${esc(tpl.name)}</h1>
        </div>
        <button type="button" class="kebab" data-tpl-menu aria-label="Azioni template">⋮</button>
      </div>
      <div class="tpl-preview checker-bg"><img id="pv-img" alt="Anteprima del template" hidden><span class="pv-wait" id="pv-wait">Disegno lo sticker…</span></div>
      <p class="meta tpl-sample"><span id="tpl-saved">Salvataggio automatico</span> · esempio: ${esc(kind === 'action' ? sample.data.actionName : kind === 'result' ? sample.data.targetName : sample.data.unitName)}${sample.from ? '' : ' (nomi di esempio)'}; le immagini di esempio compaiono solo qui.</p>
    </div>
    <div class="tpl-groups">
      ${groups.map((g) => `<details class="tpl-group" data-group="${g.id}"${g.id === 'size' ? ' open' : ''}><summary>${esc(g.title)}</summary><div class="tpl-body">${groupHTML(g)}</div></details>`).join('')}
    </div>`;

  const $ = (s) => el.querySelector(s);
  const img = $('#pv-img');
  const wait = $('#pv-wait');
  const savedEl = $('#tpl-saved');

  // --- valori nei controlli ---
  function syncControls(skip) {
    const e = eff();
    el.querySelectorAll('[data-p]').forEach((inp) => {
      if (inp === skip) return;
      const p = inp.dataset.p;
      let v = valueAt(p);
      if (inp.type === 'checkbox') inp.checked = !!v;
      else if (inp.type === 'color') {
        // il colore del bordo / del contorno puo' mancare mentre e' spento: resta l'ultimo noto
        inp.value = hex6(v ?? getAt(cfg, p), inp.value || '#ffffff');
      } else if (inp.type === 'range') {
        const sc = Number(inp.dataset.scale || 1);
        inp.value = Math.round(Number(v ?? 0) * sc * 100) / 100;
      } else inp.value = v ?? '';
    });
    el.querySelectorAll('[data-pn]').forEach((inp) => {
      if (inp === skip) return;
      const sc = Number(inp.dataset.scale || 1);
      inp.value = Math.round(Number(valueAt(inp.dataset.pn) ?? 0) * sc * 100) / 100;
    });
    el.querySelectorAll('[data-choice]').forEach((b) => b.setAttribute('aria-pressed', String(valueAt(b.dataset.choice) === b.dataset.v)));
    el.querySelectorAll('[data-border]').forEach((box) => {
      const bd = getAt(e, box.dataset.border);
      box.querySelector('[data-bd-on]').checked = !!bd;
      box.querySelector('.tpl-border-f').hidden = !bd;
    });
    // il colore/spessore del bordo si leggono dal valore effettivo (assente = spento)
    el.querySelectorAll('[data-border]').forEach((box) => {
      const bd = getAt(e, box.dataset.border);
      if (!bd) return;
      const w = box.querySelector('[data-p$=".width"]'), wn = box.querySelector('[data-pn$=".width"]'), c = box.querySelector('[data-p$=".color"]');
      if (w && w !== skip) w.value = bd.width;
      if (wn && wn !== skip) wn.value = bd.width;
      if (c && c !== skip) c.value = hex6(bd.color);
    });
  }

  // --- disegno: al massimo una volta per frame, uno alla volta, solo l'ultimo risultato conta ---
  let rafId = 0, drawing = false, again = false, lastUrl = null;
  const buildData = () => ({ ...sample.data });
  async function drawNow() {
    if (drawing) { again = true; return; }
    drawing = true;
    try {
      do {
        again = false;
        let blob;
        try { blob = await renderSticker(buildData(), structuredClone(cfg)); } catch (err) {
          console.error(err);
          if (alive()) { wait.hidden = false; wait.textContent = 'Non riesco a disegnare lo sticker.'; }
          continue;
        }
        if (!alive() || again) continue; // c'e' gia' una modifica piu' recente: salto questo disegno
        const url = URL.createObjectURL(blob);
        const old = lastUrl;
        lastUrl = url;
        img.src = url;
        img.hidden = false;
        wait.hidden = true;
        if (old) URL.revokeObjectURL(old);
      } while (again && alive());
    } finally { drawing = false; }
  }
  const scheduleDraw = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; drawNow(); }); };

  // --- salvataggio automatico (400 ms dopo l'ultima modifica) ---
  let saveTimer = 0, dirty = false, saving = Promise.resolve();
  const saveNow = () => {
    clearTimeout(saveTimer);
    if (!dirty) return saving;
    dirty = false;
    const snapshot = structuredClone(cfg);
    saving = saving.then(() => D.setTemplateConfig(id, snapshot)).then((ok) => {
      if (ok === false) toast('Il template non esiste più: modifiche non salvate');
      else if (alive()) savedEl.textContent = 'Salvato';
    }).catch((err) => { console.error(err); toast('Errore di salvataggio: ' + err.message); });
    return saving;
  };
  const changed = () => {
    dirty = true;
    savedEl.textContent = 'Salvo…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
    scheduleDraw();
  };
  leaveHook = () => { saveNow(); URL.revokeObjectURL(lastUrl || ''); window.removeEventListener('pagehide', saveNow); };
  window.addEventListener('pagehide', saveNow);

  // --- scrittura ---
  const num = (inp) => {
    let v = Number(inp.value);
    if (!Number.isFinite(v)) return null;
    const min = Number(inp.min), max = Number(inp.max);
    if (inp.min !== '' && v < min) v = min;
    if (inp.max !== '' && v > max) v = max;
    return v / Number(inp.dataset.scale || 1);
  };
  const root = $('.tpl-groups');

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-p]')) {
      const p = t.dataset.p;
      if (t.type === 'checkbox') setAt(cfg, p, t.checked);
      else if (t.type === 'range') { const v = num(t); if (v === null) return; setAt(cfg, p, v); }
      else if (t.tagName === 'SELECT') {
        if (/\.weight$/.test(p)) setAt(cfg, p, Number(t.value)); else setAt(cfg, p, t.value);
      } else setAt(cfg, p, t.value);
      syncControls(t);
      changed();
    } else if (t.matches('[data-pn]')) {
      const v = num(t);
      if (v === null) return; // campo vuoto mentre si digita
      setAt(cfg, t.dataset.pn, v);
      syncControls(t);
      changed();
    } else if (t.matches('[data-bd-on]')) {
      const box = t.closest('[data-border]');
      const p = box.dataset.border;
      if (t.checked) {
        const last = box.querySelector('[data-p$=".color"]').value;
        const w = Number(box.querySelector('[data-p$=".width"]').value) || 4;
        setAt(cfg, p, { width: Math.max(1, w), color: hex6(last, '#e8b04a') });
      } else setAt(cfg, p, undefined);
      syncControls(null);
      changed();
    }
  });

  // le scelte a chip, la struttura delle righe
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.dataset.choice) {
      setAt(cfg, t.dataset.choice, t.dataset.v);
      syncControls(null);
      changed();
      return;
    }
    const lineEl = t.closest('[data-line]');
    const i = lineEl ? Number(lineEl.dataset.line) : -1;
    if (t.matches('[data-line-add]')) {
      cfg.lines = [...(cfg.lines || []), newLine(kind)];
      lineOpen.clear(); lineOpen.add(cfg.lines.length - 1);
      rebuildLines(); changed();
    } else if (t.matches('[data-line-del]')) {
      cfg.lines.splice(i, 1);
      lineOpen.clear();
      rebuildLines(); changed();
    } else if (t.matches('[data-line-up]') || t.matches('[data-line-down]')) {
      const j = moveItem(cfg.lines, i, t.matches('[data-line-up]') ? -1 : 1);
      lineOpen.clear(); lineOpen.add(j);
      rebuildLines(); changed();
    } else if (t.matches('[data-import-font]')) {
      pickAndImportFont().then(async (ok) => {
        if (!ok || !alive()) return;
        fonts.splice(0, fonts.length, ...(await fontFamilies()));
        rebuildLines();
        scheduleDraw();
      });
    }
  });

  // l'origine del testo cambia la struttura della riga (campo "Testo fisso"): ricostruisco
  root.addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('select[data-p$=".source"]')) rebuildLines();
    else if (e.target.matches && e.target.matches('[data-pn]')) syncControls(null); // a campo lasciato: mostra il valore davvero salvato
  });

  function rebuildLines() {
    const box = $('[data-lines]');
    el.querySelectorAll('.tpl-line[open]').forEach((d) => lineOpen.add(Number(d.dataset.line)));
    box.innerHTML = (cfg.lines || []).map((_, i) => lineHTML(i)).join('');
    syncControls(null);
  }
  // tengo traccia delle righe aperte
  root.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('.tpl-line')) { const i = Number(d.dataset.line); if (d.open) lineOpen.add(i); else lineOpen.delete(i); }
    // fisarmonica: un solo gruppo aperto alla volta
    if (d.matches && d.matches('.tpl-group') && d.open) {
      root.querySelectorAll('.tpl-group[open]').forEach((o) => { if (o !== d) o.open = false; });
    }
  }, true);

  // --- menu e navigazione ---
  $('[data-back]').addEventListener('click', back);
  $('[data-tpl-menu]').addEventListener('click', async () => {
    const [rows, def] = await Promise.all([D.listTemplates(kind), D.getDefaultTemplate(kind)]);
    const cur = rows.find((r) => r.id === id) || tpl;
    await saveNow();
    templateMenu(cur, { isDefault: !!def && def.id === id, countOfKind: rows.length }, {
      duplicated: (nid) => { location.hash = '#/template?id=' + nid; },
      changed: async () => { const r = await D.getTemplate(id); if (r && alive()) $('.tpl-h1').textContent = r.name; },
      deleted: () => { location.replace('#/template'); }
    });
  });

  syncControls(null);
  drawNow();
}
