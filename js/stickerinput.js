// Dati e configurazione di disegno di uno sticker con gli interruttori nello stato predefinito del template
// (come li propone l'Anteprima): le immagini compaiono solo se il template le prevede E l'immagine esiste.
// Usato da Crea per le miniature dei recenti e per il salvataggio con tocco lungo, cosi' il file salvato
// e' identico a quello che l'Anteprima produrrebbe senza modifiche.

// src = risultato di db.getStickerSource(); tpl = riga della tabella templates.
export function buildStickerInput(src, tpl) {
  const cfg = structuredClone((tpl && tpl.config) || {});
  cfg.image = { ...(cfg.image || {}), show: !!(src.unitImage && cfg.image && cfg.image.show) };
  cfg.weaponImage = { ...(cfg.weaponImage || {}), show: !!(src.weaponImage && cfg.weaponImage && cfg.weaponImage.show) };
  const data = {
    unitName: src.unit ? src.unit.name : '',
    weaponName: src.weapon ? src.weapon.name : '',
    actionName: src.action ? src.action.name : '',
    factionName: src.faction ? src.faction.name : '',
    unitImage: src.unitImage || null,
    weaponImage: src.weaponImage || null,
    accentColor: src.action ? src.action.accentColor || null : null
  };
  return { data, cfg };
}

// Parti del nome file: azione, oppure miniatura + arma.
export function stickerNameParts(src) {
  return src.action ? [src.action.name] : [src.unit ? src.unit.name : '', src.weapon ? src.weapon.name : ''];
}
