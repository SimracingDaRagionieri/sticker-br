# Sticker Battle Report – progetto PWA

Specifica e piano di sviluppo (documento del 22/11/2026). I prompt dei singoli passi fanno riferimento alle sezioni 2–4.

## Stato di avanzamento (aggiornato al 23/11/2026)

- Passi 1, 2, 3 e 4 completati. CACHE_VERSION 'v6'.
- Passo 3 realizzato in forma semplificata: il ritaglio avviene direttamente sull'immagine di miniatura/arma (js/crop.js), senza tabella `cards` né schermata `#/ritaglio`. Da riprendere prima del Passo 8 (backup con "Includi carte originali").
- Anticipo parziale del Passo 6: in Libreria, dentro ogni gioco, sezione Azioni con aggiungi, rinomina, preferito, elimina e `accentColor` facoltativo (righe `actions` = `{ gameId, name, accentColor, fav, lastUsed }`).
- Passo 4: js/render.js (`renderSticker(data, config)`, `normalizeConfig`), font in /fonts (woff2 Latin/Latin-ext, licenze OFL-*.txt), template predefiniti "Attivazione", "Solo testo" (activation) e "Azione" (action) creati una volta sola (`settings.seededTemplates`, `settings.defaultTemplates` = {activation: id, action: id}), schermata `js/screens/anteprima.js`.
- Router: `parseHash()` e `canGoBack()` esportati da app.js; `#/anteprima?unit=&weapon=&action=&template=` non ha voce nella barra (resta attiva quella di provenienza). Il cambio template usa `history.replaceState`, quindi "indietro" torna alla provenienza.
- db.js: nuovi `listTemplates(kind)`, `getTemplate`, `getDefaultTemplate(kind)`, `getStickerSource({unitId,weaponId,actionId})` (righe + Blob immagini), `recordUse({unitId,weaponId,actionId,templateId})` (lastUsed, useCount, `recents` con chiave tipo `u12-w40-t1`, max 30). export.js: `stickerFilename(parti)`.
- Convenzioni del motore: `padding` = margine trasparente mantenuto dopo il taglio; con targa lo sticker è largo esattamente `width` (1080), senza targa ("Solo testo") è tagliato sul testo e quindi più stretto; `plate.padding` (predefinito 28) = spazio targa-contenuto; `lines[].weight` facoltativo; `stroke.width` = spessore visibile del contorno; se il template non ha `plate.border` e i dati hanno `accentColor`, questo diventa il bordo della targa.
- Dopo la prova sul telefono: "Attivazione" senza targa (sfondo trasparente) e con `weaponImage.show: true, replaceText: true` (il profilo arma importato dalla carta prende il posto del nome arma scritto; se l'arma non ha immagine resta il testo). I template predefiniti vengono riscritti una volta sola (`settings.templatesRev` = 2).
- Provvisorio in Libreria: tocco su un'arma nella scheda miniatura e pulsante "Sticker solo <miniatura>" aprono l'Anteprima; menu ⋮ di un'azione: "Anteprima sticker".
- Attenzione per il Passo 5: eliminando giochi/miniature/armi/azioni le righe `recents` non vengono ripulite; ignorare i recenti con riferimenti mancanti.
- Prossimo: Passo 5 (schermata Crea). Restano da fare del Passo 6: campi `label`, `mode`, `imageId`, `templateId`, "Importa PNG", "Valida per tutti i giochi", azioni predefinite di Kill Team.
- Attenzione: IndexedDB non indicizza `null`; le azioni con `gameId: null` non compaiono in `listActions(gameId)`. Gestire l'unione con le azioni globali oppure usare `db.version(2)`.

## Sintesi e decisioni

PWA statica in JavaScript senza build, dati in IndexedDB, sticker disegnati su canvas ed esportati come PNG nella cartella Download, che Android mostra nel selettore foto di InShot. Il punto critico è il passaggio PNG → sticker InShot: si verifica al passo 1, prima di costruire il resto.

Scelte di default, modificabili:

- Hosting gratuito su GitHub Pages (serve HTTPS per installare la PWA); dopo la prima apertura funziona offline.
- Sticker larghi 1080 px, margini trasparenti tagliati in automatico.
- Armi legate alla fazione e condivise tra più miniature (es. una bolt gun), così si ritagliano una volta sola.
- Niente correzione prospettica: meglio screenshot o foto dritte; c'è la rotazione fine.
- Ripristino backup in modalità "sostituisci tutto"; l'unione di due database è rimandata.

## 1. Architettura e tecnologie

HTML, CSS e JavaScript a moduli, senza framework né build. Tutte le librerie stanno in locale in /vendor, niente CDN, così l'app funziona offline.

| Parte | Scelta | Motivo |
|---|---|---|
| Interfaccia | HTML + CSS + JS (moduli ES), router a hash (#/crea, #/libreria/…) | semplice, il tasto indietro di Android funziona |
| Hosting | GitHub Pages | gratis, HTTPS obbligatorio per installare |
| Offline | service worker cache-first con CACHE_VERSION | aggiornamenti controllati con avviso "Aggiorna" |
| Database | IndexedDB tramite Dexie.js 4 | indici e query semplici, immagini salvate come Blob |
| Ritaglio | Cropper.js 1.6 | trascinamento e zoom a due dita già pronti |
| Sticker | Canvas 2D → toBlob('image/png') | PNG con canale alfa a pixel reali |
| Font | FontFace API: 3 font OFL inclusi + font importati dall'utente | stile personalizzabile anche offline |
| Backup | JSZip 3: data.json + cartelle di immagini | un solo file, si apre anche su PC |
| Ricerca | indice in memoria dei nomi normalizzati | istantanea con migliaia di voci |

Struttura dei file prevista:

```
index.html  manifest.webmanifest  sw.js  README.md
css/app.css
js/app.js (router, navigazione)  js/db.js  js/render.js  js/export.js  js/backup.js  js/search.js
js/screens/crea.js  libreria.js  ritaglio.js  anteprima.js  template.js  altro.js
vendor/dexie.min.js  cropper.min.js  cropper.min.css  jszip.min.js
fonts/BebasNeue.woff2  Oswald.woff2  RobotoCondensed.woff2
icons/icon-192.png  icon-512.png
```

Navigazione in basso a 4 voci: Crea (home), Libreria, Template, Altro (backup, impostazioni, coda).

## 2. Struttura dati

Gerarchia fissa a 4 livelli (Gioco → Fazione → Miniatura → Arma); ogni gioco ha le proprie etichette dei livelli, così un nuovo gioco si aggiunge senza toccare il codice. I booleani sono 0/1 perché IndexedDB non indicizza true/false.

Schema Dexie (versione 1):

```js
db.version(1).stores({
  games:     '++id, name',
  factions:  '++id, gameId, name',
  units:     '++id, factionId, gameId, name, fav, lastUsed',
  weapons:   '++id, factionId, *unitIds, name, fav, lastUsed',
  actions:   '++id, gameId, name, fav, lastUsed',
  images:    '++id, kind, cardId',
  cards:     '++id, factionId, createdAt',
  templates: '++id, kind',
  fonts:     '++id, family',
  recents:   '++id, &key, usedAt',
  settings:  'key'
});
```

| Tabella | Campi principali |
|---|---|
| games | name, labels {faction, unit, weapon} (es. Squadra/Operativo/Arma), order |
| factions | gameId, name, order, accentColor (facoltativo) |
| units | factionId, gameId, name, imageId o null, fav, lastUsed, useCount |
| weapons | factionId, unitIds[] (miniature che la usano), name, kind ranged/melee/other, imageId o null, fav, lastUsed |
| actions | gameId o null (= tutti i giochi), name, label (testo a schermo), mode png/generated, imageId, templateId, fav, lastUsed (+ accentColor) |
| images | blob PNG, w, h, kind unit/weapon/action, cardId, crop {x, y, width, height, rotate} |
| cards | factionId, blob JPEG max 2400 px, w, h, createdAt |
| templates | name, kind activation/action, config (sotto) |
| fonts | family, blob, format |
| recents | key (es. "u12-w40-t1"), unitId, weaponId, actionId, templateId, usedAt; massimo 30 |
| settings | chiave/valore: schemaVersion, lastGameId, exportWidth, defaultTemplates, favCombos, lastBackupAt, seeded, dirHandle |

Esempio di config di un template:

```json
{
  "width": 1080, "padding": 24, "trim": true,
  "plate": { "show": true, "color": "#111111", "opacity": 0.85, "radius": 16,
             "border": { "width": 4, "color": "#E8B04A" } },
  "image": { "show": true, "side": "left", "height": 220, "radius": 12,
             "border": { "width": 3, "color": "#FFFFFF" } },
  "weaponImage": { "show": false, "position": "below", "maxHeight": 200 },
  "lines": [
    { "source": "unit", "font": "Bebas Neue", "size": 96, "minSize": 56,
      "color": "#FFFFFF", "stroke": { "width": 6, "color": "#000000" },
      "shadow": true, "upper": true, "align": "left" },
    { "source": "weapon", "font": "Oswald", "size": 60, "minSize": 36,
      "color": "#E8B04A", "stroke": { "width": 4, "color": "#000000" },
      "shadow": false, "upper": false, "align": "left" }
  ]
}
```

Valori di "source": unit, weapon, action, faction, text (testo fisso). Backup: ZIP con data.json (tutte le tabelle, i Blob sostituiti da percorsi images/ID.png, cards/ID.jpg, fonts/ID.ext) e i file corrispondenti.

## 3. Schermate e flusso d'uso

Uno sticker già usato si salva con 1 tocco lungo; uno nuovo con ricerca + 3 tocchi.

### Crea (home)

1. In alto: campo di ricerca e chip del gioco attivo (ricorda l'ultimo, oppure "Tutti").
2. Mentre scrive compaiono risultati raggruppati: Miniature, Armi ("Bolt rifle · Intercessor Warrior"), Azioni. "int ser" trova "Intercessor Sergeant".
3. Sotto la ricerca, quattro schede: Recenti (miniature degli ultimi sticker), Preferiti, Azioni (griglia), Sfoglia (fazioni → griglia miniature con foto).
4. Tocco su una miniatura → pannello dal basso con le sue armi (foto + nome) e "Solo miniatura" → tocco sull'arma apre l'Anteprima.
5. Tocco su un recente → Anteprima; tocco lungo → salvataggio diretto con toast "Salvato".

### Anteprima

- Sticker su sfondo a scacchi, scelta del template a chip, interruttori "Immagine miniatura" e "Immagine arma", testo modificabile solo per questo sticker.
- Pulsanti grandi Salva e Condividi, stella per i preferiti, "Aggiungi alla coda" per prepararne tanti prima del montaggio.
- Nome file: `BR_Intercessor-Sergeant_Bolt-rifle_20261122-201500.png`, così in galleria i più recenti sono in cima.

### Libreria

Gioco → Fazione → Miniatura → scheda miniatura (foto, armi collegate). Ogni livello ha +, e un menu ⋮ con Rinomina, Preferito, Elimina (con conferma che dice quanti elementi figli spariscono). Nella scheda: "Aggiungi arma" o "Collega arma della fazione". Ogni gioco ha anche la voce Azioni: "Importa PNG" (quelli che l'amico ha già, esportati identici) o "Nuova azione" generata col template Azione. Per Kill Team ci sono già Reposition, Dash, Fall Back, Charge, Shoot, Fight, Pick Up Marker, Place Marker, modificabili.

### Importa carta e ritaglio

1. Da una fazione: "Importa carta" → Android propone Fotocamera, Foto o File; si possono scegliere più carte (coda).
2. La carta viene ridotta a 2400 px e salvata, così si può ritagliare di nuovo in futuro.
3. Schermata a tutto schermo: in alto il selettore "Miniatura | Arma | Icona azione"; al centro il riquadro di ritaglio (un dito sposta, due dita zoomano); in basso rotazione fine ±15°, ↺90 ↻90 e Ritaglia.
4. Pannello Assegna. Miniatura: scegli una esistente della fazione o "Nuova" + nome in inglese. Arma: nome nuovo o arma esistente, e miniature che la usano (già selezionata l'ultima miniatura ritagliata da questa carta).
5. Si resta sulla stessa carta: un elenco a chip mostra i ritagli fatti; si passa al successivo. "Carta successiva" o "Fine".
6. Tocco su una foto in Libreria → "Ritaglia di nuovo" riapre la carta di origine col riquadro salvato.

### Template

Elenco per tipo (Attivazione, Azione) con Duplica, Rinomina, Predefinito. Editor: anteprima fissa in alto, sotto gruppi a fisarmonica: Dimensioni, Targa di sfondo, Immagine, Righe di testo (font, dimensione, colore, contorno, ombra, maiuscolo, allineamento), Immagine arma. "Importa font" (.ttf, .otf, .woff2). Salvataggio automatico.

### Altro

Backup ed esportazione, ripristino, coda ("Salva tutti" / "Condividi tutti"), larghezza predefinita, cartella di salvataggio (se disponibile), spazio occupato, versione e "Aggiorna app".

## 4. Limiti di Android e soluzioni

Il limite principale: una web app non può scrivere direttamente nella Galleria. Il download nella cartella Download lo aggira, perché Android la indicizza e il selettore foto la mostra.

| Limite | Effetto | Soluzione |
|---|---|---|
| Nessun accesso diretto alla Galleria | non si può "salvare in Foto" | download con link a download: il file va in Download/ ed è identico byte per byte, quindi la trasparenza resta. Verifica al passo 1 |
| Condividere verso InShot apre un nuovo progetto, non uno sticker | la condivisione diretta non serve allo scopo | Condividi solo per Google Foto, File o Drive. InShot prende lo sticker dalla galleria |
| WhatsApp, Telegram e alcune app convertono in JPEG o WebP | trasparenza persa | mai passare da app di messaggi; in Google Foto usare qualità originale |
| Download multipli | Chrome chiede una volta "Consenti download multipli" | coda con download in sequenza (400 ms) oppure una sola condivisione con più file |
| Nomi file doppi | Chrome aggiunge "(1)" | data e ora nel nome |
| Cartella dedicata (showDirectoryPicker) | supporto su Android non garantito; file forse non visibili subito in galleria | solo se il browser la offre, con ritorno automatico al download; da verificare al passo 9 |
| Dati in IndexedDB | si cancellano se si svuotano i dati del sito o con memoria quasi piena | navigator.storage.persist() all'avvio, promemoria di backup dopo 14 giorni |
| Foto da 50 MP | il canvas può esaurire la memoria e bloccarsi | riduzione a 2400 px con createImageBitmap al momento dell'import |
| Orientamento delle foto | rischio di carte ruotate | createImageBitmap rispetta l'EXIF; si prova una foto verticale |
| Font non ancora caricati | il PNG esce col font di sistema | attendere document.fonts.load prima di disegnare |
| Gesti sul ritaglio | il trascinamento ricarica la pagina o scorre | ritaglio a tutto schermo, touch-action: none, overscroll-behavior: contain |
| Cache del service worker | l'app resta alla versione vecchia | CACHE_VERSION e pulsante "Aggiorna" |
| Risoluzione | il canvas segue i pixel CSS, non quelli reali | disegnare sempre alle dimensioni di esportazione, fuori dal DOM |

## 5. Piano di sviluppo

9 passi; ognuno si prova sul telefono prima di passare al successivo.

**Contesto da incollare in testa a ogni prompt:** PWA per Android/Chrome "Sticker Battle Report" che genera sticker PNG trasparenti per montare battle report di wargame (Kill Team, Warhammer 40,000, The Old World, altri in futuro) nell'app InShot. Gerarchia dati: Gioco > Fazione > Miniatura > Arma, più Azioni. Vincoli: HTML + CSS + JavaScript a moduli ES, nessun framework, nessuna build, nessun CDN (librerie in /vendor), nessun server, nessun account. Interfaccia in italiano; i nomi di giochi, fazioni, miniature, armi e azioni sono in inglese e li inserisce l'utente. Mobile-first, tema scuro, aree di tocco minime 48 px, pannelli dal basso al posto di prompt()/alert(). Dati in IndexedDB con Dexie 4. Router a hash; il tasto indietro di Android deve tornare al livello precedente. Regole: ogni volta che aggiungi o rinomini un file aggiorna l'elenco dei file in cache in sw.js e incrementa CACHE_VERSION. Non modificare file estranei al passo. Se non puoi scaricare una libreria o un font, dire esattamente quale file mettere e dove. A fine lavoro elencare i file toccati e cosa provare sul telefono.

### Passo 1 – Scheletro e test di esportazione (FATTO)

- index.html con barra in basso a 4 voci (Crea, Libreria, Template, Altro), router a hash in js/app.js.
- manifest.webmanifest (name "Sticker Battle Report", short_name "Sticker BR", standalone, portrait, colori scuri, icone 192 e 512 anche maskable).
- sw.js cache-first con CACHE_VERSION, pulizia delle cache vecchie; barra "Nuova versione disponibile - Aggiorna".
- js/export.js: saveBlob (download con `<a download>`, revoca dopo 10 s), shareBlobs (navigator.share con canShare, altrimenti saveBlob). Nessuna ricompressione.
- In Altro: test esportazione, PNG 1080x360 trasparente, nome BR_test_AAAAMMGG-HHMMSS.png.
- README.md con la pubblicazione su GitHub Pages.

Verifica: installabile; offline funziona; "Salva PNG di prova" in Download e nel selettore foto; in InShot, Sticker → personalizzato, trasparenza visibile.

### Passo 2 – Database e Libreria (FATTO)

- vendor/dexie.min.js (Dexie 4), js/db.js con schema versione 1 come in sezione 2, booleani 0/1.
- CRUD per giochi, fazioni, miniature, armi; eliminazione a cascata (gioco o fazione eliminano figli, immagini e carte; la miniatura toglie il suo id da weapons.unitIds ed elimina solo le armi rimaste senza miniature).
- Primo avvio (settings.seeded): Kill Team {Squadra, Operativo, Arma}, Warhammer 40,000 e The Old World {Esercito, Unità, Arma}. navigator.storage.persist().
- Libreria con breadcrumb, +, menu Rinomina/Preferito/Elimina con conferma e conteggio figli, "Aggiungi arma", "Collega arma della fazione", ordine alfabetico, nuovi giochi con etichette.

### Passo 3 – Importa carta e ritaglio (FATTO in forma semplificata, vedi stato)

Piano originale: Cropper.js 1.6.x; "Importa carta" da fazione e scheda miniatura con coda; riduzione a 2400 px, JPEG 0.9 in cards; schermata #/ritaglio/:cardId a tutto schermo con selettore Miniatura | Arma | Icona azione, rotazione ±15°, ruota 90°, Ritaglia (lato lungo max 1200 px, PNG in images con kind, cardId, crop); pannello Assegna; "Ritaglia di nuovo" dalla carta di origine.

### Passo 4 – Motore sticker e Anteprima (FATTO)

- js/render.js: renderSticker(data, config) → Promise<Blob>. data = {unitName, weaponName, actionName, factionName, unitImage, weaponImage}. Canvas fuori dal DOM alla larghezza config.width in pixel reali; await document.fonts.load per ogni font; strokeText sotto e fillText sopra, lineJoin round, ombra e maiuscolo facoltativi; se il testo non entra riduci fino a minSize, poi tronca con "..."; targa con colore, opacità e bordo; immagini con raggio e bordo; se trim è true taglia i bordi trasparenti lasciando padding; toBlob('image/png').
- fonts/: Bebas Neue, Oswald, Roboto Condensed in woff2 (OFL) con @font-face in app.css.
- Primo avvio: template "Attivazione" (activation: immagine miniatura a sinistra, riga 1 nome miniatura, riga 2 arma), "Solo testo" (activation, senza immagine), "Azione" (action: una riga grande con il testo dell'azione, icona facoltativa a sinistra). Predefiniti per tipo in settings.defaultTemplates.
- Schermata #/anteprima?unit=&weapon=&action=&template=: sticker su scacchi, chip template, interruttori "Immagine miniatura" e "Immagine arma", testo modificabile solo per questo sticker, pulsanti grandi Salva e Condividi. Nome file BR_<miniatura>_<arma>_<AAAAMMGG-HHMMSS>.png (spazi in trattini, caratteri non sicuri rimossi).
- Dopo Salva/Condividi: recents (chiave unica, max 30, elimina i più vecchi), lastUsed e useCount.
- Provvisorio: nella scheda miniatura, tocco su un'arma apre l'Anteprima.

Verifica: PNG largo 1080 px e trasparente in InShot; font giusto anche al primo avvio offline; nome lungo non esce dallo sticker; niente margini trasparenti inutili.

### Passo 5 – Schermata Crea

- js/search.js: indice in memoria costruito all'avvio e aggiornato a ogni modifica del db. Nomi normalizzati (minuscolo, senza accenti e punteggiatura); ogni parola digitata deve essere l'inizio di una parola del nome; filtrabile per gioco.
- Ricerca e chip del gioco attivo (settings.lastGameId; "Tutti"). Risultati raggruppati Miniature, Armi ("Bolt rifle · Intercessor Warrior"), Azioni; max 8 per gruppo.
- Quattro schede: Recenti (renderSticker, cache in memoria), Preferiti (fav=1 e settings.favCombos), Azioni (griglia), Sfoglia (fazioni > griglia miniature con immagine).
- Tocco su miniatura: pannello con armi e "Solo miniatura"; arma → Anteprima (se più miniature, chiede quale). Tocco su recente: Anteprima; tocco lungo 500 ms con vibrazione breve: salva subito con lo stesso template, toast "Salvato".
- In Anteprima stella per le combinazioni preferite.
- Temporaneo in Altro: "Genera 300 elementi di prova" e "Elimina dati di prova".

Verifica: recente salvato con 1 tocco lungo; nuovo con ricerca + 3 tocchi; con 300 elementi nessun ritardo percepibile.

### Passo 6 – Azioni (parte base già fatta)

- In Libreria, dentro ogni gioco, voce "Azioni" con elenco e anteprima.
- "Importa PNG": input multiplo accept="image/png"; ogni file diventa un'azione mode 'png', nome dal file (reposition.png → Reposition, pick_up_marker.png → Pick Up Marker), Blob senza ricompressione; Salva e Condividi esportano il file originale identico.
- "Nuova azione": nome, testo a schermo, icona facoltativa (immagini kind 'action' o PNG), template di tipo action → mode 'generated'.
- Opzione "Valida per tutti i giochi" (gameId null; vedi attenzione sull'indice).
- Una volta sola (settings.seededActions) azioni generate di Kill Team: Reposition, Dash, Fall Back, Charge, Shoot, Fight, Pick Up Marker, Place Marker.
- Le azioni compaiono in ricerca, scheda Azioni di Crea, recenti e preferiti.

Verifica: un PNG già esistente esce identico (stessi KB); le azioni generate hanno lo stile del template Azione.

### Passo 7 – Editor dei template e font

- Schermata Template: elenco per tipo con Duplica, Rinomina, Elimina (non l'ultimo del tipo), Imposta predefinito.
- Editor: anteprima fissa in alto (40% dello schermo) su scacchi con i dati dell'ultimo recente o "Intercessor Sergeant" / "Bolt rifle". Gruppi a fisarmonica: Dimensioni (larghezza 540-2160, padding, taglio margini), Targa, Immagine (lato sinistra/destra/sopra, altezza, raggio, bordo), Righe di testo (aggiungi/rimuovi/ordina; origine, font, dimensione, minima, colore, contorno, ombra, maiuscolo, allineamento), Immagine arma (mostra, sotto o a destra, altezza massima). Colori con `<input type="color">`. Ridisegno al massimo una volta per frame, salvataggio automatico.
- "Importa font" (.ttf, .otf, .woff2): salva in fonts, registra con FontFace a ogni avvio, compare nei menu dei font.

Verifica: modifiche dopo il riavvio; font importato nel PNG anche offline; PNG esportato uguale all'anteprima.

### Passo 8 – Backup e ripristino

- vendor/jszip.min.js (JSZip 3), js/backup.js e sezione Backup in Altro. "Esporta backup": ZIP con data.json {app:'sticker-br', schemaVersion, exportedAt, tables:{...}}, Blob sostituiti da images/<id>.png, cards/<id>.jpg, fonts/<id>.<ext> più i file. Interruttore "Includi carte originali" (attivo di default). Nome BR_backup_AAAAMMGG.zip, Salva e Condividi. Salva settings.lastBackupAt.
- "Ripristina": scegli lo .zip, controlla app e schemaVersion, riepilogo (giochi, fazioni, miniature, armi, azioni, immagini, template), conferma "Sostituisce tutti i dati attuali". Prima scarica in automatico un backup dei dati attuali, poi svuota e reimporta mantenendo gli id in una sola transazione. File non valido: errore e nessun dato toccato. Dopo il ripristino ricarica indice di ricerca e font.
- In Crea avviso discreto se l'ultimo backup ha più di 14 giorni e ci sono modifiche successive.

Verifica: esporti, cancelli i dati del sito da Chrome, ripristini: tutto identico, immagini e font compresi; un file sbagliato dà errore senza cancellare nulla.

### Passo 9 – Rifiniture

- Coda: in Anteprima "Aggiungi alla coda"; icona coda con contatore in Crea; in Altro "Salva tutti" (download in sequenza ogni 400 ms), "Condividi tutti" (una sola navigator.share con più file), "Svuota coda".
- Cartella dedicata: solo se 'showDirectoryPicker' in window; handle in settings, queryPermission/requestPermission, createWritable; se qualcosa fallisce ripiega sul download e lo dice; altrimenti nascondi l'opzione.
- Altro: spazio usato (navigator.storage.estimate), stato della memoria persistente, versione dell'app.
- Rimuovi il test di esportazione e il generatore di dati di prova.
- Rivedi i testi in italiano, stati vuoti con istruzioni, aree di tocco, contrasti del tema scuro.
- Controlla che sw.js contenga tutti i file e incrementa CACHE_VERSION.

Verifica: prova completa offline (importa una carta, ritaglia, genera 5 sticker, mettili in un video InShot); la coda salva tutti i file; con la cartella dedicata i file compaiono nel selettore di InShot, altrimenti restare su Download; Altro mostra "Memoria persistente: sì".
