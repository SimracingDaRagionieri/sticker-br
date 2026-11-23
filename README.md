# Sticker Battle Report

PWA per Android/Chrome che genera sticker PNG trasparenti per i battle report in InShot.
HTML + CSS + JavaScript a moduli, nessuna build, nessun CDN.

## Pubblicare su GitHub Pages (gratis, HTTPS)

1. Crea un account su github.com e un nuovo repository pubblico, ad esempio `sticker-br`.
2. Carica **il contenuto** di questa cartella nella radice del repository (`index.html` deve stare in cima, non dentro una sottocartella). Dal sito: *Add file → Upload files*, trascina tutto, *Commit changes*.
3. Vai su *Settings → Pages*. In *Build and deployment* scegli *Deploy from a branch*, branch `main`, cartella `/ (root)`, poi *Save*.
4. Dopo 1-2 minuti l'app è su `https://<tuo-utente>.github.io/sticker-br/`.
5. Apri l'indirizzo con Chrome su Android: menu ⋮ → *Installa app*.

## Aggiornare l'app

A ogni modifica ai file incrementa `CACHE_VERSION` in `sw.js`. All'apertura successiva compare la barra "Nuova versione disponibile - Aggiorna".

## Test del passo 1

- L'app si installa e si apre a schermo intero.
- In modalità aereo si apre e cambia schermata.
- Altro → "Salva PNG di prova" mette il file in Download e compare nel selettore foto.
- In InShot: Sticker → personalizzato: il PNG si vede sopra il video con sfondo trasparente.
