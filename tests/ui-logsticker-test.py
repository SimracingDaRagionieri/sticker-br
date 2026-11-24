#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 11 (Sticker dal log e coda) in Chrome headless (Playwright), con service worker bloccato.

  python3 tests/ui-logsticker-test.py [cartella_screenshot]

Controlla: db v4 e tabella queue, template "Risultato" creato una volta sola (gli altri template restano identici),
editor dei template con le nuove origini, "Crea sticker" da una voce del log (Anteprima con i dati del log, testi
modificabili, nessuna stella, nessun recente, nome file BR_<partita>_<nnn>_...), "Aggiungi alla coda" (anche dal percorso
della Libreria), "Genera sticker della partita" (spunte per tipo, ordine e nomi file, rigenerare non duplica, interruzione),
riferimenti eliminati, azione PNG identica, schermata e icona della coda, Salva tutti a 400 ms, Condividi tutti,
Svuota coda, persistenza dopo il ricaricamento.
"""
import hashlib
import http.server
import os
import re
import socketserver
import struct
import sys
import threading
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots-logsticker'
os.makedirs(SHOTS, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Srv(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


srv = Srv(('127.0.0.1', 0), Quiet)
BASE = f'http://127.0.0.1:{srv.server_address[1]}/'
threading.Thread(target=srv.serve_forever, daemon=True).start()

fails = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


def js(page, code, arg=None):
    return page.evaluate("async (arg) => { const m = await import('./js/db.js'); await m.ready(); return await (" + code + ")(m, arg); }", arg)


def png_info(data):
    ok = data[:8] == b'\x89PNG\r\n\x1a\n'
    w, h = struct.unpack('>II', data[16:24]) if ok else (0, 0)
    return ok, w, h


def new_page(ctx):
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.errors = errors
    return page


def sheet_wait(page):
    page.wait_for_selector('.sheet', state='visible')


def sheet_gone(page):
    page.wait_for_selector('.sheet-backdrop', state='detached')


def menu_item(page, label):
    sheet_wait(page)
    page.locator('.sheet-menu button', has_text=label).first.click()


QUEUE_JS = """async (m) => {
  const rows = await m.queueList();
  const out = [];
  for (const r of rows) {
    const b = new Uint8Array(await r.blob.arrayBuffer());
    const dv = new DataView(b.buffer);
    const sig = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
    out.push({ id: r.id, key: r.key, name: r.name, label: r.label, size: b.length, sig, w: sig ? dv.getUint32(16) : 0, h: sig ? dv.getUint32(20) : 0, sha: h });
  }
  return out;
}"""


def queue(page):
    return js(page, QUEUE_JS)


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    page = new_page(ctx)
    page.goto(BASE + '#/libreria')
    page.wait_for_selector('h1')

    print('1) database v4, tabella queue e template "Risultato" creato una volta sola')
    info = js(page, """async (m) => ({
      verno: m.db.verno, tables: m.db.tables.map((t) => t.name),
      tpls: (await m.db.templates.toArray()).map((t) => [t.id, t.name, t.kind]),
      defs: await m.getSetting('defaultTemplates'), seeded: await m.getSetting('seededResultTemplate'), rev: await m.getSetting('templatesRev'),
      kinds: m.TEMPLATE_KINDS, queueIdx: m.db.queue.schema.idxByName['key'] ? m.db.queue.schema.idxByName['key'].unique : null
    })""")
    check(info['verno'] == 4, f'versione schema {info["verno"]} (attesa 4)')
    check('queue' in info['tables'] and all(t in info['tables'] for t in ['matches', 'matchEvents', 'rules', 'fonts', 'templates']), 'tabella queue e tutte le precedenti')
    check(info['queueIdx'] is True, 'queue.key e\' un indice unico')
    check(info['kinds'] == ['activation', 'action', 'result'], f'tipi di template {info["kinds"]}')
    kinds = sorted(t[2] for t in info['tpls'])
    check(kinds == ['action', 'activation', 'activation', 'result'], f'template: {info["tpls"]}')
    rid = next(t[0] for t in info['tpls'] if t[2] == 'result')
    check(info['defs'].get('result') == rid and info['seeded'] == 1 and info['rev'] == 3, f'predefinito result = {rid}, seededResultTemplate = 1, templatesRev = 3 invariato')

    others_before = js(page, "async (m) => JSON.stringify((await m.db.templates.toArray()).filter((t) => t.kind !== 'result').map((t) => [t.id, t.name, t.config]))")
    defs_before = js(page, "async (m) => JSON.stringify(await m.getSetting('defaultTemplates'))")
    js(page, "async (m) => { await m.db.templates.where('kind').equals('result').delete(); await m.db.settings.delete('seededResultTemplate'); const d = await m.getSetting('defaultTemplates'); delete d.result; await m.setSetting('defaultTemplates', d); }")
    page.reload()
    page.wait_for_selector('h1')
    r2 = js(page, "async (m) => ({ n: await m.db.templates.where('kind').equals('result').count(), seeded: await m.getSetting('seededResultTemplate'), defs: await m.getSetting('defaultTemplates') })")
    check(r2['n'] == 1 and r2['seeded'] == 1 and r2['defs'].get('result') is not None, 'creato di nuovo una volta sola dopo aver tolto il segno (migrazione per chi ha gia\' i template)')
    page.reload()
    page.wait_for_selector('h1')
    check(js(page, "async (m) => m.db.templates.where('kind').equals('result').count()") == 1, 'dopo un altro avvio resta uno solo')
    others_after = js(page, "async (m) => JSON.stringify((await m.db.templates.toArray()).filter((t) => t.kind !== 'result').map((t) => [t.id, t.name, t.config]))")
    check(others_before == others_after, 'gli altri template sono identici byte per byte (nessun cambio di aspetto)')
    rid = js(page, "async (m) => (await m.getDefaultTemplate('result')).id")
    defs_after = js(page, "async (m) => { const d = await m.getSetting('defaultTemplates'); delete d.result; return JSON.stringify(d); }")
    d_before = __import__('json').loads(defs_before); d_before.pop('result', None)
    check(__import__('json').dumps(d_before, sort_keys=True) == __import__('json').dumps(__import__('json').loads(defs_after), sort_keys=True), 'predefiniti di Attivazione e Azione invariati')

    print('2) elenco template e editor con le nuove origini')
    page.goto(BASE + '#/template')
    page.wait_for_selector('.list[data-kind="result"] .item')
    check(page.locator('h2', has_text='Risultato').count() == 1, 'sezione "Risultato" nell\'elenco')
    check(page.locator('.list[data-kind="result"] .item').count() == 1, 'un template Risultato')
    cfg0 = js(page, "async (m, id) => JSON.stringify((await m.getTemplate(id)).config)", rid)
    page.goto(BASE + f'#/template?id={rid}')
    page.wait_for_function("(() => { const i = document.querySelector('#pv-img'); return i && !i.hidden && i.naturalWidth > 0; })()")
    page.wait_for_timeout(900)
    check(js(page, "async (m, id) => JSON.stringify((await m.getTemplate(id)).config)", rid) == cfg0, 'aprire l\'editor non riscrive il template')
    groups = page.locator('.tpl-group > summary').all_inner_texts()
    check(groups == ['Dimensioni', 'Targa di sfondo', 'Immagine bersaglio', 'Righe di testo', 'Immagine arma usata'], f'gruppi: {groups}')
    page.locator('.tpl-group[data-group="lines"] > summary').click()
    opts = page.locator('select[data-p="lines.0.source"] option').evaluate_all('o => o.map((x) => x.value)')
    check(all(s in opts for s in ['target', 'damage', 'woundsLeft', 'damageLeft', 'status', 'unit', 'weapon', 'text']), f'origini della riga: {opts}')
    h_before = page.evaluate("document.querySelector('#pv-img').naturalHeight")
    src_before = page.evaluate("document.querySelector('#pv-img').src")
    page.locator('select[data-p="lines.0.source"]').select_option('damage')
    page.wait_for_function("(s) => document.querySelector('#pv-img').src !== s", arg=src_before)
    page.wait_for_timeout(700)
    check(js(page, "async (m, id) => (await m.getTemplate(id)).config.lines[0].source", rid) == 'damage', 'cambio di origine salvato nel template')
    page.screenshot(path=f'{SHOTS}/01-editor-risultato.png')
    page.goto(BASE + '#/template')  # si esce dall'editor (salva e chiude), poi si rimette la config di partenza
    page.wait_for_selector('.list[data-kind="result"] .item')
    js(page, "async (m, a) => { await m.setTemplateConfig(a.id, JSON.parse(a.cfg)); }", {'id': rid, 'cfg': cfg0})
    check(js(page, "async (m, id) => (await m.getTemplate(id)).config.lines[0].source", rid) == 'target', 'config ripristinata')
    # una nuova riga di un template Risultato parte da "Danni e ferite rimaste"
    page.goto(BASE + f'#/template?id={rid}')
    page.wait_for_selector('.tpl-group[data-group="lines"]')
    page.evaluate("document.querySelector('.tpl-group[data-group=lines]').open = true")
    page.locator('[data-line-add]').click()
    page.wait_for_timeout(700)
    cfgn = js(page, "async (m, id) => (await m.getTemplate(id)).config.lines.map((l) => l.source)", rid)
    check(cfgn == ['target', 'damageLeft', 'status', 'damageLeft'], f'nuova riga: {cfgn}')
    page.goto(BASE + '#/template')
    page.wait_for_selector('.list[data-kind="result"] .item')
    js(page, "async (m, a) => { await m.setTemplateConfig(a.id, JSON.parse(a.cfg)); }", {'id': rid, 'cfg': cfg0})

    print('3) dati di prova: due squadre con immagini, partita di 2 attivazioni, danni, incapacitato, punti, azione PNG')
    ids = js(page, """async (m) => {
      const mk = (w, h, c, noise) => new Promise((r) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d');
        x.fillStyle = c; x.fillRect(0, 0, w, h); if (noise) for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 9} 60% 50%)`; x.fillRect(i * 3, (i * 7) % h, 20, 9); } cv.toBlob(r, 'image/png'); });
      const kt = (await m.db.games.toArray()).find((g) => g.name === 'Kill Team');
      const fa = await m.addFaction(kt.id, 'Exaction Squad'), fb = await m.addFaction(kt.id, 'Foes');
      const uSgt = await m.addUnit(fa, 'Sergeant'), uBoss = await m.addUnit(fb, 'Boss');
      await m.setUnitImage(uSgt, await mk(300, 300, '#2a7', 1), 300, 300, null);
      await m.setUnitImage(uBoss, await mk(300, 300, '#a33', 1), 300, 300, null);
      const wBolt = await m.addWeapon({ factionId: fa, unitId: uSgt, name: 'Bolt rifle', kind: 'ranged' });
      const wSword = await m.addWeapon({ factionId: fa, unitId: uSgt, name: 'Chainsword', kind: 'melee' });
      const wClaw = await m.addWeapon({ factionId: fb, unitId: uBoss, name: 'Power claw', kind: 'melee' });
      for (const w of [wBolt, wSword, wClaw]) await m.setWeaponImage(w, await mk(900, 160, '#335', 1), 900, 160, null);
      const acts = await m.listActions(kt.id);
      const shoot = acts.find((a) => a.name === 'Shoot').id, fight = acts.find((a) => a.name === 'Fight').id;
      const pngBlob = await mk(240, 120, '#c80', 1);
      const sig = await m.addAction(kt.id, 'Signal', null, { mode: 'png', image: { blob: pngBlob, width: 240, height: 120 } });
      const hash = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(await b.arrayBuffer())))].map((x) => x.toString(16).padStart(2, '0')).join('');
      const pngHash = await hash(pngBlob);
      const mid = await m.createMatch({ gameId: kt.id, name: 'Prova Sticker', sides: [{ player: 'Vando', factionId: fa, factionName: 'Exaction Squad' }, { player: 'Manu', factionId: fb, factionName: 'Foes' }] });
      const mSgt = await m.addMatchUnit(mid, { side: 0, unitId: uSgt, name: 'Sergeant', maxWounds: 10 });
      const mBoss = await m.addMatchUnit(mid, { side: 1, unitId: uBoss, name: 'Boss', maxWounds: 12 });
      const mFree = await m.addMatchUnit(mid, { side: 1, unitId: null, name: 'Grunt', maxWounds: null });
      const add = (ev) => m.addMatchEvent(mid, ev);
      const ev = {};
      ev.t1 = await add({ type: 'turn-start', data: { initiative: { side: 1, how: 'roll', rolls: [3, 5] } } });
      ev.a1 = await add({ type: 'activation', unitRef: mBoss });
      ev.x1 = await add({ type: 'action', unitRef: mBoss, actionId: shoot, data: { actionName: 'Shoot', source: ev.a1 } });
      ev.k1 = await add({ type: 'attack', unitRef: mBoss, targetRef: mSgt, weaponId: wClaw, data: { weaponName: 'Power claw', source: ev.x1 } });
      ev.d1 = await add({ type: 'damage', unitRef: mBoss, targetRef: mSgt, data: { amount: 4, source: ev.k1 } });
      ev.a2 = await add({ type: 'activation', unitRef: mSgt });
      ev.x2 = await add({ type: 'action', unitRef: mSgt, actionId: fight, data: { actionName: 'Fight', source: ev.a2 } });
      ev.k2 = await add({ type: 'attack', unitRef: mSgt, targetRef: mBoss, weaponId: wSword, data: { weaponName: 'Chainsword', source: ev.x2 } });
      ev.d2 = await add({ type: 'damage', unitRef: mSgt, targetRef: mBoss, data: { amount: 12, source: ev.k2 } });
      ev.i2 = await add({ type: 'incapacitated', unitRef: mBoss, data: { source: ev.d2 } });
      ev.x3 = await add({ type: 'action', unitRef: mSgt, actionId: sig, data: { actionName: 'Signal', source: ev.a2 } });
      ev.x4 = await add({ type: 'action', unitRef: mSgt, actionId: null, data: { actionName: 'Altra mossa', source: ev.a2 } });
      ev.sc = await add({ type: 'score', side: 0, data: { points: 2, reason: 'Recover Cargo' } });
      ev.d3 = await add({ type: 'damage', unitRef: mSgt, targetRef: mFree, data: { amount: 2 } });
      return { kt: kt.id, fa, fb, uSgt, uBoss, wBolt, wSword, wClaw, shoot, fight, sig, mid, mSgt, mBoss, mFree, ev, pngHash };
    }""")
    mid, ev = ids['mid'], ids['ev']
    st = js(page, """async (m, id) => { const s = await m.getMatchState(id); return { n: s.events.length, left: Object.fromEntries([...s.rep.units.values()].map((u) => [u.name, u.left])), seq: Object.fromEntries(s.events.map((e) => [e.id, e.seq])) }; }""", mid)
    check(st['left'] == {'Sergeant': 6, 'Boss': 0, 'Grunt': None}, f'ferite rimaste dal replay: {st["left"]}')
    seq = {int(k): v for k, v in st['seq'].items()}
    recents0 = js(page, "async (m) => ({ r: await m.db.recents.count(), fav: JSON.stringify(await m.getSetting('favCombos')), uses: (await m.db.units.toArray()).map((u) => [u.id, u.useCount || 0, u.lastUsed || 0]) })")

    print('4) "Crea sticker" da una voce del log (danno al Sergeant: -4, rimangono 6)')
    page.goto(BASE + f'#/log?m={mid}&v=cron')
    page.wait_for_selector('.lg-ev')
    idx_d1 = js(page, "async (m, a) => (await m.listMatchEvents(a.mid)).findIndex((e) => e.id === a.id)", {'mid': mid, 'id': ev['d1']})
    check(page.locator('[data-q-btn]').count() == 1 and page.locator('[data-q-count]').first.is_hidden(), 'icona della coda nella partita, contatore nascosto a coda vuota')
    page.locator(f'[data-ev="{idx_d1}"]').click()
    sheet_wait(page)
    labels = page.locator('.sheet-menu button').all_inner_texts()
    check(labels[0] == 'Crea sticker' and 'Modifica' in labels and 'Elimina' in labels, f'menu della voce: {labels}')
    page.locator('.sheet-cancel').click()
    sheet_gone(page)
    idx_t1 = js(page, "async (m, a) => (await m.listMatchEvents(a.mid)).findIndex((e) => e.id === a.id)", {'mid': mid, 'id': ev['t1']})
    page.locator(f'[data-ev="{idx_t1}"]').click()
    sheet_wait(page)
    check('Crea sticker' not in page.locator('.sheet-menu button').all_inner_texts(), 'inizio turno: nessuno sticker')
    page.locator('.sheet-cancel').click()
    sheet_gone(page)
    page.locator(f'[data-ev="{idx_d1}"]').click()
    menu_item(page, 'Crea sticker')
    page.wait_for_selector('#pv-img:not([hidden])')
    page.wait_for_function("document.querySelector('#pv-img').naturalWidth > 0")
    check(f'match={mid}' in page.url and f'ev={ev["d1"]}' in page.url, f'indirizzo: {page.url.split("#")[1]}')
    check(page.locator('[data-fav]').count() == 0, 'nessuna stella per gli sticker dal log')
    check(page.locator('h1').inner_text() == 'Anteprima sticker' and 'voce' in page.locator('.pv-ctx').inner_text(), 'Anteprima con contesto: ' + page.locator('.pv-ctx').inner_text())
    chips = page.locator('[data-tpl]').all_inner_texts()
    check(chips == ['Risultato'], f'template offerti: {chips}')
    vals = {k: page.locator(f'[data-text="{k}"]').input_value() for k in ['target', 'damage', 'woundsLeft', 'status', 'unit', 'weapon']}
    check(vals == {'target': 'Sergeant', 'damage': '-4', 'woundsLeft': 'rimangono 6', 'status': '', 'unit': 'Boss', 'weapon': 'Power claw'}, f'campi con i dati del log: {vals}')
    check(page.locator('[data-toggle="unit"]').is_checked() and not page.locator('[data-toggle="weapon"]').is_checked(), 'immagine bersaglio accesa (template), immagine arma spenta')
    check('bersaglio' in page.locator('[data-toggle="unit"]').locator('xpath=..').inner_text(), 'etichetta "Immagine bersaglio"')
    h_def = page.evaluate("document.querySelector('#pv-img').naturalHeight")
    w_def = page.evaluate("document.querySelector('#pv-img').naturalWidth")
    check(w_def == 1080, f'sticker largo 1080 px ({w_def})')
    page.screenshot(path=f'{SHOTS}/02-anteprima-risultato.png', full_page=True)
    # testi modificabili solo per questo sticker: con "INCAPACITATO" si aggiunge una riga e lo sticker diventa piu' alto
    src0 = page.evaluate("document.querySelector('#pv-img').src")
    page.locator('[data-text="status"]').fill('INCAPACITATO')
    page.locator('[data-text="damage"]').fill('-5')
    page.wait_for_function("(s) => document.querySelector('#pv-img').src !== s", arg=src0)
    page.wait_for_timeout(300)
    h_inc = page.evaluate("document.querySelector('#pv-img').naturalHeight")
    check(h_inc > h_def, f'con la riga INCAPACITATO lo sticker e\' piu\' alto ({h_def} -> {h_inc})')
    page.locator('[data-toggle="unit"]').uncheck()
    page.wait_for_timeout(400)
    page.locator('[data-toggle="unit"]').check()
    page.wait_for_timeout(400)
    # salva: nome file in ordine di log e nessun recente
    with page.expect_download() as dl:
        page.locator('[data-save]').click()
    d = dl.value
    check(d.suggested_filename == f'BR_Prova-Sticker_{seq[ev["d1"]]:03d}_Sergeant_dmg4.png', f'nome file {d.suggested_filename}')
    ok, w, h = png_info(open(d.path(), 'rb').read())
    check(ok and w == 1080 and h == h_inc, f'PNG salvato = anteprima ({w}x{h})')
    page.wait_for_timeout(900)
    recents1 = js(page, "async (m) => ({ r: await m.db.recents.count(), fav: JSON.stringify(await m.getSetting('favCombos')), uses: (await m.db.units.toArray()).map((u) => [u.id, u.useCount || 0, u.lastUsed || 0]) })")
    check(recents1 == recents0, 'Salva dal log non tocca recenti, preferiti, useCount e lastUsed')

    print('5) Aggiungi alla coda (dal log e dalla Libreria)')
    check(queue(page) == [], 'coda vuota all\'inizio')
    page.locator('[data-queue]').click()
    page.wait_for_function("document.querySelector('[data-q-count]') && !document.querySelector('[data-q-count]').hidden")
    check(page.locator('[data-q-count]').first.inner_text() == '1', 'icona con contatore: 1')
    q = queue(page)
    check(len(q) == 1 and q[0]['key'] == f'm{mid}-e{ev["d1"]}' and q[0]['name'] == d.suggested_filename and q[0]['sig'], f'riga in coda: {q[0]["key"]} {q[0]["name"]}')
    check(q[0]['h'] == h_inc and q[0]['w'] == 1080, 'in coda c\'e\' il PNG che si vede (testi modificati compresi)')
    check('1.' not in q[0]['label'] and str(seq[ev['d1']]) in q[0]['label'] and 'Sergeant' in q[0]['label'], f'etichetta: {q[0]["label"]}')
    page.wait_for_timeout(800)
    page.locator('[data-queue]').click()
    page.wait_for_timeout(900)
    check(len(queue(page)) == 1, 'rigiungere lo stesso sticker lo sostituisce, non lo duplica')
    check(page.locator('[data-q-count]').first.inner_text() == '1', 'contatore ancora 1')
    # percorso della Libreria: invariato (stella, recenti), con coda
    page.goto(BASE + f'#/anteprima?unit={ids["uSgt"]}&weapon={ids["wBolt"]}')
    page.wait_for_selector('#pv-img:not([hidden])')
    check(page.locator('[data-fav]').count() == 1, 'Anteprima della Libreria: stella presente')
    check(page.locator('[data-q-count]').first.inner_text() == '1', 'contatore anche qui')
    page.locator('[data-queue]').click()
    page.wait_for_function("document.querySelector('[data-q-count]').innerText === '2'")
    q = queue(page)
    check(len(q) == 2 and re.match(r'^BR_Sergeant_Bolt-rifle_\d{8}-\d{6}\.png$', q[1]['name']), f'sticker della Libreria in coda: {q[1]["name"]}')
    check(js(page, "async (m) => m.db.recents.count()") == recents0['r'], 'Aggiungi alla coda non e\' un uso: nessun recente')
    page.wait_for_timeout(800)
    with page.expect_download():
        page.locator('[data-save]').click()
    page.wait_for_timeout(900)
    check(js(page, "async (m) => m.db.recents.count()") == recents0['r'] + 1, 'Salva dalla Libreria continua a creare il recente')

    print('6) Genera sticker della partita dal menu (solo risultati; poi tutti i tipi)')
    page.goto(BASE + f'#/log?m={mid}&v=cron')
    page.wait_for_selector('.lg-ev')
    page.locator('[data-act="match-menu"]').click()
    menu_item(page, 'Genera sticker della partita')
    sheet_wait(page)
    lab = page.locator('.sheet .check span').all_inner_texts()
    check(lab == ['Attivazioni (2)', 'Azioni (4)', 'Risultati (3)', 'Punti (1)'], f'spunte con i numeri: {lab}')
    check(all(page.locator('.sheet .check input').nth(i).is_checked() for i in range(4)), 'tutte spuntate in partenza')
    for t in ['activation', 'action', 'score']:
        page.locator(f'.sheet input[value="{t}"]').uncheck()
    page.locator('.sheet button[type=submit]').click()
    page.wait_for_selector('.sheet-title:has-text("in coda")')
    check('3 sticker in coda' in page.locator('.sheet-title').inner_text(), 'esito: ' + page.locator('.sheet-title').inner_text())
    page.screenshot(path=f'{SHOTS}/03-genera-esito.png')
    page.locator('.sheet [data-close]').click()
    sheet_gone(page)
    q = queue(page)
    names = [x['name'] for x in q]
    check(len(q) == 4, f'coda: 1 (Libreria) + 3 risultati, quello gia\' presente sostituito e non duplicato ({len(q)})')
    check(names[0].startswith('BR_Sergeant_Bolt-rifle_') and names[1:] == [
        f'BR_Prova-Sticker_{seq[ev["d1"]]:03d}_Sergeant_dmg4.png', f'BR_Prova-Sticker_{seq[ev["d2"]]:03d}_Boss_dmg12.png', f'BR_Prova-Sticker_{seq[ev["d3"]]:03d}_Grunt_dmg2.png'],
        f'risultati nell\'ordine del log: {names}')
    byseq = {x['name']: x for x in q}
    inc = byseq[f'BR_Prova-Sticker_{seq[ev["d2"]]:03d}_Boss_dmg12.png']
    nor = byseq[f'BR_Prova-Sticker_{seq[ev["d1"]]:03d}_Sergeant_dmg4.png']
    grunt = byseq[f'BR_Prova-Sticker_{seq[ev["d3"]]:03d}_Grunt_dmg2.png']
    check(nor['h'] != h_inc, 'quello rigenerato ha i testi del log, non quelli modificati a mano')
    check(inc['h'] > nor['h'], f'incapacitato (3 righe) piu\' alto del danno normale ({inc["h"]} > {nor["h"]})')
    check(all(x['sig'] and x['w'] == 1080 for x in q[1:]), 'PNG validi, larghi 1080')

    # tutti i tipi, dal menu
    js(page, "async (m) => { await m.queueClear(); }")
    page.locator('[data-act="match-menu"]').click()
    menu_item(page, 'Genera sticker della partita')
    sheet_wait(page)
    page.locator('.sheet button[type=submit]').click()
    page.wait_for_selector('.sheet-title:has-text("in coda")')
    check('10 sticker in coda' in page.locator('.sheet-title').inner_text(), 'tutti i tipi (2 attivazioni, 4 azioni, 3 risultati, 1 punteggio): ' + page.locator('.sheet-title').inner_text())
    page.locator('.sheet [data-open-queue]').click()
    page.wait_for_selector('.q-item')
    check(page.url.endswith('#/coda'), 'Apri la coda porta a #/coda')
    q = queue(page)
    seqs = [int(re.search(r'_(\d{3})_', x['name']).group(1)) for x in q]
    check(seqs == sorted(seqs) and len(set(seqs)) == len(seqs), 'ordine del log, tutti diversi')
    check(len(q) == 10, f'{len(q)} sticker in coda')
    types_expected = {seq[ev[k]] for k in ['a1', 'a2', 'x1', 'x2', 'x3', 'x4', 'd1', 'd2', 'd3', 'sc']}
    check(set(seqs) == types_expected, f'tutte e solo le voci con sticker: {sorted(types_expected)}')
    check(all(x['sig'] for x in q), 'tutti PNG validi')
    check(all(x['w'] <= 1080 and x['w'] >= 200 for x in q), f'larghezze: {sorted(set(x["w"] for x in q))}')
    page.wait_for_timeout(300)
    page.screenshot(path=f'{SHOTS}/04-coda.png', full_page=True)
    sig_item = next(x for x in q if f'_{seq[ev["x3"]]:03d}_' in x['name'])
    # Dal 24/11/2026: l'azione dal log esce in UN solo sticker, col nome della miniatura sopra (il PNG resta intatto sotto).
    check(sig_item['sha'] != ids['pngHash'] and sig_item['h'] > 120 and sig_item['w'] >= 240, f'azione PNG dal log: nome miniatura sopra il PNG ({sig_item["w"]}x{sig_item["h"]}, PNG originale 240x120)')
    x1_item = next(x for x in q if f'_{seq[ev["x1"]]:03d}_' in x['name'])
    check(x1_item['h'] > 0, 'azione disegnata dal log: PNG valido')
    # Anteprima: interruttore "nome sopra l'azione"; spento, il PNG esce identico al file importato
    page.goto(BASE + f'#/anteprima?match={mid}&ev={ev["x3"]}')
    page.wait_for_function("document.querySelector('#pv-img') && document.querySelector('#pv-img').naturalWidth > 0")
    check(page.locator('[data-toggle="name"]').is_checked() and page.locator('[data-text="unit"]').input_value() != '', 'Anteprima azione PNG: interruttore nome acceso e campo miniatura')
    h_on = page.evaluate("document.querySelector('#pv-img').naturalHeight")
    check(h_on == sig_item['h'], f'anteprima = sticker generato ({h_on})')
    src_n = page.evaluate("document.querySelector('#pv-img').src")
    page.locator('[data-toggle="name"]').uncheck()
    page.wait_for_function("(s) => document.querySelector('#pv-img').src !== s", arg=src_n)
    page.wait_for_timeout(300)
    check(page.evaluate("document.querySelector('#pv-img').naturalHeight") == 120, 'senza nome: il PNG originale (240x120)')
    with page.expect_download() as dl2:
        page.locator('[data-save]').click()
    import hashlib as _h
    check(_h.sha256(open(dl2.value.path(), 'rb').read()).hexdigest() == ids['pngHash'], 'senza nome sopra: stessi byte del PNG importato')
    score_item = next(x for x in q if '_punti_' in x['name'])
    check(score_item['name'].endswith('punti_Vando_pt2.png') and score_item['w'] == 1080, f'punti: {score_item["name"]}')

    print('7) rigenerare non duplica; interruzione; riferimenti eliminati')
    page.goto(BASE + f'#/log?m={mid}&v=cron')
    page.wait_for_selector('.lg-ev')
    n0 = len(q)
    page.locator('[data-act="match-menu"]').click()
    menu_item(page, 'Genera sticker della partita')
    sheet_wait(page)
    page.locator('.sheet button[type=submit]').click()
    page.wait_for_selector('.sheet-title:has-text("in coda")')
    page.locator('.sheet [data-close]').click()
    sheet_gone(page)
    q2 = queue(page)
    check(len(q2) == n0 and [x['name'] for x in q2] == [x['name'] for x in q], 'rigenerata la partita: stesso numero, stessi nomi, stesso ordine')
    r = page.evaluate("""async (mid) => { const L = await import('./js/logsource.js'); let c = 0; return await L.generateForMatch(mid, ['activation', 'action', 'result', 'score'], { shouldStop: () => c++ >= 1 }); }""", mid)
    check(r['done'] == 1 and r['stopped'] is True, f'interruzione: {r}')
    check(len(queue(page)) == n0, 'dopo l\'interruzione gli sticker gia\' in coda restano')
    # eliminazione di miniatura, arma, azione e immagini: il log resta, gli sticker si generano ancora (solo il nome)
    js(page, "async (m, a) => { await m.deleteUnit(a.u); await m.deleteWeapon(a.w); await m.deleteAction(a.s); await m.deleteAction(a.g); }", {'u': ids['uSgt'], 'w': ids['wClaw'], 's': ids['shoot'], 'g': ids['sig']})
    r = page.evaluate("""async (mid) => { const L = await import('./js/logsource.js'); return await L.generateForMatch(mid, ['activation', 'action', 'result', 'score']); }""", mid)
    check(r['failed'] == 0 and r['done'] == n0, f'con riferimenti eliminati: {r}')
    q3 = queue(page)
    check([x['name'] for x in q3] == [x['name'] for x in q], 'stessi nomi file con i riferimenti eliminati')
    check(all(x['sig'] for x in q3), 'PNG validi')
    sig3 = next(x for x in q3 if f'_{seq[ev["x3"]]:03d}_' in x['name'])
    check(sig3['sha'] != ids['pngHash'] and sig3['w'] > 0, 'azione PNG eliminata dalla Libreria: si disegna col nome copiato nel log')
    li = page.evaluate("""async (a) => { const L = await import('./js/logsource.js'); const r = await L.getLogItem(a.mid, a.id); return { target: r.item.targetName, unit: r.item.unitName, img: !!r.src.unitImage, wimg: !!r.src.weaponImage }; }""", {'mid': mid, 'id': ev['d1']})
    check(li == {'target': 'Sergeant', 'unit': 'Boss', 'img': False, 'wimg': False}, f'voce con miniatura e arma eliminate: {li}')
    # Anteprima di una voce con riferimenti eliminati
    page.goto(BASE + f'#/anteprima?match={mid}&ev={ev["d1"]}')
    page.wait_for_selector('#pv-img:not([hidden])')
    check(page.locator('[data-text="target"]').input_value() == 'Sergeant' and page.locator('[data-toggle="unit"]').is_disabled(), 'Anteprima con miniatura eliminata: nome dal log, immagine "non importata"')
    # voce inesistente
    page.goto(BASE + f'#/anteprima?match={mid}&ev=999999')
    page.wait_for_selector('.empty')
    check('non trovata' in page.locator('.empty').inner_text(), 'voce inesistente: messaggio, nessun errore')
    page.goto(BASE + '#/anteprima?match=99999&ev=1')
    page.wait_for_selector('.empty')
    check('non trovata' in page.locator('.empty').inner_text(), 'partita inesistente: messaggio')

    print('8) schermata e icona della coda, Salva tutti a 400 ms, Condividi tutti, Svuota, persistenza')
    page.goto(BASE + '#/coda')
    page.wait_for_selector('.q-item')
    n = len(queue(page))
    check(page.locator('.q-item').count() == n and page.locator('.q-thumb img').count() == n, f'{n} voci con miniatura')
    page.wait_for_function("[...document.querySelectorAll('.q-thumb img')].every((i) => i.complete && i.naturalWidth > 0)")
    check(page.locator('.q-item .q-txt b').first.inner_text().strip() != '', 'etichetta della prima voce: ' + page.locator('.q-item .q-txt b').first.inner_text())
    page.reload()
    page.wait_for_selector('.q-item')
    check(page.locator('.q-item').count() == n, 'la coda sopravvive al ricaricamento (IndexedDB)')
    # Un solo sticker: Salva e Condividi su ogni riga, senza toccare la coda
    check(page.locator('[data-q-one]').count() == n and page.locator('[data-q-one-share]').count() == n, 'Salva e Condividi su ogni riga')
    second = queue(page)[1]
    with page.expect_download() as dl1:
        page.locator('.q-item').nth(1).locator('[data-q-one]').click()
    check(dl1.value.suggested_filename == second['name'], f'Salva singolo: {dl1.value.suggested_filename}')
    check(open(dl1.value.path(), 'rb').read()[:8] == b'\x89PNG\r\n\x1a\n', 'file singolo = PNG valido')
    page.evaluate("() => { window.__shared = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = d.files.map((f) => f.name); }; }")
    page.locator('.q-item').nth(1).locator('[data-q-one-share]').click()
    page.wait_for_function("window.__shared !== null")
    check(page.evaluate("window.__shared") == [second['name']], 'Condividi singolo: un solo file, quello della riga')
    check(len(queue(page)) == n, 'Salva/Condividi singolo non tolgono nulla dalla coda')
    first_id = page.locator('.q-item').first.get_attribute('data-qid')
    page.locator('.q-item').first.locator('[data-q-del]').click()
    page.wait_for_function(f"document.querySelectorAll('.q-item').length === {n - 1}")
    check(len(queue(page)) == n - 1 and str(first_id) not in [str(x['id']) for x in queue(page)], 'togliere una voce la elimina dalla coda')
    n -= 1
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#q-info')
    page.wait_for_function(f"document.querySelector('#q-info').innerText.startsWith('{n} ')")
    check(page.locator('[data-q-count]').first.inner_text() == str(n), 'contatore in Altro')
    expect_names = [x['name'] for x in queue(page)]
    stamps = []
    page.on('download', lambda d: stamps.append((d.suggested_filename, time.time())))
    page.locator('[data-q-save]').click()
    page.wait_for_function(f"document.querySelector('.toast') && document.querySelector('.toast').innerText.includes('Salvati {n} file')", timeout=30000)
    page.wait_for_timeout(500)
    check([s[0] for s in stamps] == expect_names, f'Salva tutti: {len(stamps)} download nell\'ordine della coda')
    gaps = [stamps[i + 1][1] - stamps[i][1] for i in range(len(stamps) - 1)]
    check(gaps and min(gaps) >= 0.3, f'pausa tra i download: minimo {min(gaps) * 1000:.0f} ms (attesi ~400)' if gaps else 'pausa')
    check(len(queue(page)) == n, 'Salva tutti non svuota la coda')
    page.evaluate("() => { window.__shared = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = d.files.map((f) => f.name); }; }")
    page.locator('[data-q-share]').click()
    page.wait_for_function("window.__shared !== null")
    check(page.evaluate("window.__shared") == expect_names, 'Condividi tutti: una sola condivisione con tutti i file, nell\'ordine')
    page.locator('[data-q-clear]').click()
    sheet_wait(page)
    check(str(n) in page.locator('.sheet-text').first.inner_text(), 'conferma di Svuota coda con il numero')
    page.locator('.sheet [data-cancel]').click()
    sheet_gone(page)
    check(len(queue(page)) == n, 'Annulla non svuota')
    page.locator('[data-q-clear]').click()
    sheet_wait(page)
    page.locator('.sheet [data-ok]').click()
    sheet_gone(page)
    page.wait_for_function("document.querySelector('#q-info').innerText.startsWith('Nessuno')")
    check(queue(page) == [], 'Svuota coda')
    check(page.locator('[data-q-count]').first.is_hidden(), 'contatore nascosto')
    page.goto(BASE + '#/coda')
    page.wait_for_selector('.empty')
    check('Nessuno sticker' in page.locator('[data-q-info]').inner_text(), 'schermata coda vuota con istruzioni')
    page.screenshot(path=f'{SHOTS}/05-coda-vuota.png')

    print('9) errori in console')
    check(not page.errors, f'nessun errore in console: {page.errors[:3]}')
    browser.close()

print()
if fails:
    print(f'{len(fails)} controlli falliti:')
    for f in fails:
        print('  -', f)
    sys.exit(1)
print('Tutti i controlli passati')
