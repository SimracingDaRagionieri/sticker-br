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
