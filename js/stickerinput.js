// Dati e configurazione di disegno di uno sticker con gli interruttori nello stato predefinito del template
// (come li propone l'Anteprima): le immagini compaiono solo se il template le prevede E l'immagine esiste.
// Usato da Crea per le miniature dei recenti e per il salvataggio con tocco lungo, cosi' il file salvato
// e' identico a quello che l'Anteprima produrrebbe senza modifiche.
//
// Azioni (Passo 8): mode 'png' = PNG importato, lo sticker e' il file originale (nessun disegno, nessun template);
// mode 'generated' = disegnata col template di tipo action; l'eventuale icona (src.actionImage) usa lo slot `image`
// del template. Il template decide il valore di partenza (`image.show`): l'icona compare se il template la prevede E
// l'azione ha un'icona; l'interruttore "Icona azione" in Anteprima la spegne o la riaccende sul singolo sticker.

import { renderSticker } from './render.js';

// Testo scritto sullo sticker di un'azione: testo a schermo facoltativo, altrimenti il nome.
export const actionText = (a) => (a ? ((a.label && String(a.label).trim()) || a.name || '') : '');

// Azione importata come PNG?
export const isPngAction = (src) => !!(src && src.action && src.action.mode === 'png');

// src = risultato di db.getStickerSource(); tpl = riga della tabella templates.
export function buildStickerInput(src, tpl) {
  const cfg = structuredClone((tpl && tpl.config) || {});
  const icon = src.action && !isPngAction(src) ? src.actionImage || null : null;
  cfg.image = { ...(cfg.image || {}), show: !!((src.action ? icon : src.unitImage) && cfg.image && cfg.image.show) };
  cfg.weaponImage = { ...(cfg.weaponImage || {}), show: !!(src.weaponImage && cfg.weaponImage && cfg.weaponImage.show) };
  const data = {
    unitName: src.unit ? src.unit.name : '',
    weaponName: src.weapon ? src.weapon.name : '',
    actionName: actionText(src.action),
    factionName: src.faction ? src.faction.name : '',
    unitImage: src.action ? icon : src.unitImage || null,
    weaponImage: src.weaponImage || null,
    accentColor: src.action ? src.action.accentColor || null : null
  };
  return { data, cfg };
}

// Blob dello sticker con le impostazioni predefinite: il PNG originale (identico) per le azioni 'png', altrimenti il disegno.
export async function renderStickerFor(src, tpl) {
  if (isPngAction(src)) {
    if (!src.actionImage) throw new Error('PNG dell\'azione non trovato');
    return src.actionImage;
  }
  if (!tpl) throw new Error('Nessun template disponibile');
  const { data, cfg } = buildStickerInput(src, tpl);
  return renderSticker(data, cfg);
}

// Parti del nome file: azione, oppure miniatura + arma.
export function stickerNameParts(src) {
  return src.action ? [actionText(src.action)] : [src.unit ? src.unit.name : '', src.weapon ? src.weapon.name : ''];
}
