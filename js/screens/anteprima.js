// Anteprima sticker: #/anteprima?unit=&weapon=&action=&template=
// - unit (+ weapon facoltativa): sticker di attivazione, template di tipo "activation"
// - action: sticker di azione, template di tipo "action"
// Il tasto indietro (Android o quello a schermo) torna alla schermata di provenienza.

import * as D from '../db.js';
import { renderSticker } from '../render.js';
import { saveBlob, shareBlobs, stickerFilename } from '../export.js';
import { toast, parseHash, canGoBack } from '../app.js';
import { esc } from '../ui.js';

let token = 0;

const intParam = (q, name) => {
  const v = q.get(name);
  return v !== null && /^\d+$/.test(v) ? Number(v) : null;
};

function message(el, text, backHash) {
  el.innerHTML = `
    <div class="title-row"><h1>Anteprima sticker</h1></div>
    <p class="empty">${esc(text)}</p>
    <div class="row"><a class="btn btn-link" href="${backHash}">Indietro</a></div>`;
}

export async function render(el) {
  const my = ++token;
  const alive = () => my === token && el.isConnected;

  try {
    await D.ready();
  } catch (err) {
    console.error(err);
    message(el, 'Impossibile aprire il database.', '#/crea');
    return;
  }

  const q = parseHash().query;
  const actionId = intParam(q, 'action');
  const unitId = actionId != null ? null : intParam(q, 'unit');
  const weaponId = actionId != null ? null : intParam(q, 'weapon');
  const wantedTemplate = intParam(q, 'template');
  const kind = actionId != null ? 'action' : 'activation';

  if (actionId == null && unitId == null && weaponId == null) {
    message(el, 'Nessun elemento da mostrare. Scegli una miniatura, un\'arma o un\'azione dalla Libreria.', '#/libreria');
    return;
  }

  const src = await D.getStickerSource({ unitId, weaponId, actionId });
  if (!alive()) return;
  const { unit, weapon, action, faction, game } = src;
  const link = (...p) => '#/libreria' + p.map((x) => '/' + x).join('');
  const fallback = unit && faction && game ? link('g' + game.id, 'f' + faction.id, 'u' + unit.id)
    : action && game ? link('g' + game.id) : '#/libreria';

  if ((unitId != null && !unit) || (weaponId != null && !weapon) || (actionId != null && !action)) {
    message(el, 'Elemento non trovato: potrebbe essere stato eliminato.', fallback);
    return;
  }

  const templates = await D.listTemplates(kind);
  if (!alive()) return;
  if (!templates.length) {
    message(el, 'Nessun template disponibile per questo tipo di sticker.', fallback);
    return;
  }
  const byId = templates.find((t) => t.id === wantedTemplate);
  const tpl0 = byId || (await D.getDefaultTemplate(kind)) || templates[0];
  if (!alive()) return;

  const L = (game && game.labels) || { unit: 'Unità', weapon: 'Arma' };
  const hasUnitImg = !!src.unitImage;
  const hasWeaponImg = !!src.weaponImage;

  const st = {
    tpl: tpl0,
    showUnitImg: false,
    showWeaponImg: false,
    unitText: unit ? unit.name : '',
    weaponText: weapon ? weapon.name : '',
    actionText: action ? action.name : ''
  };
  // Gli interruttori partono da quanto prevede il template, solo se l'immagine esiste.
  const resetToggles = () => {
    const cfg = st.tpl.config || {};
    st.showUnitImg = hasUnitImg && !!(cfg.image && cfg.image.show);
    st.showWeaponImg = hasWeaponImg && !!(cfg.weaponImage && cfg.weaponImage.show);
  };
  resetToggles();

  const ctxLine = [game && game.name, faction && faction.name].filter(Boolean).join(' · ');

  el.innerHTML = `
    <div class="title-row">
      <div class="title-left">
        <button type="button" class="back" data-back aria-label="Indietro">‹</button>
        <h1>Anteprima sticker</h1>
      </div>
    </div>
    ${ctxLine ? `<p class="meta pv-ctx">${esc(ctxLine)}</p>` : ''}
    <div class="preview checker-bg" id="pv">
      <img id="pv-img" alt="Anteprima dello sticker" hidden>
      <span class="pv-wait" id="pv-wait">Disegno lo sticker…</span>
    </div>
    <h2>Template</h2>
    <div class="chips" role="group" aria-label="Template">
      ${templates.map((t) => `<button type="button" class="chip" data-tpl="${t.id}" aria-pressed="${t.id === st.tpl.id}">${esc(t.name)}</button>`).join('')}
    </div>
    ${kind === 'activation' ? `
      <div class="toggles">
        ${unit ? `<label class="check"><input type="checkbox" data-toggle="unit"${hasUnitImg ? '' : ' disabled'}><span>Immagine ${esc(L.unit.toLowerCase())}${hasUnitImg ? '' : ' (non importata)'}</span></label>` : ''}
        ${weapon ? `<label class="check"><input type="checkbox" data-toggle="weapon"${hasWeaponImg ? '' : ' disabled'}><span>Immagine ${esc(L.weapon.toLowerCase())}${hasWeaponImg ? '' : ' (non importata)'}</span></label>` : ''}
      </div>` : ''}
    <h2>Testo <span class="meta">(solo per questo sticker)</span></h2>
    ${kind === 'action'
      ? `<label class="field"><span>Azione</span><input type="text" data-text="action" value="${esc(st.actionText)}" autocomplete="off" spellcheck="false"></label>`
      : `${unit ? `<label class="field"><span>${esc(L.unit)}</span><input type="text" data-text="unit" value="${esc(st.unitText)}" autocomplete="off" spellcheck="false"></label>` : ''}
         ${weapon ? `<label class="field"><span>${esc(L.weapon)}</span><input type="text" data-text="weapon" value="${esc(st.weaponText)}" autocomplete="off" spellcheck="false"></label>` : ''}`}
    <div class="row">
      <button type="button" class="primary" data-save>Salva</button>
      <button type="button" data-share>Condividi</button>
    </div>
    <p class="meta">Salva mette il PNG in Download, da dove InShot lo trova nella galleria. Condividi serve per Google Foto, File o Drive (non WhatsApp o Telegram: perdono la trasparenza).</p>`;

  const $ = (sel) => el.querySelector(sel);
  const img = $('#pv-img');
  const wait = $('#pv-wait');
  const syncToggles = () => {
    const u = $('[data-toggle="unit"]'), w = $('[data-toggle="weapon"]');
    if (u) u.checked = st.showUnitImg;
    if (w) w.checked = st.showWeaponImg;
  };
  syncToggles();

  // --- disegno ---
  let gen = 0;
  let pending = null;
  let timer = 0;
  let dirty = false; // c'e' un testo modificato non ancora disegnato

  const buildInput = () => {
    const cfg = structuredClone(st.tpl.config || {});
    cfg.image = { ...(cfg.image || {}), show: st.showUnitImg };
    cfg.weaponImage = { ...(cfg.weaponImage || {}), show: st.showWeaponImg };
    const data = {
      unitName: st.unitText, weaponName: st.weaponText, actionName: st.actionText,
      factionName: faction ? faction.name : '',
      unitImage: src.unitImage, weaponImage: src.weaponImage,
      accentColor: action ? action.accentColor : null
    };
    return { data, cfg };
  };

  function draw() {
    clearTimeout(timer);
    dirty = false;
    const mine = ++gen;
    const { data, cfg } = buildInput();
    const p = renderSticker(data, cfg);
    pending = p;
    p.then((blob) => {
      if (!alive() || mine !== gen) return;
      const url = URL.createObjectURL(blob);
      const done = () => URL.revokeObjectURL(url);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      img.src = url;
      img.hidden = false;
      wait.hidden = true;
    }).catch((err) => {
      console.error(err);
      if (!alive() || mine !== gen) return;
      wait.hidden = false;
      wait.textContent = 'Non riesco a disegnare lo sticker.';
      toast('Errore: ' + err.message);
    });
    return p;
  }
  const drawSoon = () => { dirty = true; clearTimeout(timer); timer = setTimeout(draw, 150); };

  // --- interazioni ---
  $('[data-back]').addEventListener('click', () => {
    if (canGoBack()) history.back();
    else location.replace(fallback);
  });

  el.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    const t = templates.find((x) => x.id === Number(b.dataset.tpl));
    if (!t || t.id === st.tpl.id) return;
    st.tpl = t;
    resetToggles();
    syncToggles();
    el.querySelectorAll('[data-tpl]').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.tpl) === t.id)));
    // Tengo l'indirizzo aggiornato senza aggiungere voci alla cronologia: "indietro" torna comunque alla provenienza.
    const params = parseHash().query;
    params.set('template', String(t.id));
    history.replaceState(history.state, '', '#/anteprima?' + params.toString());
    draw();
  }));

  const u = $('[data-toggle="unit"]'), w = $('[data-toggle="weapon"]');
  if (u) u.addEventListener('change', () => { st.showUnitImg = u.checked; draw(); });
  if (w) w.addEventListener('change', () => { st.showWeaponImg = w.checked; draw(); });

  el.querySelectorAll('[data-text]').forEach((inp) => inp.addEventListener('input', () => {
    st[inp.dataset.text + 'Text'] = inp.value;
    drawSoon();
  }));

  let busy = false;
  async function output(share) {
    if (busy) return;
    busy = true;
    try {
      clearTimeout(timer);
      // Se c'e' una modifica in attesa di disegno, la rifaccio ora: esporto sempre cio' che si vede.
      const blob = await (dirty ? draw() : (pending || draw()));
      const name = stickerFilename(kind === 'action' ? [st.actionText] : [st.unitText, st.weaponText]);
      let used = true;
      if (share) {
        const r = await shareBlobs([blob], [name]);
        if (r === 'cancelled') used = false;
        else if (r === 'saved') toast('Condivisione non disponibile: salvato in Download');
      } else {
        saveBlob(blob, name);
        toast('Salvato in Download');
      }
      if (used) {
        await D.recordUse({
          unitId: unit ? unit.id : null, weaponId: weapon ? weapon.id : null,
          actionId: action ? action.id : null, templateId: st.tpl.id
        });
      }
    } catch (err) {
      console.error(err);
      toast('Errore: ' + err.message);
    } finally {
      setTimeout(() => { busy = false; }, 600);
    }
  }
  $('[data-save]').addEventListener('click', () => output(false));
  $('[data-share]').addEventListener('click', () => output(true));

  draw();
}
