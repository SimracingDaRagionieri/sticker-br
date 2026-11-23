// Sticker dal log (Passo 11): parte con database e disegno (la parte pura e' js/logsticker.js).
//
// I dati dello sticker vengono dal LOG: nomi copiati negli eventi e nella rosa (matchUnits). Le righe della Libreria
// (miniatura, arma, azione) servono solo per le immagini e solo se esistono ancora: un riferimento mancante o eliminato
// non e' un errore, si usa il solo nome. Gli sticker dal log non toccano mai recenti, preferiti, lastUsed e useCount.

import * as D from './db.js';
import * as LS from './logsticker.js';
import { renderSticker } from './render.js';
import { actionText, isPngAction } from './stickerinput.js';

// Stato della partita + voci da stickerare per i tipi scelti (tutti se `types` manca).
export async function loadMatch(matchId, types = LS.STICKER_TYPES) {
  await D.ready();
  const st = await D.getMatchState(matchId);
  if (!st.match) return null;
  const game = st.match.gameId != null ? await D.getGame(st.match.gameId) : null;
  return { match: st.match, game, units: st.units, events: st.events, rep: st.rep, items: LS.buildItems(st.match, st.units, st.events, st.rep, types) };
}

// Una voce del log per id evento (per l'Anteprima). null se la partita o l'evento non esistono (piu').
export async function getLogItem(matchId, eventId) {
  const m = await loadMatch(matchId, []);
  if (!m) return null;
  const index = m.events.findIndex((e) => e.id === eventId);
  if (index < 0) return null;
  const item = LS.itemFor(m.match, m.units, m.events, m.rep, index);
  if (!item) return null;
  return { ...m, item, src: await resolveSource(item) };
}

// Immagini e righe di Libreria (se esistono ancora) per una voce. Ritorna un oggetto nella forma di getStickerSource:
// { unit, weapon, action, unitImage, weaponImage, actionImage } con `action` = riga di Libreria o null.
//   attivazione: immagine dell'attaccante e dell'arma; azione: icona (o PNG) dell'azione; risultato: immagine del
//   BERSAGLIO e arma usata; punti: nessuna immagine.
export async function resolveSource(item) {
  const none = { unit: null, weapon: null, action: null, unitImage: null, weaponImage: null, actionImage: null };
  try {
    if (item.type === 'score') return none;
    const unitId = item.type === 'result' ? item.targetLibId : item.unitLibId;
    return await D.getStickerSource({
      unitId: item.type === 'action' ? null : unitId ?? null,
      weaponId: item.type === 'action' ? null : item.weaponLibId ?? null,
      actionId: item.type === 'action' ? item.actionLibId ?? null : null
    });
  } catch (err) {
    console.warn('Immagini dal log non lette', err);
    return none;
  }
}

// Azione PNG importata (esiste ancora in Libreria): lo sticker e' il file originale, senza template.
export const isPngItem = (item, src) => item.type === 'action' && isPngAction(src) && !!src.actionImage;

// Testo dell'azione: testo a schermo della riga di Libreria se c'e' ancora, altrimenti il nome copiato nel log.
export const itemActionText = (item, src) => (src && src.action && src.action.label && String(src.action.label).trim()) || item.actionName || actionText(src && src.action);

// Dati e config di disegno con gli interruttori nello stato predefinito del template (come l'Anteprima).
export function buildLogInput(item, src, tpl) {
  const cfg = structuredClone((tpl && tpl.config) || {});
  const icon = item.type === 'action' && src.action && !isPngAction(src) ? src.actionImage || null : null;
  const mainImage = item.type === 'action' ? icon : item.type === 'score' ? null : src.unitImage || null;
  const weaponImage = item.type === 'activation' || item.type === 'result' ? src.weaponImage || null : null;
  cfg.image = { ...(cfg.image || {}), show: !!(mainImage && cfg.image && cfg.image.show) };
  cfg.weaponImage = { ...(cfg.weaponImage || {}), show: !!(weaponImage && cfg.weaponImage && cfg.weaponImage.show) };
  const data = {
    unitName: item.unitName || '',
    weaponName: item.weaponName || '',
    actionName: item.type === 'action' ? itemActionText(item, src) : '',
    factionName: item.factionName || '',
    targetName: item.targetName || '',
    damageText: item.damageText || '',
    woundsLeftText: item.woundsLeftText || '',
    damageLeftText: item.damageLeftText || '',
    statusText: item.statusText || '',
    unitImage: mainImage,
    weaponImage,
    accentColor: item.type === 'action' && src.action ? src.action.accentColor || null : null
  };
  return { data, cfg };
}

export async function renderLogItem(item, src, tpl) {
  if (isPngItem(item, src)) return src.actionImage;
  if (!tpl) throw new Error('Nessun template disponibile');
  const { data, cfg } = buildLogInput(item, src, tpl);
  return renderSticker(data, cfg);
}

// Genera gli sticker dei tipi scelti, nell'ordine del log, e li mette in coda (chiave m<partita>-e<evento>: rigenerare
// sostituisce). onProgress(done, total); shouldStop() = true interrompe (quelli gia' in coda restano).
export async function generateForMatch(matchId, types, { onProgress, shouldStop } = {}) {
  const m = await loadMatch(matchId, types);
  if (!m) throw new Error('Partita non trovata');
  const tpls = {};
  for (const k of new Set(m.items.map((i) => i.templateKind))) tpls[k] = await D.getDefaultTemplate(k);
  const res = { total: m.items.length, done: 0, failed: 0, stopped: false };
  for (const item of m.items) {
    if (shouldStop && shouldStop()) { res.stopped = true; break; }
    try {
      const src = await resolveSource(item);
      const blob = await renderLogItem(item, src, tpls[item.templateKind]);
      await D.queueAdd({ key: `m${matchId}-e${item.id}`, name: LS.itemFilename(m.match, item), label: `${item.seq}. ${LS.itemLabel(item)}`, blob });
      res.done++;
    } catch (err) {
      console.error('Sticker non generato', item.seq, err);
      res.failed++;
    }
    if (onProgress) onProgress(res.done + res.failed, res.total);
  }
  return res;
}
