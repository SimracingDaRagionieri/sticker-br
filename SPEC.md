# Sticker Battle Report – progetto PWA

Specifica e piano di sviluppo (documento del 22/11/2026). I prompt dei singoli passi fanno riferimento alle sezioni 2–4.

## Stato di avanzamento (aggiornato al 23/11/2026, sera)

- PASSO 8 (Azioni) REALIZZATO, DA PROVARE SUL TELEFONO. CACHE_VERSION 'v13'. Dettaglio nella sezione "Passo 8". Test: `node tests/actions-test.mjs` (16 controlli), `python3 tests/ui-azioni-test.py` (Chrome headless, ~75 controlli); i test dei Passi 6 e 7 restano verdi (`ui-crea-test.py` ora attende 48 azioni in griglia: 40 di prova + 8 di Kill Team; ha 2-3 controlli sensibili ai tempi che a volte falliscono una volta su una decina e passano alla ripetizione). Il Passo 6 resta aperto in attesa del nuovo `diagnostica-pdf.json` di Manu.
- PASSO 7 (schermata Crea) REALIZZATO, DA PROVARE SUL TELEFONO. CACHE_VERSION 'v12'. Il Passo 6 resta aperto in attesa del nuovo `diagnostica-pdf.json` di Manu (difetto noto: nell'equipaggiamento SNIPER OVERWATCH la tabella dell'arma resta nel testo). Dettaglio nella sezione "Passo 7" piu' sotto. Test: `node tests/search-test.mjs` (33 controlli), `python3 tests/ui-crea-test.py` (Chrome headless: genera i 300 elementi da Altro, ricerca, schede, pannelli, tocco lungo con mouse e con tocco vero CDP, stella, riferimenti eliminati, eliminazione dei dati di prova); i test del Passo 6 (`pdfteam-test.mjs` 159/159, `ui-pdf-test.py`) restano verdi.
- PASSO 6, secondo giro (screenshot degli avvisi di Manu, 23/11/2026, CACHE_VERSION 'v10'): dagli avvisi reali risulta che (1) il retro dice "RULES CONTINUE ON OTHER SIDE" (non "ON BACK"); (2) la riga delle parole chiave finisce con la dimensione della base ("... SWARMGUARD 28", "OVERSIGHT, DRONE 25") e veniva letta come titolo vuoto: ora la base e' scartata; (3) i titoli di abilita'/azioni ("Warrior Instincts:", "Evasive Drone: AERIAL GUIDANCE 1AP") NON vengono riconosciuti come grassetto: ora, se non c'e' grassetto, una riga con costo AP e' un'azione e "Titolo Maiuscolo:" a inizio frase e' un'abilita' (da verificare: il nome del font reale e' nel file di diagnostica); (4) le intestazioni di colonna ripetute ("VESPID STINGWING VESPID STINGWING") nelle pagine regole non sono piu' voci vuote. I testi con elenchi puntati ("•") dopo un titolo restano attaccati al blocco. Prove di regressione in `tests/pdfteam-test.mjs`.
- PASSO 6, prima prova su PDF veri (feedback di Manu, 23/11/2026): funziona ma con "diversi avvisi", fatica a collegare le regole divise su piu' pagine, e il ritratto non serve. Corretto (CACHE_VERSION 'v9'): (1) un `"` a fine riga dopo una cifra (3") non e' piu' fine frase e una parola chiave in grassetto seguita da `)` `,` `.` non apre un titolo: prima "BEACON) would be incapacitated..." diventava un'abilita' finta (test di regressione in `tests/pdfteam-test.mjs`); (2) "Ritaglia il ritratto" spento di default, niente immagini a pagina intera come ritratto, scala adattiva (max 1200 px) invece di 300 dpi fissi; (3) pulsante "Salva file di diagnostica" nella revisione (JSON con testo, posizioni, font, avvisi; nessuna immagine) e `node tests/replay-dump.mjs <file>` per rileggerlo in Node. ANCORA DA FARE con la diagnostica o i PDF veri: elenco degli avvisi reali, regole/abilita' che continuano su altra pagina (retro senza intestazione = pagina ignorata?), tipo arma (icona non letta come testo: resta 'Altro').
- PASSO 6, terzo giro (dalla diagnostica reale di spectre.pdf, CACHE_VERSION 'v11'): font "-BdCn" riconosciuto come grassetto; abilita' su due colonne separate col vuoto verticale; fogli di carte regola 2x2 letti per cella (etichetta, titolo, narrativa, testo; "(CARD k/n)" unite, retro "RULE CONTINUES ON OTHER SIDE" agganciato); riquadro NOTES ignorato; nome squadra da parole chiave prima del nome file; avviso "nessuna arma" solo se la carta ha una tabella. Replay sul file reale: 0 avvisi (prima 4), 15 carte, 1 regola di fazione + CAMO CLOAKS, 4+4 stratagemmi, 4 equipaggiamenti. Da riprovare sul telefono da Manu.
- PASSO 6 (importa PDF squadra) SCRITTO MA NON CHIUSO: provato solo su 5 PDF SINTETICI (nomi inventati, `tests/make-synth-fixtures.py`), nessun PDF Games Workshop vero era disponibile. Il formato inglese reale (etichette, posizione di nome e statistiche, titoli delle pagine regole, simboli arma a distanza/mischia, struttura del retro) e' ipotizzato dalla descrizione del campione italiano: va verificato con almeno 3 PDF veri copiati in `tests/fixtures/` (`node tests/pdfteam-test.mjs` li stampa; confrontare con `pdftoppm -r 60 -png`). CACHE_VERSION 'v8'.
  - `vendor/pdfjs/` = pdfjs-dist 6.5.438 (build moderna `pdf.min.mjs` + `pdf.worker.min.mjs`, licenza Apache-2.0). Niente cMap/standard_fonts/wasm: i PDF GW incorporano i font; immagini JPX/JBIG2 non si decodificherebbero (il ritaglio fallisce con un avviso in console, l'import continua). In Node i test usano la build `legacy` (`npm i --no-save pdfjs-dist`).
  - `js/pdfread.js`: `openPdf` (fontExtraProperties: serve per i nomi dei font = grassetto), `extractPages` -> pagine `{num,width,height,items[{str,x,y,w,h,font,bold}],images[]}` (y = linea di base dall'alto), `renderRect(doc,page,rect,{scale})` per i ritagli (300 dpi).
  - `js/pdfteam.js` (puro): `parseTeam(pages,{lang,name,title})`, dizionari `LANGS` (`en`; `it` solo per la fixture, titoli pagina e frase "retro" italiani NON verificati), `weaponGroups`, `matchWeaponGroups`, `splitRules`, `splitModeFromName`. Metodo: intestazioni = etichette APL/MOVE/SAVE/WOUNDS sulla stessa riga; valori = elementi corti sotto/accanto; nome = testo piu' grande sopra o a sinistra; colonne di carte separate dal vuoto piu' largo; tabella armi dalle etichette NAME/ATK/HIT/DMG/WR (tutte e 5 obbligatorie), riga arma = ATK/HIT/DMG presenti, nome e WR su piu' righe assegnati alla riga numerica piu' vicina, modo = ultima parentesi del nome; abilita'/azioni = riga che inizia in grassetto (azione se c'e' `nAP`); parole chiave = riga tutta maiuscola con virgole; fronte+retro uniti per nome; regola di fazione/stratagemmi/equipaggiamento dal titolo di pagina; le altre pagine sono "ignorate" (elencate nella revisione, senza avviso).
  - Output: `warnings[{code,page,message,text}]`: formati dubbi (campo conservato com'e' + `suspect`), statistiche/nome mancanti, righe arma senza nome, testo non attribuito, colonne non separabili, operativo senza armi, nessuna regola/stratagemma/equipaggiamento, fronte senza retro, statistiche diverse tra fronte e retro. NON implementato: "ogni arma citata nel testo delle regole esiste" (serve il testo vero per progettarlo). `kind` dell'arma resta 'other' salvo simbolo (⌖ ◎ / ⚔) letto come testo: i simboli veri vanno verificati.
  - `db.version(2)` con `rules: '++id, factionId, kind, name'` (righe `{factionId, kind: factionRule|ploy-strategy|ploy-firefight|equipment, name, cost, text, page, source:'pdf'}`); eliminare una fazione elimina le sue regole. `factions.keywords` (campo senza indice). Funzioni: `listRules`, `findFactionByName`, `previewTeamSave`, `saveTeam` (una transazione). Reimport: fazione e miniature per nome; arma per nome visualizzato + profilo (poi riga libera con lo stesso nome, anche manuale); le armi collegate si UNISCONO (mai scollegate); `rules` con source 'pdf' sostituite. Nome arma salvato = `Nome (modo)`; `weapons.profile = {atk,hit,dmg,rules[],mode}`.
  - Immagini: profilo arma = intestazione colonne + riga, impilate, PNG max 1200 px (+thumb); ritratto = immagine bitmap che copre la banda dell'intestazione (dalle operazioni di disegno di pdf.js, non da ipotesi di layout). Mai sostituite senza scelta ("Sostituisci / Tieni quelli esistenti / Torna indietro").
  - `js/screens/pdfimport.js`, route `#/pdf?g=&f=` (senza voce nella barra; il PDF letto vive solo in memoria, ricaricando si torna in Libreria): avvisi in cima, lingua, nome squadra, riepilogo nuovi/aggiornati, campi modificabili (nome, 4 statistiche, per arma nome/profilo/ATK/HIT/DMG/WR/tipo; bordo rosso = formato dubbio), conferma se ci sono avvisi. Pulsanti "Importa PDF squadra" nella pagina gioco e nella pagina fazione; scheda miniatura con statistiche, armi con profilo testuale, abilita'/azioni/parole chiave; pagina fazione con sezione Regole.
  - Test: `node tests/pdfteam-test.mjs` (146 controlli, PDF sintetici + eventuali veri), `python3 tests/ui-pdf-test.py` (Chrome headless, service worker bloccato: import, salvataggio, reimport senza doppioni, immagini mantenute, avvisi). Fixture sintetiche in `tests/fixtures-synth/` (ignorata da git, rigenerabile).
  - Da fare quando arrivano i PDF veri: adattare dizionario/soglie (tabella senza spazio dopo l'ultima riga e titoli abilita' su riga propria sono le zone piu' fragili), icone arma, nome squadra (ora: PDF title/nome file, da confermare nella revisione).

- Passi 1, 2, 3, 4 e 5 completati (il Passo 5 va ancora provato sul telefono). CACHE_VERSION 'v7'.
- Passo 3 realizzato in forma semplificata: il ritaglio avviene direttamente sull'immagine di miniatura/arma (js/crop.js), senza tabella `cards` né schermata `#/ritaglio`. Superato dal nuovo Passo 5: le carte non si salvano.
- Anticipo parziale del Passo 8 (ex 7): in Libreria, dentro ogni gioco, sezione Azioni con aggiungi, rinomina, preferito, elimina e `accentColor` facoltativo (righe `actions` = `{ gameId, name, accentColor, fav, lastUsed }`).
- Passo 4: js/render.js (`renderSticker(data, config)`, `normalizeConfig`), font in /fonts (woff2 Latin/Latin-ext, licenze OFL-*.txt), template predefiniti "Attivazione", "Solo testo" (activation) e "Azione" (action) creati una volta sola (`settings.seededTemplates`, `settings.defaultTemplates` = {activation: id, action: id}), schermata `js/screens/anteprima.js`.
- Router: `parseHash()` e `canGoBack()` esportati da app.js; `#/anteprima?unit=&weapon=&action=&template=` non ha voce nella barra (resta attiva quella di provenienza). Il cambio template usa `history.replaceState`, quindi "indietro" torna alla provenienza.
- db.js: nuovi `listTemplates(kind)`, `getTemplate`, `getDefaultTemplate(kind)`, `getStickerSource({unitId,weaponId,actionId})` (righe + Blob immagini), `recordUse({unitId,weaponId,actionId,templateId})` (lastUsed, useCount, `recents` con chiave tipo `u12-w40-t1`, max 30). export.js: `stickerFilename(parti)`.
- Convenzioni del motore: `padding` = margine trasparente mantenuto dopo il taglio; con targa lo sticker è largo esattamente `width` (1080), senza targa ("Solo testo") è tagliato sul testo e quindi più stretto; `plate.padding` (predefinito 28) = spazio targa-contenuto; `lines[].weight` facoltativo; `stroke.width` = spessore visibile del contorno; se il template non ha `plate.border` e i dati hanno `accentColor`, questo diventa il bordo della targa.
- Dopo la prova sul telefono: "Attivazione" senza targa (sfondo trasparente) e con `weaponImage.show: true, replaceText: true` (il profilo arma importato dalla carta prende il posto del nome arma scritto; se l'arma non ha immagine resta il testo). I template predefiniti vengono riscritti una volta sola (`settings.templatesRev` = 2).
- Provvisorio in Libreria: tocco su un'arma nella scheda miniatura e pulsante "Sticker solo <miniatura>" aprono l'Anteprima; menu ⋮ di un'azione: "Anteprima sticker".
- Attenzione per il Passo 7 (schermata Crea): eliminando giochi/miniature/armi/azioni le righe `recents` non vengono ripulite; ignorare i recenti con riferimenti mancanti.
- Piano riorganizzato (23/11/2026): nuovo Passo 5 "Importa carta e profili arma automatici" (senza OCR, icone insegnate una sola volta, fasce correggibili a mano); i vecchi Passi 5-9 sono ora 6-10.
- Passo 5 (importa carta e profili arma automatici) realizzato:
  - `js/cardscan.js` (parte pura, senza DOM): `findWeaponRowsGray(card, templates, { sensitivity })` con card/icone in grigio `{data,width,height}` a larghezza `SCAN_W` = 480; correlazione normalizzata (integral image per media/varianza), scale 0.8-1.25, scansione grossolana a passo 3 + rifinitura ±2 px, soglia = `thresholdFor(sens)` (0 -> 0.80, 0.5 -> 0.625, 1 -> 0.45), soppressione dei doppioni per sovrapposizione verticale, filtro "colonna delle icone" (scarta le isolate: meglio meno fasce), fascia = da 0.4 x altezza icona sopra l'icona fino alla riga dopo (ultima: passo mediano, o 3 x icona se e' una sola). Helper con DOM: `canvasToGray`, `cropToTemplate(canvas, {x,y,w,h})` -> PNG grigio a scala di lavoro, `templateFromBlob`, `findWeaponRows(canvas, iconTemplates, { sensitivity, cache })` -> fasce in pixel della carta originale. Tempo misurato: ~0.5 s su PC per una carta 480x672 con 2 icone x 5 scale.
  - `js/screens/carta.js`, route `#/carta?g=<gioco>&f=<fazione>[&u=<miniatura>]` (senza voce nella barra; la carta ridotta a 2400 px vive solo in memoria in `pending`, nessuna tabella `cards`; se la pagina viene ricaricata su #/carta si torna in Libreria). `startCardImport({gameId, factionId, unitId})` e' chiamato dai pulsanti "Importa carta" della pagina fazione e della scheda miniatura (il selettore file si apre subito nel tocco). `export function cleanup()`: app.js ora chiama `cleanup()` della schermata che si lascia (se esiste).
  - Icone: `settings.iconTemplates = { [gameId]: { ranged?: Blob, melee?: Blob } }` (PNG grigi alla scala di lavoro) con `getIconTemplates`, `setIconTemplates(gameId, parts)` (unisce), `clearIconTemplates(gameId)` in db.js. Primo uso per gioco: modalita' "Insegna" (riquadro sull'icona a distanza, poi sulla mischia; "Non c'e'"/"Salta" se manca un tipo). "Reimposta icone" e' nel menu ⋮ della schermata carta.
  - Fasce: `{ id, y0, y1, x0, x1, kind: ranged|melee|other, src: auto|manual, edited }` in pixel della carta; si sposta dentro la fascia, si ridimensiona dai bordi (sopra/sotto sempre; sinistra/destra solo se selezionata), "+ Fascia" (al centro della vista, tipo "Altro"), "Elimina", "Rileva armi" (rilancia e conserva le fasce manuali o modificate), cursore Sensibilita' (rilancia al rilascio). Un dito fuori dalle fasce sposta la carta, due dita zoomano.
  - Conferma (pannello dal basso): un campo "Arma" per fascia (arma della fazione con indicazioni "gia' collegata"/"ha profilo", oppure Nuova + nome + tipo preselezionato dall'icona). Dalla pagina fazione c'e' anche la scelta della miniatura (esistente o nuova). Un nome nuovo uguale (senza maiuscole/spazi doppi) a un'arma esistente la riusa; la stessa arma su due fasce e' bloccata. Se l'arma ha gia' un profilo: pannello "Sostituisci / Tieni quelli esistenti (collega soltanto) / Torna indietro". Profili salvati con `setWeaponImage` (PNG, lato lungo max 1200 px, nessuna trasparenza), collegamento con `setUnitWeapons` (unione con le armi gia' collegate). Poi proposta facoltativa di ritaglio della miniatura con `cropImage` dalla stessa carta (JPEG 0.92 in memoria). Uscita: dalla scheda miniatura `history.back()`; dalla fazione `location.replace` sulla scheda miniatura.
  - z-index: la schermata carta sta a 9 (sotto toast 11 e pannelli 20, sopra la barra); il ritaglio di crop.js resta a 30.
  - Test fuori dall'interfaccia: `node tests/cardscan-test.mjs` (carte finte da `tests/fakecard.mjs`: dritte, icone -15%/+20%, rumore, storte ±2.5 gradi, senza armi). La cartella `tests/` non e' servita ne' messa in cache.
- DECISIONE (23/11/2026, Vando e Manu): la sorgente dei dati diventa il PDF ufficiale Games Workshop della squadra, in INGLESE (testo vero, mai foto). L'app deve riconoscere da sola operativi, statistiche, armi con profilo, abilita', azioni, regola di fazione, stratagemmi ed equipaggiamento. Nuovo Passo 6 "Importa PDF squadra"; i vecchi Passi 6-10 diventano 7-11. Il Passo 5 (fasce da foto) resta come ripiego manuale per singole immagini, senza altre modifiche.
- Campione ricevuto: PDF italiano "Exaction Squad" (15 pagine, 11 tipi di agente, pp. 1-4 carte operativo fronte/retro, p. 5 composizione, p. 6 regola di fazione, p. 7 stratagemmi Strategy, p. 8 stratagemmi Firefight, p. 9 equipaggiamento, pp. 10-11 aggiornamenti/errata, pp. 12-15 descrizioni e riepilogo armi). Ha i font incorporati: il testo si legge con coordinate, senza OCR. Etichette italiane: LPA/MOV/SALV/FER, NOME/ATT/COLP/DNN/RdA (inglese: APL/MOVE/SAVE/WOUNDS, NAME/ATK/HIT/DMG/WR). Non e' ancora arrivato nessun PDF inglese: servono almeno 2-3 squadre diverse per chiudere il Passo 6.
- ATTENZIONE copyright: i PDF GW non vanno MAI nel repository (e' pubblico e pubblicato su GitHub Pages). Fixture solo in `tests/fixtures/` (in .gitignore) sul computer di chi testa; i dati letti restano solo in IndexedDB sul telefono.
- Prossimo: Passo 9 (editor dei template e font). Il Passo 6 si chiude con i PDF veri (vedi diagnostica di Manu); il Passo 7 e' fatto e va provato sul telefono.
- Risolto al Passo 8: `listActions(gameId)` unisce le azioni globali (`gameId: null`) con un filtro sulla tabella; ogni nuovo uso di `listActions` va deciso (`includeGlobal`).

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

Estensione dati del Passo 6 (PDF squadra). Sulle righe esistenti si aggiungono campi SENZA indice, quindi lo schema versione 1 non cambia: `units.stats = { apl, move, save, wounds }`, `units.keywords[]`, `units.abilities[] = { name, text }`, `units.actions[] = { name, cost, text }`, `units.source = 'pdf'|'manual'`; `weapons.profile = { atk, hit, dmg, rules[], mode }` (`mode` = es. "short range"/"long range" quando la stessa arma ha piu' profili). Le regole di fazione, gli stratagemmi e l'equipaggiamento stanno in una nuova tabella che richiede `db.version(2)` (ripetere tutte le tabelle della v1): `rules: '++id, factionId, kind, name'` con `kind` = factionRule | ploy-strategy | ploy-firefight | equipment e campi `{ factionId, kind, name, cost, text }`. Il backup (Passo 10) deve includere `rules`.

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

### Importa PDF squadra (Passo 6)

Da un gioco in Libreria: "Importa PDF squadra" -> scegli il PDF ufficiale (inglese) -> l'app lo legge sul telefono, mostra una schermata di revisione (squadra, operativi con statistiche, armi con profilo, abilita', azioni, stratagemmi, equipaggiamento; avvisi in cima per tutto cio' che non ha riconosciuto con certezza) -> Salva. Reimportando lo stesso PDF si aggiorna per nome, senza duplicati.

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
| Cartella dedicata (showDirectoryPicker) | supporto su Android non garantito; file forse non visibili subito in galleria | solo se il browser la offre, con ritorno automatico al download; da verificare al passo 11 |
| Dati in IndexedDB | si cancellano se si svuotano i dati del sito o con memoria quasi piena | navigator.storage.persist() all'avvio, promemoria di backup dopo 14 giorni |
| Foto da 50 MP | il canvas può esaurire la memoria e bloccarsi | riduzione a 2400 px con createImageBitmap al momento dell'import |
| Orientamento delle foto | rischio di carte ruotate | createImageBitmap rispetta l'EXIF; si prova una foto verticale |
| Font non ancora caricati | il PNG esce col font di sistema | attendere document.fonts.load prima di disegnare |
| Gesti sul ritaglio | il trascinamento ricarica la pagina o scorre | ritaglio a tutto schermo, touch-action: none, overscroll-behavior: contain |
| Cache del service worker | l'app resta alla versione vecchia | CACHE_VERSION e pulsante "Aggiorna" |
| Risoluzione | il canvas segue i pixel CSS, non quelli reali | disegnare sempre alle dimensioni di esportazione, fuori dal DOM |

## 5. Piano di sviluppo

11 passi; ognuno si prova sul telefono prima di passare al successivo.

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

### Passo 5 – Importa carta e profili arma automatici (FATTO, da provare sul telefono)

(Dal 23/11/2026 resta come ripiego manuale: la via principale e' il Passo 6.) Idea: si carica la foto/screenshot di una carta operativo e l'app propone da sola una striscia per ogni arma (profilo completo: nome, A, BS/WS, D, regole). Niente OCR: il nome dell'arma si scrive una sola volta; poi l'arma resta collegata all'operativo (e riusabile da altri operativi della fazione), quindi la carta di quell'operativo non serve più.

- Ingresso: da fazione e da scheda miniatura, "Importa carta" (js/crop.js ha già pickImage). La carta si riduce a 2400 px con createImageBitmap e resta solo in memoria: NIENTE tabella `cards` e niente carte nel backup (decisione: risparmia spazio; l'immagine ritagliata di miniatura/arma resta in `images`, "Ritaglia di nuovo" lavora su quella).
- Nuovo modulo js/cardscan.js (puro, senza DOM visibile): `findWeaponRows(bitmap, iconTemplates)` -> array di { y0, y1 } (strisce a tutta larghezza, ordinate dall'alto). Riconoscimento per icone: i simboli arma a distanza (mirino/munizioni) e mischia (spada) compaiono una volta per riga. Confronto per template matching su versione in scala di grigi ridotta (es. 600 px di larghezza), correlazione normalizzata a piu' scale (0.8-1.25), soglia regolabile, soppressione dei doppioni vicini; la striscia di una riga va dall'icona (meno un margine) fino a poco prima dell'icona successiva o fino alla fine della tabella.
- Le icone di riferimento si "insegnano" una volta sola, senza dover fornire immagini: la prima volta l'app mostra la carta, l'utente trascina un riquadro sull'icona a distanza e uno su quella di mischia; i due ritagli (piccoli PNG in grigio) si salvano in `settings.iconTemplates` per gioco `{ [gameId]: { ranged: Blob, melee: Blob } }` e si possono rifare da Altro/Libreria ("Reimposta icone"). Se l'utente allega carte campione, usarle per tarare soglia e scale.
- Schermata a tutto schermo `#/carta` (stile js/crop.js: canvas, touch-action none, tasto indietro Android): carta con le strisce proposte come fasce colorate; ogni fascia si sposta/ridimensiona trascinando i bordi, si elimina, e "Aggiungi fascia" ne crea una a mano (ripiego se il riconoscimento sbaglia o per carte storte). Pulsante "Rileva armi" (ri-esegue), cursore Sensibilita'.
- Conferma: elenco delle strisce con miniatura; per ciascuna un solo campo "Arma": scegli un'arma esistente della fazione (non ancora collegata o senza immagine) oppure "Nuova" + nome in inglese; tipo (distanza/mischia) preselezionato dall'icona trovata. Salvataggio: per ogni striscia ritaglio PNG (lato lungo max 1200 px, trasparenza non necessaria), `addWeapon` o collegamento con `setUnitWeapons`, `setWeaponImage(id, blob, w, h, thumb)`. Le armi gia' esistenti con immagine non vengono sovrascritte senza conferma.
- Facoltativo nello stesso flusso: dopo le armi, proporre il ritaglio della miniatura con crop.js (come oggi) dalla stessa carta.
- Anteprima: con il profilo arma importato lo sticker "Attivazione" lo mostra al posto del nome arma (gia' fatto: `weaponImage.replaceText`).

Verifica: con una carta di 3-4 armi le strisce proposte coincidono con le righe; la correzione manuale funziona su una foto leggermente storta; armi gia' presenti riusate senza doppioni; seconda carta dello stesso gioco senza dover rifare l'insegnamento icone; tasto indietro Android coerente.

### Passo 6 – Importa PDF squadra (NUOVO, 23/11/2026)

Idea: i PDF ufficiali Games Workshop sono sempre nello stesso formato, vettoriali e in inglese. Si carica il PDF e l'app crea fazione, operativi, armi (con ATK/HIT/DMG e regole), abilita', azioni, stratagemmi ed equipaggiamento. Niente OCR e niente foto. Le immagini (profilo arma, ritratto) si ritagliano dalla pagina disegnata, usando le coordinate del testo.

- `vendor/pdfjs/`: pdf.js (pdfjs-dist, build ES `pdf.min.mjs` + `pdf.worker.min.mjs`), in locale e nella cache di sw.js; worker con `GlobalWorkerOptions.workerSrc` relativo. Se non scaricabile, dire quali file mettere e dove.
- `js/pdfteam.js` (puro, senza DOM, testabile in Node): `parseTeam(pages, { lang })` dove `pages` = per ogni pagina l'elenco di elementi di testo `{ str, x, y, w, h, font, bold }` ricavato da pdf.js `getTextContent()` (in Node basta lo stesso). Restituisce `{ faction: { name, keywords[] }, operatives[], factionRule, ploys[], equipment[], warnings[] }` con operativo = `{ name, stats {apl,move,save,wounds}, weapons[{ name, mode, atk, hit, dmg, rules[] }], abilities[{name,text}], actions[{name,cost,text}], keywords[], pages[], boxes }` (`boxes` = rettangoli in punti PDF di intestazione e di ogni riga arma, per i ritagli).
- Dizionario lingue: `lang: 'en'` (APL, MOVE, SAVE, WOUNDS; NAME, ATK, HIT, DMG, WR; "RULES CONTINUE ON BACK"; AP; ploy/equipment) e struttura per aggiungerne altre; il PDF italiano di esempio serve come fixture di test (`lang: 'it'`).
- Metodo (coordinate, non regex sul testo piatto): riconoscere le intestazioni di carta (banda con nome in maiuscolo + quattro statistiche etichettate); tutto fino alla successiva appartiene alla carta; colonne della tabella armi dalle x delle etichette NAME/ATK/HIT/DMG/WR; nomi arma su due righe (es. "(short range)") uniti alla riga; fronte e retro della stessa carta uniti per nome (l'intestazione ripetuta e "rules continue on back"); abilita' = titolo in grassetto + testo; azioni = barra con costo "1AP"/"0AP"; pagine regola di fazione, stratagemmi (Strategy/Firefight) ed equipaggiamento riconosciute dal titolo di pagina; le pagine di lore, errata e riepilogo si ignorano (il riepilogo armi puo' servire a controllare le regole).
- AFFIDABILITA' (priorita' del passo): nessun valore inventato; ogni elemento non riconosciuto genera un avviso con pagina e testo; controlli di coerenza (4 statistiche per operativo, ATK intero, HIT `N+`, DMG `n/n`, nomi unici, numero di operativi = numero di intestazioni, ogni arma citata nel testo delle regole esiste); schermata di revisione prima di salvare, con campi dubbi modificabili a mano; reimport per nome senza duplicati; mai sovrascrivere immagini o modifiche manuali senza conferma.
- Salvataggio: crea/aggiorna fazione, operativi, armi (la stessa arma con lo stesso profilo su piu' operativi e' una sola riga collegata a tutti; stesso nome con profili diversi = righe distinte), tabella `rules` con `db.version(2)`. Campi extra come in sezione 2.
- Immagini facoltative (spunte, predefinite attive): profilo arma = riga della tabella a tutta larghezza con l'intestazione colonne, PNG lato lungo max 1200 px, ritagliato dalla pagina disegnata con pdf.js a circa 300 dpi; ritratto operativo = parte immagine della banda intestazione. Armi che hanno gia' un'immagine: chiedere prima di sostituire.
- Libreria: la scheda miniatura mostra statistiche, armi con profilo testuale e abilita'/azioni; la pagina fazione ha la sezione "Regole" (regola di fazione, stratagemmi, equipaggiamento).
- Test: `tests/pdfteam-test.mjs` con PDF in `tests/fixtures/` (NON committati) e risultati attesi scritti a mano; il passo non e' chiuso finche' non passa su almeno 3 PDF diversi (uno con armi a doppio profilo, uno con operativi fronte-retro, uno con operativi a una sola pagina). Stampare per ogni PDF: operativi trovati, armi, avvisi.

Verifica: importi un PDF dal selettore file del telefono (< 10-15 s); la revisione mostra gli stessi operativi e armi del PDF; zero avvisi sui PDF campione; reimportando non nascono duplicati; i profili arma ritagliati si vedono nell'Anteprima.

### Passo 7 – Schermata Crea (FATTO, da provare sul telefono)

Realizzato come da elenco qui sotto. Decisioni e dettagli di implementazione:

- `js/search.js`: parte pura (`normalize`, `tokens`, `matchesAll`, `buildIndex`, `searchIndex`, senza dipendenze, testata in Node) e `createLiveIndex(db)`, che costruisce l'indice al primo uso e lo segna "da rifare" con gli hook di Dexie (creating/updating/deleting su games, factions, units, weapons, actions; l'aggiornamento conta solo se cambiano nome, fazione, gioco, collegamenti, preferito, immagine, colore) sia subito sia a transazione conclusa. Si ricostruisce in modo pigro alla ricerca successiva (provato: una miniatura aggiunta/rinominata/eliminata compare/sparisce senza ricaricare). Regola: ogni parola e' l'inizio di una parola del nome, ordine libero; ordinamento: nome che comincia come la ricerca, poi tutte le parole nel nome, poi preferiti, poi nome (ordine numerico). Un'arma si trova anche con parole del nome di UNA sua miniatura ("bolt int"), mai mescolando miniature diverse; la riga mostra "Arma · Miniatura" (la miniatura che corrisponde, "+N altre miniature" se ce ne sono). Max 8 per gruppo con nota "+N altri". Le azioni con `gameId` null (Passo 8) valgono per ogni gioco e sono gia' gestite.
- `js/screens/crea.js`: ricerca + chip del gioco (`settings.lastGameId` = id oppure 'all'), schede Recenti / Preferiti / Azioni / Sfoglia. Il filtro per gioco vale per ricerca e per tutte le schede. Stato (testo, scheda, gioco, posizione di scorrimento) conservato in memoria: tornando dall'Anteprima si ritrova com'era. La scheda e la fazione aperta stanno nell'indirizzo (`#/crea?tab=sfoglia&f=<fazione>`): aprire una fazione aggiunge una voce alla cronologia, quindi il tasto indietro di Android torna all'elenco delle fazioni; cambiare scheda usa `replaceState` (nessuna voce).
- Sticker di Recenti, Preferiti e Azioni: `renderSticker` con `js/stickerinput.js` (`buildStickerInput`: stesse impostazioni predefinite dell'Anteprima, quindi il PNG del tocco lungo e' quello che l'Anteprima darebbe senza modifiche), disegnati solo quando entrano nella vista (IntersectionObserver), 2 alla volta, cache in memoria di 80 URL (la firma comprende template e dati, quindi cambiando nome/immagine/template si ridisegna). Template mancante o di altro tipo: si usa il predefinito. Recenti con riferimenti eliminati: ignorati (non si cancellano dal database).
- Tocco su un recente/preferito: Anteprima con `template`. Tocco lungo 500 ms (vibrazione 30 ms; si annulla se il dito si muove piu' di 10 px o parte lo scorrimento): salva subito col template del recente, `recordUse` (il recente sale in cima), toast "Salvato"; il click del rilascio non apre l'Anteprima e la griglia si ridisegna solo a dito sollevato. Il tocco lungo vale per Recenti e per le Combinazioni preferite; le Azioni in griglia e i risultati di ricerca hanno solo il tocco.
- Tocco su miniatura (risultato, Preferiti o Sfoglia): pannello con "Solo <etichetta operativo/unita'>" e le sue armi con immagine. Tocco su un'arma da ricerca/preferiti: se ha 1 miniatura va in Anteprima, se ne ha piu' chiede "Con quale ...?" (preselezionata in cima quella cercata), se non ne ha apre l'Anteprima solo con l'arma.
- Preferiti: `settings.favCombos = [{ key, unitId, weaponId, actionId, templateId, addedAt }]` (`key` = `db.comboKey`, la stessa dei recenti, template compreso: la stessa coppia con un altro template e' un'altra combinazione). Scheda Preferiti = Combinazioni (sticker) + miniature, armi e azioni con `fav = 1` (dal menu ⋮ della Libreria). Stella in Anteprima (`[data-fav]`, `db.toggleFavCombo` / `isFavCombo`), si aggiorna anche cambiando template. db.js: nuovi `comboKey`, `listRecents`, `getSetting`, `setSetting`, `listFavCombos`, `isFavCombo`, `toggleFavCombo`.
- Router (js/app.js): ogni schermata disegna in un contenitore proprio e `navigate()` scarta i caricamenti superati da una navigazione piu' recente, cosi' una schermata lasciata che finisce di caricare in ritardo non sovrascrive quella nuova (riprodotto solo premendo "indietro" entro pochi millisecondi dal tocco; su telefono lento puo' capitare davvero).
- TEMPORANEO (da togliere al Passo 11): `js/testdata.js` + sezione "Dati di prova" in Altro. "Genera 300 elementi di prova" crea il gioco "Prova (dati di prova)" (`test: 1`) con 10 squadre, 100 miniature (40 con immagine), 160 armi (54 con immagine, 1-3 miniature ciascuna), 40 azioni, 28 recenti e 4 combinazioni preferite; nomi inventati. "Elimina dati di prova" elimina il gioco a cascata e poi i recenti/preferiti che puntano a elementi inesistenti. Al Passo 11 vanno tolti anche l'import in sw.js e in altro.js.
- Misure (Chrome headless su PC, 300 elementi): ricerca 19-31 ms per tasto; schermata Crea con 28 recenti: struttura in ~80 ms e 6 sticker disegnati in ~210 ms; con CPU rallentata 6x (telefono lento) ricerca al massimo ~120 ms. Va confermato sul telefono vero.
- Non fatto (fuori dal Passo): coda "Aggiungi alla coda" (Passo 11), editor template (Passo 9), azioni PNG e globali (Passo 8).

VERIFICA SUL TELEFONO (Passo 7):
1. Altro > "Genera 300 elementi di prova": scrivere nel campo di Crea "warden cap", "bolt", "test action 05": risultati subito, nessun ritardo digitando.
2. Recenti: uno sticker salvato con un tocco lungo (vibra, toast "Salvato", il file BR_... e' in Download e sale in cima ai recenti) e senza aprire l'Anteprima; un tocco breve apre l'Anteprima; scorrendo la lista col dito non salva nulla.
3. Nuovo sticker con ricerca + 3 tocchi (miniatura > arma > Salva).
4. Tasto indietro di Android: da Anteprima torna a Crea con la ricerca/scheda/posizione di prima; in Sfoglia, dalla fazione torna all'elenco delle fazioni.
5. Stella in Anteprima: compare tra i Preferiti; un'arma con piu' miniature chiede con quale.
6. Altro > "Elimina dati di prova": spariscono gioco, recenti e preferiti di prova; con i tuoi dati veri tutto resta.

Elenco originale del passo:

- js/search.js: indice in memoria costruito all'avvio e aggiornato a ogni modifica del db. Nomi normalizzati (minuscolo, senza accenti e punteggiatura); ogni parola digitata deve essere l'inizio di una parola del nome; filtrabile per gioco.
- Ricerca e chip del gioco attivo (settings.lastGameId; "Tutti"). Risultati raggruppati Miniature, Armi ("Bolt rifle · Intercessor Warrior"), Azioni; max 8 per gruppo.
- Quattro schede: Recenti (renderSticker, cache in memoria), Preferiti (fav=1 e settings.favCombos), Azioni (griglia), Sfoglia (fazioni > griglia miniature con immagine).
- Tocco su miniatura: pannello con armi e "Solo miniatura"; arma → Anteprima (se più miniature, chiede quale). Tocco su recente: Anteprima; tocco lungo 500 ms con vibrazione breve: salva subito con lo stesso template, toast "Salvato".
- In Anteprima stella per le combinazioni preferite.
- Temporaneo in Altro: "Genera 300 elementi di prova" e "Elimina dati di prova".

Verifica: recente salvato con 1 tocco lungo; nuovo con ricerca + 3 tocchi; con 300 elementi nessun ritardo percepibile.

### Passo 8 – Azioni (FATTO, da provare sul telefono)

Realizzato (23/11/2026, CACHE_VERSION 'v13'). Decisioni e dettagli:

- Righe `actions`: `{ gameId|null, name, label|null, mode: 'generated'|'png', imageId|null, accentColor, fav, lastUsed }`. Senza `mode` (create prima del Passo 8) = 'generated'. `label` = testo a schermo facoltativo (se vuoto lo sticker scrive il nome; `actionText()` in js/stickerinput.js). `imageId` = icona (generated) oppure il PNG (png); immagini `kind: 'action'` con miniatura 96 px. Schema Dexie invariato.
- `gameId` null = valida per tutti i giochi. IndexedDB non lo indicizza: `D.listActions(gameId, {includeGlobal = true})` unisce le righe del gioco e le globali (filtro sull'intera tabella); `includeGlobal: false` = solo quelle del gioco (usato dalla Libreria); `listGlobalActions()`; `listActions(null)` = globali. `deleteGame` cancella solo le azioni del gioco (e le loro immagini), le globali restano. Search e Crea leggono tutta la tabella e filtrano per gioco con `gameId == null` valido ovunque (riga ricerca: "Tutti i giochi").
- Azioni 'png': Blob salvato con `file.slice(0, size, 'image/png')` (stessi byte, nessuna ricompressione; si controlla solo la firma PNG e si leggono le misure). `getStickerSource` restituisce `actionImage`; `renderStickerFor(src, tpl)` (stickerinput.js) restituisce il Blob originale per le azioni png, altrimenti `renderSticker`. Anteprima: niente chip template, niente campo testo, preview del file originale; Salva e Condividi esportano il Blob originale (nome `BR_<nome>_<data>.png`). Recenti e preferiti di azioni png hanno `templateId` null. Crea (miniature, Recenti, Preferiti, tocco lungo) usa lo stesso percorso; la firma della cache comprende mode, label, imageId.
- Azioni 'generated': template di tipo action; l'icona, se esiste, usa lo slot `image` del template ed e' sempre mostrata di default (interruttore "Icona azione" in Anteprima, identico alle miniature di Crea). DECISIONE (23/11/2026, Vando): piu' personalizzazione e' meglio, si aggiunge e non si toglie. Al Passo 9 l'editor template deve AGGIUNGERE un controllo per l'icona/immagine dell'azione (mostra/nascondi, lato, altezza, raggio, bordo) senza togliere l'interruttore in Anteprima: il template decide il valore di partenza, l'interruttore resta per spegnerla o riaccenderla sul singolo sticker; Anteprima e Crea (miniature, tocco lungo) devono partire dallo stesso valore e i template predefiniti non devono cambiare aspetto.
- Libreria (js/screens/azioni.js, `actionsSections(ctx, h, game)`): in ogni gioco sezione Azioni (+ per "Nuova azione", pulsante "Importa PNG", elenco con miniatura) e sezione "Azioni valide per tutti i giochi" (stessi comandi); la sezione globale compare anche nella schermata dei giochi, cosi' resta raggiungibile. Menu ⋮: Rinomina, Preferito, Anteprima sticker, Elimina; per png "Sostituisci PNG"; per generated "Modifica testo, colore, icona…"; "Valida per tutti i giochi" / "Limita a <gioco>". Importa PNG: nome dal file (`nameFromFile`: reposition.png -> Reposition, pick_up_marker.png -> Pick Up Marker); nome gia' presente nello stesso ambito -> conferma "Sostituisci" (tiene id, preferito, recenti) oppure Annulla (salta e importa solo le nuove); file non PNG o doppioni nella selezione elencati a fine import. Nomi doppi nello stesso ambito rifiutati in creazione, rinomina e spostamento.
- Una volta sola (`settings.seededActions`): le 8 azioni di Kill Team (Reposition, Dash, Fall Back, Charge, Shoot, Fight, Pick Up Marker, Place Marker) generate, senza duplicare nomi gia' presenti nel gioco o tra le globali; se il gioco "Kill Team" non c'e' non si crea nulla. Cancellate non tornano.
- Nuovi file: js/actionfiles.js (parti pure), js/screens/azioni.js (in sw.js). `deleteAction` elimina anche l'immagine.
- Non fatto (fuori dal Passo): scelta del template per le azioni generate gia' nell'elenco (si sceglie in Anteprima), ritaglio dell'icona (si riduce solo a 512 px max).

VERIFICA SUL TELEFONO (Passo 8):
1. Libreria > Kill Team: ci sono le 8 azioni Kill Team. "Importa PNG" con 2-3 PNG che hai gia': nomi giusti, miniature visibili; stesso nome di un'azione esistente chiede se sostituire.
2. Tocca un'azione PNG (menu ⋮ > Anteprima sticker): vedi il tuo file; Salva: in Download il file ha gli stessi KB dell'originale; in InShot la trasparenza c'e'.
3. Crea > Azioni e Recenti: le azioni PNG compaiono con la loro immagine; tocco lungo su un recente PNG salva subito.
4. "+" Nuova azione con testo a schermo, colore e un'icona: l'Anteprima mostra icona e testo; l'interruttore "Icona azione" funziona.
5. Azioni "valide per tutti i giochi": una creata li' compare in ogni gioco, nella ricerca e nella scheda Azioni di Crea con qualunque gioco attivo.

Piano originale del passo (parte base gia' fatta nei Passi precedenti):

- In Libreria, dentro ogni gioco, voce "Azioni" con elenco e anteprima.
- "Importa PNG": input multiplo accept="image/png"; ogni file diventa un'azione mode 'png', nome dal file (reposition.png → Reposition, pick_up_marker.png → Pick Up Marker), Blob senza ricompressione; Salva e Condividi esportano il file originale identico.
- "Nuova azione": nome, testo a schermo, icona facoltativa (immagini kind 'action' o PNG), template di tipo action → mode 'generated'.
- Opzione "Valida per tutti i giochi" (gameId null; vedi attenzione sull'indice).
- Una volta sola (settings.seededActions) azioni generate di Kill Team: Reposition, Dash, Fall Back, Charge, Shoot, Fight, Pick Up Marker, Place Marker.
- Le azioni compaiono in ricerca, scheda Azioni di Crea, recenti e preferiti.

Verifica: un PNG già esistente esce identico (stessi KB); le azioni generate hanno lo stile del template Azione.

### Passo 9 – Editor dei template e font

- Schermata Template: elenco per tipo con Duplica, Rinomina, Elimina (non l'ultimo del tipo), Imposta predefinito.
- Editor: anteprima fissa in alto (40% dello schermo) su scacchi con i dati dell'ultimo recente o "Intercessor Sergeant" / "Bolt rifle". Gruppi a fisarmonica: Dimensioni (larghezza 540-2160, padding, taglio margini), Targa, Immagine (lato sinistra/destra/sopra, altezza, raggio, bordo), Righe di testo (aggiungi/rimuovi/ordina; origine, font, dimensione, minima, colore, contorno, ombra, maiuscolo, allineamento), Immagine arma (mostra, sotto o a destra, altezza massima). Colori con `<input type="color">`. Ridisegno al massimo una volta per frame, salvataggio automatico.
- "Importa font" (.ttf, .otf, .woff2): salva in fonts, registra con FontFace a ogni avvio, compare nei menu dei font.

Verifica: modifiche dopo il riavvio; font importato nel PNG anche offline; PNG esportato uguale all'anteprima.

### Passo 10 – Backup e ripristino

- vendor/jszip.min.js (JSZip 3), js/backup.js e sezione Backup in Altro. "Esporta backup": ZIP con data.json {app:'sticker-br', schemaVersion, exportedAt, tables:{...}}, Blob sostituiti da images/<id>.png, cards/<id>.jpg, fonts/<id>.<ext> più i file. Le carte non vengono salvate (vedi Passo 5), quindi nessun interruttore "Includi carte originali". Nome BR_backup_AAAAMMGG.zip, Salva e Condividi. Salva settings.lastBackupAt.
- "Ripristina": scegli lo .zip, controlla app e schemaVersion, riepilogo (giochi, fazioni, miniature, armi, azioni, immagini, template), conferma "Sostituisce tutti i dati attuali". Prima scarica in automatico un backup dei dati attuali, poi svuota e reimporta mantenendo gli id in una sola transazione. File non valido: errore e nessun dato toccato. Dopo il ripristino ricarica indice di ricerca e font.
- In Crea avviso discreto se l'ultimo backup ha più di 14 giorni e ci sono modifiche successive.

Verifica: esporti, cancelli i dati del sito da Chrome, ripristini: tutto identico, immagini e font compresi; un file sbagliato dà errore senza cancellare nulla.

### Passo 11 – Rifiniture

- Coda: in Anteprima "Aggiungi alla coda"; icona coda con contatore in Crea; in Altro "Salva tutti" (download in sequenza ogni 400 ms), "Condividi tutti" (una sola navigator.share con più file), "Svuota coda".
- Cartella dedicata: solo se 'showDirectoryPicker' in window; handle in settings, queryPermission/requestPermission, createWritable; se qualcosa fallisce ripiega sul download e lo dice; altrimenti nascondi l'opzione.
- Altro: spazio usato (navigator.storage.estimate), stato della memoria persistente, versione dell'app.
- Rimuovi il test di esportazione e il generatore di dati di prova.
- Rivedi i testi in italiano, stati vuoti con istruzioni, aree di tocco, contrasti del tema scuro.
- Controlla che sw.js contenga tutti i file e incrementa CACHE_VERSION.

Verifica: prova completa offline (importa una carta, ritaglia, genera 5 sticker, mettili in un video InShot); la coda salva tutti i file; con la cartella dedicata i file compaiono nel selettore di InShot, altrimenti restare su Download; Altro mostra "Memoria persistente: sì".
