// Azioni (Passo 8): sezione "Azioni" della Libreria, dentro un gioco, e sezione "Valide per tutti i giochi".
//
// - Importa PNG: uno o piu' PNG; ogni file diventa un'azione mode 'png' con nome dal file (pick_up_marker.png ->
//   Pick Up Marker). Il Blob e' salvato SENZA ricompressione (stessi byte) e Anteprima, Salva, Condividi, Crea e i
//   recenti lo esportano identico.
// - Nuova azione / Modifica: nome, testo sullo sticker, colore accento, ambito (un gioco o tutti), icona facoltativa;
//   mode 'generated' (disegnata col template di tipo action).
// - gameId null = valida per tutti i giochi. IndexedDB non indicizza null: si usa D.listActions / D.listGlobalActions.
//
// libreria.js passa i suoi componenti (h) per non avere un'importazione circolare.

import * as D from '../db.js';
import { toast } from '../app.js';
import { esc, openSheet, closeSheet, confirmSheet, menuSheet, formSheet } from '../ui.js';
import { pickImage } from '../crop.js';
import { nameFromFile, isPngBytes, planImport } from '../actionfiles.js';

const THUMB_SIDE = 96;
const ICON_MAX = 512;

// Colori accento (valore salvato: '#rrggbb' oppure '' = nessuno).
const ACTION_COLORS = [
  ['', 'Nessuno'], ['#e53935', 'Rosso'], ['#fb8c00', 'Arancione'], ['#fdd835', 'Giallo'],
  ['#43a047', 'Verde'], ['#00acc1', 'Azzurro'], ['#1e88e5', 'Blu'], ['#8e24aa', 'Viola'],
  ['#ec407a', 'Rosa'], ['#bdbdbd', 'Grigio'], ['#ffffff', 'Bianco']
];

function colorOptions(current) {
  const cur = String(current || '').toLowerCase();
  const options = ACTION_COLORS.map(([value, label]) => ({ value, label }));
  if (cur && !ACTION_COLORS.some(([v]) => v === cur)) options.push({ value: cur, label: `Personalizzato (${cur})` });
  return { cur, options };
}

// ---------- immagini ----------

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob fallito'))), 'image/png'));
}

function drawScaled(bitmap, maxSide) {
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k)), h = Math.max(1, Math.round(bitmap.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return c;
}

async function decode(file, opts) {
  try { return await createImageBitmap(file, opts); } catch (err) { console.error(err); throw new Error('immagine non leggibile'); }
}

// Icona di un'azione disegnata: PNG con trasparenza, lato lungo max 512 px.
async function prepareIcon(file) {
  const bitmap = await decode(file, { imageOrientation: 'from-image' });
  try {
    const c = drawScaled(bitmap, ICON_MAX);
    return { blob: await canvasToPng(c), width: c.width, height: c.height, thumb: await canvasToPng(drawScaled(c, THUMB_SIDE)) };
  } finally { bitmap.close && bitmap.close(); }
}

// PNG importato: i byte restano quelli del file (nessuna ricompressione); si legge solo la misura e si fa la miniatura.
async function preparePng(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!isPngBytes(head)) throw new Error('non è un PNG');
  const bitmap = await decode(file);
  try {
    return {
      blob: file.slice(0, file.size, 'image/png'), width: bitmap.width, height: bitmap.height,
      thumb: await canvasToPng(drawScaled(bitmap, THUMB_SIDE))
    };
  } finally { bitmap.close && bitmap.close(); }
}

