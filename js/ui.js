// Pannelli dal basso (al posto di prompt/alert/confirm). Un solo pannello aperto alla volta.

let current = null;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function openSheet(html, { onClose } = {}) {
  closeSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSheet(); });
  document.body.appendChild(backdrop);
  current = { el: backdrop, onClose };
  return backdrop.querySelector('.sheet');
}

export function closeSheet() {
  if (!current) return;
  const { el, onClose } = current;
  current = null;
  el.remove();
  if (onClose) onClose();
}

// Se si cambia schermata (anche con il tasto indietro) il pannello si chiude.
window.addEventListener('hashchange', closeSheet);

// items: [{ label, run, danger }]
export function menuSheet(title, items) {
  const sheet = openSheet(`
    <h3 class="sheet-title">${esc(title)}</h3>
    <div class="sheet-menu">
      ${items.map((it, i) => `<button type="button" class="${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}
    </div>
    <button type="button" class="sheet-cancel" data-cancel>Annulla</button>`);
  sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const item = items[Number(b.dataset.i)];
    closeSheet();
    item.run();
  }));
}

// Restituisce una Promise<boolean>. lines: righe di testo (vengono escapate).
export function confirmSheet({ title, lines = [], confirmLabel = 'Conferma', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const sheet = openSheet(`
      <h3 class="sheet-title">${esc(title)}</h3>
      ${lines.map((l) => `<p class="sheet-text">${esc(l)}</p>`).join('')}
      <div class="row">
        <button type="button" data-cancel>Annulla</button>
        <button type="button" class="${danger ? 'danger-solid' : 'primary'}" data-ok>${esc(confirmLabel)}</button>
      </div>`, { onClose: () => resolve(result) });
    sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => { result = true; closeSheet(); });
  });
}

// fields: [{ name, label, type: 'text'|'select'|'checks', value, options: [{value,label,checked}], required }]
// Restituisce una Promise con { nome: valore } oppure null se annullato.
// Per 'checks' il valore e' un array di stringhe.
export function formSheet({ title, fields, submitLabel = 'Salva' }) {
  return new Promise((resolve) => {
    let result = null;
    const fieldHTML = fields.map((f) => {
      if (f.type === 'select') {
        return `<label class="field"><span>${esc(f.label)}</span><select name="${esc(f.name)}">
          ${f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></label>`;
      }
      if (f.type === 'checks') {
        return `<fieldset class="checks"><legend>${esc(f.label)}</legend>
          ${f.options.map((o) => `<label class="check"><input type="checkbox" name="${esc(f.name)}" value="${esc(o.value)}"${o.checked ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}
        </fieldset>`;
      }
      return `<label class="field"><span>${esc(f.label)}</span>
        <input type="text" name="${esc(f.name)}" value="${esc(f.value ?? '')}" autocomplete="off" autocapitalize="words" spellcheck="false"></label>`;
    }).join('');

    const sheet = openSheet(`
      <form novalidate>
        <h3 class="sheet-title">${esc(title)}</h3>
        ${fieldHTML}
        <div class="row">
          <button type="button" data-cancel>Annulla</button>
          <button type="submit" class="primary">${esc(submitLabel)}</button>
        </div>
      </form>`, { onClose: () => resolve(result) });

    const form = sheet.querySelector('form');
    sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        if (f.type === 'checks') {
          values[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value);
        } else {
          const input = form.elements[f.name];
          values[f.name] = f.type === 'select' ? input.value : input.value.trim();
          if (f.required && !values[f.name]) {
            input.classList.add('invalid');
            input.focus();
            return;
          }
        }
      }
      result = values;
      closeSheet();
    });
    const first = form.querySelector('input[type="text"]');
    if (first) setTimeout(() => { first.focus(); first.select(); }, 50);
  });
}

// Scelta tra voci (Passo 10, uso al tavolo). options: [{ value, label, sub, primary, danger }].
// Restituisce la value scelta oppure null se si annulla/chiude. Ogni bottone ha data-pick="<value>".
export function pickSheet({ title, options, cancelLabel = 'Annulla', hint = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const sheet = openSheet(`
      <h3 class="sheet-title">${esc(title)}</h3>
      ${hint ? `<p class="sheet-text meta">${esc(hint)}</p>` : ''}
      <div class="sheet-menu">
        ${options.map((o, i) => `<button type="button" class="pick${o.primary ? ' primary' : ''}${o.danger ? ' danger' : ''}" data-i="${i}" data-pick="${esc(o.value)}">
          <span class="pick-label">${esc(o.label)}</span>${o.sub ? `<small class="pick-sub">${esc(o.sub)}</small>` : ''}</button>`).join('')}
      </div>
      <button type="button" class="sheet-cancel" data-cancel>${esc(cancelLabel)}</button>`, { onClose: () => resolve(result) });
    sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
    sheet.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      result = options[Number(b.dataset.i)].value;
      closeSheet();
    }));
  });
}

// Tastierino numerico (danni). Restituisce un intero >= 0 o null se annullato.
export function keypadSheet({ title, sub = '', value = 0, max = 999, okLabel = 'OK' }) {
  return new Promise((resolve) => {
    let result = null;
    let cur = String(Math.max(0, Math.min(max, value)));
    const sheet = openSheet(`
      <h3 class="sheet-title">${esc(title)}</h3>
      ${sub ? `<p class="sheet-text meta">${esc(sub)}</p>` : ''}
      <div class="keypad-display" data-display>${esc(cur)}</div>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-key="${n}">${n}</button>`).join('')}
        <button type="button" data-key="clear">C</button>
        <button type="button" data-key="0">0</button>
        <button type="button" data-key="back">⌫</button>
      </div>
      <div class="row">
        <button type="button" data-cancel>Annulla</button>
        <button type="button" class="primary" data-ok>${esc(okLabel)}</button>
      </div>`, { onClose: () => resolve(result) });
    const disp = sheet.querySelector('[data-display]');
    const show = () => { disp.textContent = cur; };
    sheet.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.key;
      if (k === 'clear') cur = '0';
      else if (k === 'back') cur = cur.length > 1 ? cur.slice(0, -1) : '0';
      else { const next = cur === '0' ? k : cur + k; if (Number(next) <= max) cur = next; }
      show();
    }));
    sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
    sheet.querySelector('[data-ok]').addEventListener('click', () => { result = Number(cur); closeSheet(); });
  });
}

// Testo lungo copiabile (riepilogo). Il pulsante Copia usa la clipboard, altrimenti seleziona il testo.
export function textSheet({ title, text }) {
  const sheet = openSheet(`
    <h3 class="sheet-title">${esc(title)}</h3>
    <textarea class="copy-area" readonly rows="14" data-copy-area>${esc(text)}</textarea>
    <div class="row">
      <button type="button" data-cancel>Chiudi</button>
      <button type="button" class="primary" data-copy>Copia</button>
    </div>`);
  const area = sheet.querySelector('[data-copy-area]');
  sheet.querySelector('[data-cancel]').addEventListener('click', closeSheet);
  sheet.querySelector('[data-copy]').addEventListener('click', async (e) => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (err) { /* ripiego sotto */ }
    if (!ok) { area.focus(); area.select(); try { ok = document.execCommand('copy'); } catch (err) { ok = false; } }
    e.target.textContent = ok ? 'Copiato' : 'Seleziona e copia a mano';
  });
}
