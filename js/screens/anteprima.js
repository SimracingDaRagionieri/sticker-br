// Anteprima sticker: #/anteprima?unit=&weapon=&action=&template=
// - unit (+ weapon facoltativa): sticker di attivazione, template di tipo "activation"
// - action: sticker di azione, template di tipo "action"
// - match=<partita>&ev=<evento> (Passo 11, "Crea sticker" dal log): sticker di una voce del log; i dati (nomi, danni,
//   ferite rimaste) vengono dal log, la Libreria serve solo per le immagini se le righe esistono ancora. Template di
//   tipo activation / action / result (i punti usano result). Niente stella, nessun recente: il log non entra in Crea.
// Il tasto indietro (Android o quello a schermo) torna alla schermata di provenienza.

import * as D from '../db.js';
import { renderSticker } from '../render.js';
import { saveBlob, shareBlobs, stickerFilename } from '../export.js';
import { getLogItem, renderLogItem, itemActionText } from '../logsource.js';
import { itemFilename, itemLabel, joinDamageLeft } from '../logsticker.js';
import { queueButtonHTML, bindQueueButton } from './coda.js';
import { toast, parseHash, canGoBack } from '../app.js';
import { esc } from '../ui.js';
import { actionText, isPngAction } from '../stickerinput.js';

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
  const matchId = intParam(q, 'match');
  const evId = intParam(q, 'ev');
  const fromLog = matchId != null && evId != null;
  const wantedTemplate = intParam(q, 'template');

  let actionId = null, unitId = null, weaponId = null, kind = 'activation';
  let src, unit, weapon, action, faction, game, fallback, logItem = null, logMatch = null;

  if (fromLog) {
    // Voce del log: nomi e testi dal log, immagini dalla Libreria solo se le righe esistono ancora.
    const L = await getLogItem(matchId, evId);
    if (!alive()) return;
    fallback = `#/log?m=${matchId}&v=cron`;
    if (!L) {
      message(el, 'Voce del log non trovata: la partita o la voce potrebbero essere state eliminate.', '#/log');
      return;
    }
    logItem = L.item;
    logMatch = L.match;
    kind = logItem.templateKind;
    const row = L.src.action; // riga di Libreria dell'azione, se esiste ancora
    src = {
      ...L.src,
      unit: logItem.unitName ? { id: null, name: logItem.unitName } : null,
      weapon: logItem.weaponName ? { id: null, name: logItem.weaponName } : null,
      action: logItem.type === 'action'
        ? (row && row.mode === 'png' ? row : { id: null, name: logItem.actionName, label: row ? row.label : null, accentColor: row ? row.accentColor : null, mode: 'generated' })
        : null,
      faction: logItem.factionName ? { name: logItem.factionName } : null,
      game: L.game
    };
    ({ unit, weapon, action, faction, game } = src);
  } else {
    actionId = intParam(q, 'action');
    unitId = actionId != null ? null : intParam(q, 'unit');
    weaponId = actionId != null ? null : intParam(q, 'weapon');
    kind = actionId != null ? 'action' : 'activation';

    if (actionId == null && unitId == null && weaponId == null) {
      message(el, 'Nessun elemento da mostrare. Scegli una miniatura, un\'arma o un\'azione dalla Libreria.', '#/libreria');
      return;
    }

    src = await D.getStickerSource({ unitId, weaponId, actionId });
    if (!alive()) return;
    ({ unit, weapon, action, faction, game } = src);
    const link = (...p) => '#/libreria' + p.map((x) => '/' + x).join('');
    fallback = unit && faction && game ? link('g' + game.id, 'f' + faction.id, 'u' + unit.id)
      : action && game ? link('g' + game.id) : '#/libreria';

    if ((unitId != null && !unit) || (weaponId != null && !weapon) || (actionId != null && !action)) {
      message(el, 'Elemento non trovato: potrebbe essere stato eliminato.', fallback);
      return;
    }
  }

  // Azione 'png': PNG importato, esce identico. Niente template, niente testo da modificare, niente ridisegno.
  const png = isPngAction(src);
  if (png && !src.actionImage) {
    message(el, 'Il PNG di questa azione non è stato trovato. Reimportalo dalla Libreria.', fallback);
    return;
  }
  const templates = png ? [] : await D.listTemplates(kind);
  if (!alive()) return;
  if (!png && !templates.length) {
    message(el, 'Nessun template disponibile per questo tipo di sticker.', fallback);
    return;
  }
  const byId = templates.find((t) => t.id === wantedTemplate);
  const tpl0 = png ? null : (byId || (await D.getDefaultTemplate(kind)) || templates[0]);
  if (!alive()) return;

  const L = (game && game.labels) || { unit: 'Unità', weapon: 'Arma' };
  const hasUnitImg = !!src.unitImage;
  const hasWeaponImg = !!src.weaponImage;
  const hasIcon = !!action && !png && !!src.actionImage;
  const isResult = kind === 'result';
  const isScore = fromLog && logItem.type === 'score';

  const st = {
    tpl: tpl0,
    showUnitImg: false,
    showWeaponImg: false,
    showIcon: false,
    unitText: unit ? unit.name : '',
    weaponText: weapon ? weapon.name : '',
    actionText: fromLog && logItem.type === 'action' ? itemActionText(logItem, src) : actionText(action),
    // Risultato (solo dal log): testi modificabili solo per questo sticker
    targetText: fromLog ? logItem.targetName || '' : '',
    damageText: fromLog ? logItem.damageText || '' : '',
    woundsLeftText: fromLog ? logItem.woundsLeftText || '' : '',
    statusText: fromLog ? logItem.statusText || '' : ''
  };
  // Gli interruttori partono da quanto prevede il template, solo se l'immagine esiste.
  const resetToggles = () => {
    if (png) return;
    const cfg = st.tpl.config || {};
    st.showUnitImg = hasUnitImg && !!(cfg.image && cfg.image.show);
    st.showWeaponImg = hasWeaponImg && !!(cfg.weaponImage && cfg.weaponImage.show);
  };
  // Azioni disegnate: l'icona parte da quanto prevede il template (come in Crea), solo se l'azione ne ha una.
  const resetIcon = () => { st.showIcon = hasIcon && !!(((st.tpl && st.tpl.config) || {}).image || {}).show; };
  resetToggles();
  resetIcon();

  const ctxLine = fromLog
    ? [logMatch.name || logMatch.gameName, `voce ${logItem.seq}`].filter(Boolean).join(' · ')
    : [game && game.name, faction && faction.name].filter(Boolean).join(' · ');

  el.innerHTML = `
    <div class="title-row">
      <div class="title-left">
        <button type="button" class="back" data-back aria-label="Indietro">‹</button>
        <h1>Anteprima sticker</h1>
      </div>
      <div class="title-actions">
        ${queueButtonHTML()}
        ${fromLog ? '' : '<button type="button" class="star-btn" data-fav aria-pressed="false" aria-label="Combinazione preferita">☆</button>'}
      </div>
    </div>
    ${ctxLine ? `<p class="meta pv-ctx">${esc(ctxLine)}</p>` : ''}
    <div class="preview checker-bg" id="pv">
      <img id="pv-img" alt="Anteprima dello sticker" hidden>
      <span class="pv-wait" id="pv-wait">Disegno lo sticker…</span>
    </div>
    ${png ? '<p class="meta">PNG importato: lo sticker è il file originale, senza modifiche né ricompressione.</p>' : `<h2>Template</h2>
    <div class="chips" role="group" aria-label="Template">
      ${templates.map((t) => `<button type="button" class="chip" data-tpl="${t.id}" aria-pressed="${t.id === st.tpl.id}">${esc(t.name)}</button>`).join('')}
    </div>`}
    ${kind === 'action' && hasIcon ? `<div class="toggles"><label class="check"><input type="checkbox" data-toggle="icon"><span>Icona azione</span></label></div>` : ''}
    ${kind === 'activation' || (isResult && !isScore) ? `
      <div class="toggles">
        ${unit || isResult ? `<label class="check"><input type="checkbox" data-toggle="unit"${hasUnitImg ? '' : ' disabled'}><span>Immagine ${isResult ? 'bersaglio' : esc(L.unit.toLowerCase())}${hasUnitImg ? '' : ' (non importata)'}</span></label>` : ''}
        ${weapon ? `<label class="check"><input type="checkbox" data-toggle="weapon"${hasWeaponImg ? '' : ' disabled'}><span>Immagine ${esc(L.weapon.toLowerCase())}${hasWeaponImg ? '' : ' (non importata)'}</span></label>` : ''}
      </div>` : ''}
    ${png ? '' : `<h2>Testo <span class="meta">(solo per questo sticker)</span></h2>`}
    ${png ? '' : kind === 'action'
      ? `<label class="field"><span>Azione</span><input type="text" data-text="action" value="${esc(st.actionText)}" autocomplete="off" spellcheck="false"></label>`
      : isResult
      ? `<label class="field"><span>${isScore ? 'Lato e motivo' : 'Bersaglio'}</span><input type="text" data-text="target" value="${esc(st.targetText)}" autocomplete="off" spellcheck="false"></label>
         <label class="field"><span>${isScore ? 'Punti' : 'Danni'}</span><input type="text" data-text="damage" value="${esc(st.damageText)}" autocomplete="off" spellcheck="false"></label>
         ${isScore ? '' : `<label class="field"><span>Ferite rimaste</span><input type="text" data-text="woundsLeft" value="${esc(st.woundsLeftText)}" autocomplete="off" spellcheck="false"></label>
         <label class="field"><span>Stato</span><input type="text" data-text="status" value="${esc(st.statusText)}" autocomplete="off" spellcheck="false"></label>
         ${unit ? `<label class="field"><span>Attaccante</span><input type="text" data-text="unit" value="${esc(st.unitText)}" autocomplete="off" spellcheck="false"></label>` : ''}
         ${weapon ? `<label class="field"><span>${esc(L.weapon)}</span><input type="text" data-text="weapon" value="${esc(st.weaponText)}" autocomplete="off" spellcheck="false"></label>` : ''}`}`
      : `${unit ? `<label class="field"><span>${esc(L.unit)}</span><input type="text" data-text="unit" value="${esc(st.unitText)}" autocomplete="off" spellcheck="false"></label>` : ''}
         ${weapon ? `<label class="field"><span>${esc(L.weapon)}</span><input type="text" data-text="weapon" value="${esc(st.weaponText)}" autocomplete="off" spellcheck="false"></label>` : ''}`}
    <div class="row">
      <button type="button" class="primary" data-save>Salva</button>
      <button type="button" data-share>Condividi</button>
    </div>
    <div class="row"><button type="button" data-queue>Aggiungi alla coda</button></div>
    <p class="meta">Salva mette il PNG in Download, da dove InShot lo trova nella galleria. Condividi serve per Google Foto, File o Drive (non WhatsApp o Telegram: perdono la trasparenza).</p>`;

  const $ = (sel) => el.querySelector(sel);
  const img = $('#pv-img');
  const wait = $('#pv-wait');
  const syncToggles = () => {
    const u = $('[data-toggle="unit"]'), w = $('[data-toggle="weapon"]'), ic = $('[data-toggle="icon"]');
    if (u) u.checked = st.showUnitImg;
    if (w) w.checked = st.showWeaponImg;
    if (ic) ic.checked = st.showIcon;
  };
  syncToggles();

  // --- disegno ---
  let gen = 0;
  let pending = null;
  let timer = 0;
  let dirty = false; // c'e' un testo modificato non ancora disegnato

  const buildInput = () => {
    const cfg = structuredClone(st.tpl.config || {});
    cfg.image = { ...(cfg.image || {}), show: action ? st.showIcon : st.showUnitImg };
    cfg.weaponImage = { ...(cfg.weaponImage || {}), show: st.showWeaponImg };
    const data = {
      unitName: st.unitText, weaponName: st.weaponText, actionName: st.actionText,
      factionName: faction ? faction.name : '',
      unitImage: action ? src.actionImage : src.unitImage, weaponImage: src.weaponImage,
      accentColor: action ? action.accentColor : null
    };
    if (isResult) {
      data.targetName = st.targetText;
      data.damageText = st.damageText;
      data.woundsLeftText = st.woundsLeftText;
      data.damageLeftText = joinDamageLeft(st.damageText, st.woundsLeftText);
      data.statusText = st.statusText;
    }
    return { data, cfg };
  };

  function draw() {
    clearTimeout(timer);
    dirty = false;
    const mine = ++gen;
    // Azione 'png': il Blob originale, mai ridisegnato.
    const p = png ? Promise.resolve(src.actionImage) : (() => { const { data, cfg } = buildInput(); return renderSticker(data, cfg); })();
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

  // --- stella: combinazione preferita (miniatura + arma + template, oppure azione + template) ---
  const favBtn = $('[data-fav]'); // assente per gli sticker dal log (nessun preferito)
  const comboParts = () => ({
    unitId: unit ? unit.id : null, weaponId: weapon ? weapon.id : null,
    actionId: action ? action.id : null, templateId: png ? null : st.tpl.id
  });
  const paintFav = (on) => {
    if (!favBtn) return;
    favBtn.setAttribute('aria-pressed', String(on));
    favBtn.textContent = on ? '★' : '☆';
  };
  const syncFav = () => (!favBtn ? Promise.resolve() : D.isFavCombo(comboParts())).then((on) => { if (alive()) paintFav(on); }).catch(() => {});
  syncFav();
  if (favBtn) favBtn.addEventListener('click', async () => {
    try {
      const on = await D.toggleFavCombo(comboParts());
      paintFav(on);
      toast(on ? 'Aggiunto ai preferiti' : 'Tolto dai preferiti');
    } catch (err) {
      console.error(err);
      toast('Errore: ' + err.message);
    }
  });

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
    resetIcon();
    syncToggles();
    syncFav();
    el.querySelectorAll('[data-tpl]').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.tpl) === t.id)));
    // Tengo l'indirizzo aggiornato senza aggiungere voci alla cronologia: "indietro" torna comunque alla provenienza.
    const params = parseHash().query;
    params.set('template', String(t.id));
    history.replaceState(history.state, '', '#/anteprima?' + params.toString());
    draw();
  }));

  const u = $('[data-toggle="unit"]'), w = $('[data-toggle="weapon"]'), ic = $('[data-toggle="icon"]');
  if (u) u.addEventListener('change', () => { st.showUnitImg = u.checked; draw(); });
  if (w) w.addEventListener('change', () => { st.showWeaponImg = w.checked; draw(); });
  if (ic) ic.addEventListener('change', () => { st.showIcon = ic.checked; draw(); });

  el.querySelectorAll('[data-text]').forEach((inp) => inp.addEventListener('input', () => {
    st[inp.dataset.text + 'Text'] = inp.value;
    drawSoon();
  }));

  let busy = false;
  const fileName = () => (fromLog
    ? itemFilename(logMatch, logItem)
    : stickerFilename(kind === 'action' ? [st.actionText] : [st.unitText, st.weaponText]));
  // Blob da esportare: se c'e' una modifica in attesa di disegno, la rifaccio ora (esporto sempre cio' che si vede).
  async function currentBlob() {
    clearTimeout(timer);
    return dirty ? draw() : (pending || draw());
  }
  async function output(share) {
    if (busy) return;
    busy = true;
    try {
      const blob = await currentBlob();
      const name = fileName();
      let used = true;
      if (share) {
        const r = await shareBlobs([blob], [name]);
        if (r === 'cancelled') used = false;
        else if (r === 'saved') toast('Condivisione non disponibile: salvato in Download');
      } else {
        saveBlob(blob, name);
        toast('Salvato in Download');
      }
      // Gli sticker dal log non entrano nei recenti: il log non e' la Libreria.
      if (used && !fromLog) {
        await D.recordUse({
          unitId: unit ? unit.id : null, weaponId: weapon ? weapon.id : null,
          actionId: action ? action.id : null, templateId: png ? null : st.tpl.id
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

  // Aggiungi alla coda: il PNG gia' disegnato (compresi i testi modificati qui) va nella tabella queue.
  $('[data-queue]').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      const blob = await currentBlob();
      const name = fileName();
      await D.queueAdd({
        key: fromLog ? `m${matchId}-e${evId}` : undefined,
        name,
        label: fromLog ? `${logItem.seq}. ${itemLabel(logItem)}` : (kind === 'action' ? st.actionText : [st.unitText, st.weaponText].filter(Boolean).join(' · ')),
        blob
      });
      toast(`Aggiunto alla coda (${await D.queueCount()})`);
    } catch (err) {
      console.error(err);
      toast('Errore: ' + err.message);
    } finally {
      setTimeout(() => { busy = false; }, 600);
    }
  });

  bindQueueButton(el);
  draw();
}