// Selettore file (anche multiplo). Va chiamato subito dentro il tocco dell'utente.
function pickFiles({ multiple = false, accept = 'image/png,.png' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    let done = false;
    const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish(input.files ? [...input.files] : []));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

// ---------- pannello Nuova azione / Modifica ----------

// Restituisce { name, label, color, scope: 'all'|<id gioco>, icon: { blob,... } | 'remove' | null } oppure null se annullato.
// scopes: [{ value, label }] (vuoto = non si chiede l'ambito).
function actionSheet({ title, askName = false, label = '', color = '', scope = null, scopes = [], hasIcon = false }) {
  return new Promise((resolve) => {
    let result = null;
    let icon = null;            // { blob, ... } preparata, 'remove', oppure null (invariata)
    let iconJob = null;         // preparazione in corso
    const { cur, options } = colorOptions(color);
    const sheet = openSheet(`
      <form novalidate>
        <h3 class="sheet-title">${esc(title)}</h3>
        ${askName ? `<label class="field"><span>Nome</span><input type="text" name="name" autocomplete="off" autocapitalize="words" spellcheck="false"></label>` : ''}
        <label class="field"><span>Testo sullo sticker (facoltativo: se vuoto scrive il nome)</span>
          <input type="text" name="label" value="${esc(label)}" autocomplete="off" spellcheck="false"></label>
        ${scopes.length ? `<label class="field"><span>Valida per</span><select name="scope">${scopes.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(scope) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Colore accento (facoltativo)</span><select name="color">${options.map((o) => `<option value="${esc(o.value)}"${o.value === cur ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
        <div class="field"><span>Icona (facoltativa, a sinistra del testo)</span>
          <div class="row"><button type="button" data-icon>${hasIcon ? 'Cambia icona' : 'Scegli icona'}</button>${hasIcon ? '<button type="button" data-icon-clear>Rimuovi icona</button>' : ''}</div>
          <p class="meta" data-icon-status>${hasIcon ? 'Icona attuale mantenuta.' : 'Nessuna icona.'}</p></div>
        <div class="row">
          <button type="button" data-cancel>Annulla</button>
          <button type="submit" class="primary">Salva</button>
        </div>
      </form>`, { onClose: () => resolve(result) });
    const form = sheet.querySelector('form');
    const status = sheet.querySelector('[data-icon-status]');
    sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-icon]').addEventListener('click', async () => {
      const file = await pickImage(); // niente await prima: il selettore va aperto subito
      if (!file) return;
      status.textContent = 'Preparo l\'icona…';
      iconJob = prepareIcon(file).then((p) => { icon = p; status.textContent = `Icona scelta: ${file.name}`; })
        .catch((err) => { icon = null; status.textContent = 'Icona non valida: ' + err.message; });
    });
    const clear = sheet.querySelector('[data-icon-clear]');
    if (clear) clear.addEventListener('click', () => { icon = 'remove'; iconJob = null; status.textContent = 'L\'icona verrà rimossa.'; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (iconJob) await iconJob;
      const nameInput = form.elements.name;
      const n = nameInput ? nameInput.value.trim() : null;
      if (nameInput && !n) { nameInput.classList.add('invalid'); nameInput.focus(); return; }
      result = {
        name: n, label: form.elements.label.value.trim(), color: form.elements.color.value,
        scope: form.elements.scope ? form.elements.scope.value : null, icon
      };
      closeSheet();
    });
    const first = form.querySelector('input[type="text"]');
    if (first) setTimeout(() => first.focus(), 50);
  });
}

// ---------- sezioni ----------

// h = componenti di libreria.js: { sectionHead, listHTML, onAdd, onMenu, entityMenu, blobUrl, guard }.
// game = gioco aperto (o null: schermata dei giochi, solo le azioni valide per tutti).
export async function actionsSections(ctx, h, game) {
  const [own, glob] = await Promise.all([game ? D.listActions(game.id, { includeGlobal: false }) : [], D.listGlobalActions()]);
  const imgs = await D.getImagesById([...own, ...glob].map((a) => a.imageId).filter((x) => x != null));
  const thumb = (a) => {
    const r = a.imageId != null ? imgs.get(a.imageId) : null;
    return r ? h.blobUrl(ctx, r.thumb || r.blob) : null;
  };
  const meta = (a) => [D.actionMode(a) === 'png' ? 'PNG importato' : (a.imageId != null ? 'Con icona' : 'Disegnata'), a.label ? `scrive «${a.label}»` : ''].filter(Boolean).join(' · ');
  const section = (key, title, items, empty) => `
    ${h.sectionHead(title, key)}
    <div class="row"><button type="button" data-import-png="${key}">Importa PNG</button></div>
    ${h.listHTML(key, items, { thumb, dot: (a) => a.accentColor, meta, empty })}`;

  const html = (game ? section('action', 'Azioni', own, 'Nessuna azione. Importa dei PNG o tocca + per crearne una (es. Overwatch, Charge).') : '')
    + section('gaction', 'Azioni valide per tutti i giochi', glob, 'Nessuna. Servono per le azioni uguali in ogni gioco.');

  const scopesFor = () => (game ? [{ value: String(game.id), label: `Solo ${game.name}` }, { value: 'all', label: 'Tutti i giochi' }] : []);
  const gameIdOf = (scope) => (scope === 'all' || scope == null ? null : Number(scope));
  const dupMessage = 'Esiste già un\'azione con questo nome.';

  async function addNew(defaultScope) {
    const v = await actionSheet({ title: 'Nuova azione', askName: true, scopes: scopesFor(), scope: defaultScope });
    if (!v) return;
    const gameId = game ? gameIdOf(v.scope) : null;
    await h.guard(async () => {
      if (await D.findActionByName(gameId, v.name)) { toast(dupMessage); return; }
      await D.addAction(gameId, v.name, v.color, { label: v.label, image: v.icon && v.icon !== 'remove' ? v.icon : null });
      ctx.refresh();
    });
  }

  async function edit(a) {
    const scopes = game ? scopesFor() : [];
    // Dalla schermata dei giochi non si sposta in un gioco: l'ambito resta com'e'.
    const v = await actionSheet({
      title: `Modifica: ${a.name}`, label: a.label || '', color: a.accentColor || '',
      scopes, scope: a.gameId == null ? 'all' : String(a.gameId), hasIcon: a.imageId != null
    });
    if (!v) return;
    await h.guard(async () => {
      const changes = { label: v.label, accentColor: v.color };
      if (game && v.scope != null) {
        const gid = gameIdOf(v.scope);
        if (gid !== (a.gameId ?? null)) {
          const dup = await D.findActionByName(gid, a.name);
          if (dup && dup.id !== a.id) { toast(dupMessage); return; }
          changes.gameId = gid;
        }
      }
      await D.updateAction(a.id, changes);
      if (v.icon === 'remove') await D.removeActionImage(a.id);
      else if (v.icon) await D.setActionImage(a.id, v.icon.blob, v.icon.width, v.icon.height, v.icon.thumb);
      toast('Salvata');
      ctx.refresh();
    });
  }

  async function moveScope(a, gid) {
    await h.guard(async () => {
      const dup = await D.findActionByName(gid, a.name);
      if (dup && dup.id !== a.id) { toast(dupMessage); return; }
      await D.updateAction(a.id, { gameId: gid });
      toast(gid == null ? 'Ora vale per tutti i giochi' : `Ora vale solo per ${game.name}`);
      ctx.refresh();
    });
  }

  // gameId: dove importare (null = tutti i giochi). Il selettore si apre subito nel tocco.
  async function importPngs(gameId) {
    const files = await pickFiles({ multiple: true });
    if (!files.length) return;
    await h.guard(async () => {
      toast(files.length > 1 ? `Leggo ${files.length} file…` : 'Leggo il file…');
      const items = [], problems = [];
      for (const f of files) {
        const name = nameFromFile(f.name);
        if (!name) { problems.push(`${f.name}: nome non ricavabile dal file`); continue; }
        try { items.push({ name, file: f, prepared: await preparePng(f) }); } catch (err) { problems.push(`${f.name}: ${err.message}`); }
      }
      const existing = gameId == null ? await D.listGlobalActions() : await D.listActions(gameId, { includeGlobal: false });
      const plan = planImport(items, existing);
      plan.dupInBatch.forEach((it) => problems.push(`${it.file.name}: «${it.name}» compare più volte, tengo solo il primo`));
      let doReplace = false;
      if (plan.replace.length) {
        doReplace = await confirmSheet({
          title: 'Azioni già presenti',
          lines: [plan.replace.map((r) => r.existing.name).join(', '),
            'Sostituisci: aggiorna il PNG (preferiti e recenti restano). Annulla: le salto e importo solo le nuove.'],
          confirmLabel: 'Sostituisci'
        });
      }
      for (const it of plan.fresh) await D.addAction(gameId, it.name, null, { mode: 'png', image: it.prepared });
      let replaced = 0;
      if (doReplace) {
        for (const r of plan.replace) { const p = r.item.prepared; await D.setActionPng(r.existing.id, p.blob, p.width, p.height, p.thumb); replaced++; }
      }
      const skipped = doReplace ? 0 : plan.replace.length;
      const parts = [`Importate ${plan.fresh.length}`];
      if (replaced) parts.push(`sostituite ${replaced}`);
      if (skipped) parts.push(`saltate ${skipped}`);
      toast(parts.join(', '));
      ctx.refresh();
      if (problems.length) {
        await confirmSheet({ title: 'Alcuni file non sono stati importati', lines: problems, confirmLabel: 'OK' });
      }
    });
  }

  // Sostituisce il PNG di un'azione gia' importata (un solo file).
  async function replacePng(a) {
    const files = await pickFiles({ multiple: false });
    if (!files.length) return;
    await h.guard(async () => {
      const p = await preparePng(files[0]);
      await D.setActionPng(a.id, p.blob, p.width, p.height, p.thumb);
      toast('PNG sostituito');
      ctx.refresh();
    });
  }

  function menuFor(a) {
    const png = D.actionMode(a) === 'png';
    const extra = [{ label: 'Anteprima sticker', run: () => { location.hash = `#/anteprima?action=${a.id}`; } }];
    if (png) extra.push({ label: 'Sostituisci PNG', run: () => replacePng(a) });
    else extra.push({ label: 'Modifica testo, colore, icona…', run: () => edit(a) });
    if (game && a.gameId == null) extra.push({ label: `Limita a ${game.name}`, run: () => moveScope(a, game.id) });
    if (game && a.gameId != null) extra.push({ label: 'Valida per tutti i giochi', run: () => moveScope(a, null) });
    h.entityMenu(a, {
      ctx, table: 'actions', extra,
      rename: async () => {
        const v = await formSheet({ title: 'Rinomina azione', fields: [{ name: 'name', label: 'Nome', value: a.name, type: 'text', required: true }] });
        if (!v) return;
        await h.guard(async () => {
          const dup = await D.findActionByName(a.gameId ?? null, v.name);
          if (dup && dup.id !== a.id) { toast(dupMessage); return; }
          await D.patch('actions', a.id, { name: v.name });
          ctx.refresh();
        });
      },
      remove: async () => {
        const ok = await confirmSheet({
          title: `Eliminare «${a.name}»?`,
          lines: a.gameId == null ? ['Vale per tutti i giochi: sparirà da ogni gioco.'] : [],
          confirmLabel: 'Elimina', danger: true
        });
        if (!ok) return;
        await h.guard(async () => { await D.deleteAction(a.id); toast('Eliminata'); ctx.refresh(); });
      }
    });
  }

  const wire = (root) => {
    if (game) {
      h.onAdd(root, 'action', () => addNew(String(game.id)));
      h.onMenu(root, 'action', own, menuFor);
    }
    h.onAdd(root, 'gaction', () => addNew('all'));
    h.onMenu(root, 'gaction', glob, menuFor);
    root.querySelectorAll('[data-import-png]').forEach((b) => b.addEventListener('click', () => {
      importPngs(b.dataset.importPng === 'gaction' || !game ? null : game.id); // niente await prima: il selettore va aperto subito
    }));
  };
  return { html, wire };
}
