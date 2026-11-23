#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 12 (Backup e ripristino) in Chrome headless (Playwright), con service worker bloccato.

  python3 tests/ui-backup-test.py [cartella_screenshot]

Controlla: sezione Backup in Altro, "Salva backup" (nome BR_backup_AAAAMMGG.zip, contenuto dello zip, lastBackupAt),
"Condividi backup" (ripiego sul download), cancellazione del database e "Ripristina" con riepilogo e conferma, backup automatico
dei dati attuali, tutte le tabelle IDENTICHE dopo il ripristino (id, immagini, font, coda, template, log, impostazioni),
indici (weapons.unitIds, ricerca in Crea), font registrato, file sbagliati (errore e nessun dato toccato), annullo,
transazione unica (errore a meta' = niente cambia), segnatore di modifica e avviso in Crea (14 giorni).
"""
import hashlib
import http.server
import json
import os
import re
import socketserver
import sys
import tempfile
import threading
import zipfile

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots-backup'
os.makedirs(SHOTS, exist_ok=True)
TMP = tempfile.mkdtemp(prefix='sbr-backup-')


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


# Istantanea di tutte le tabelle: righe in ordine di chiave, Blob sostituiti da {tipo, byte, sha256}.
SNAP = """async (m, arg) => {
  const skip = new Set((arg && arg.skipSettings) || []);
  const hash = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(await b.arrayBuffer())))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const conv = async (v) => {
    if (v instanceof Blob) return { $b: v.type, size: v.size, sha: await hash(v) };
    if (Array.isArray(v)) return Promise.all(v.map(conv));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = await conv(v[k]); return o; }
    return v;
  };
  const out = {};
  for (const t of m.db.tables) {
    let rows = await t.toArray();
    if (t.name === 'settings') rows = rows.filter((r) => !skip.has(r.key));
    const pk = t.name === 'settings' ? 'key' : 'id';
    rows.sort((a, b) => (a[pk] < b[pk] ? -1 : a[pk] > b[pk] ? 1 : 0));
    out[t.name] = await Promise.all(rows.map(conv));
  }
  return out;
}"""


def snap(page, skip=None):
    return js(page, SNAP, {'skipSettings': skip or []})


def diff_tables(a, b):
    return [t for t in a if json.dumps(a[t], sort_keys=True) != json.dumps(b.get(t), sort_keys=True)]


def rect(page):
    return page.evaluate("""() => ({ games: 0 })""")


SEED_JS = """async (m) => {
  const mk = (w, h, c, noise) => new Promise((r) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d');
    x.fillStyle = c; x.fillRect(0, 0, w, h); if (noise) for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 9} 60% 50%)`; x.fillRect(i * 3, (i * 7) % h, 20, 9); } cv.toBlob(r, 'image/png'); });
  const kt = (await m.db.games.toArray()).find((g) => g.name === 'Kill Team');
  const fa = await m.addFaction(kt.id, 'Exaction Squad'), fb = await m.addFaction(kt.id, 'Foes');
  const uSgt = await m.addUnit(fa, 'Zorblax Sergeant'), uBoss = await m.addUnit(fb, 'Boss'), uGrunt = await m.addUnit(fa, 'Grunt');
  await m.setUnitImage(uSgt, await mk(300, 300, '#2a7', 1), 300, 300, await mk(48, 48, '#2a7', 1));
  await m.setUnitImage(uBoss, await mk(300, 300, '#a33', 1), 300, 300, null);
  const wBolt = await m.addWeapon({ factionId: fa, unitId: uSgt, name: 'Bolt rifle', kind: 'ranged' });
  const wSword = await m.addWeapon({ factionId: fa, unitId: uSgt, name: 'Chainsword', kind: 'melee' });
  const wClaw = await m.addWeapon({ factionId: fb, unitId: uBoss, name: 'Power claw', kind: 'melee' });
  await m.setUnitWeapons(uGrunt, [wBolt]); // una stessa arma su due miniature (indice multi-valore)
  for (const w of [wBolt, wSword, wClaw]) await m.setWeaponImage(w, await mk(900, 160, '#335', 1), 900, 160, null);
  const acts = await m.listActions(kt.id);
  const shoot = acts.find((a) => a.name === 'Shoot').id;
  const sig = await m.addAction(kt.id, 'Signal', null, { mode: 'png', image: { blob: await mk(240, 120, '#c80', 1), width: 240, height: 120 } });
  // font importato (un font vero: uno dei tre inclusi, con un altro nome)
  const fontBlob = await (await fetch('fonts/Oswald.woff2')).blob();
  const fontId = await m.addFont('Prova Font', fontBlob.slice(0, fontBlob.size, 'font/woff2'), 'woff2');
  // regole della fazione
  await m.db.rules.add({ factionId: fa, kind: 'equipment', name: 'Frag grenade', cost: '', text: 'testo', page: 9, source: 'pdf' });
  // template: duplicato con config toccata, predefinito invariato
  await m.duplicateTemplate((await m.db.templates.toArray()).find((t) => t.kind === 'activation').id);
  // partita con log
  const mid = await m.createMatch({ gameId: kt.id, name: 'Partita di backup', sides: [{ player: 'Vando', factionId: fa, factionName: 'Exaction Squad' }, { player: 'Manu', factionId: fb, factionName: 'Foes' }] });
  const mSgt = await m.addMatchUnit(mid, { side: 0, unitId: uSgt, name: 'Zorblax Sergeant', maxWounds: 10 });
  const mBoss = await m.addMatchUnit(mid, { side: 1, unitId: uBoss, name: 'Boss', maxWounds: 12 });
  const add = (ev) => m.addMatchEvent(mid, ev);
  await add({ type: 'turn-start', data: { initiative: { side: 1, how: 'roll', rolls: [3, 5] } } });
  const a1 = await add({ type: 'activation', unitRef: mBoss });
  const x1 = await add({ type: 'action', unitRef: mBoss, actionId: shoot, data: { actionName: 'Shoot', source: a1 } });
  const k1 = await add({ type: 'attack', unitRef: mBoss, targetRef: mSgt, weaponId: wClaw, data: { weaponName: 'Power claw', source: x1, dice: { text: '3 colpi' } } });
  await add({ type: 'damage', unitRef: mBoss, targetRef: mSgt, data: { amount: 4, source: k1 } });
  await add({ type: 'score', side: 0, data: { points: 2, reason: 'Recover Cargo' } });
  // coda persistita (due PNG diversi) e icone di riconoscimento (Blob dentro settings)
  await m.queueAdd({ key: 'm' + mid + '-e1', name: 'BR_Partita_001.png', label: 'uno', blob: await mk(500, 120, '#845', 1) });
  await m.queueAdd({ key: 'rnd-2', name: 'BR_altro.png', label: 'due', blob: await mk(320, 140, '#458', 1) });
  await m.setIconTemplates(kt.id, { ranged: await mk(24, 24, '#777', 1), melee: await mk(24, 24, '#999', 1) });
  // recenti e preferiti
  await m.recordUse({ unitId: uSgt, weaponId: wBolt, templateId: (await m.getDefaultTemplate('activation')).id });
  await m.toggleFavCombo({ unitId: uBoss, weaponId: wClaw, templateId: (await m.getDefaultTemplate('activation')).id });
  return { kt: kt.id, fa, fb, uSgt, uBoss, uGrunt, wBolt, wSword, wClaw, sig, fontId, mid };
}"""


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block', accept_downloads=True)
    page = new_page(ctx)

    print('0) file serviti e service worker')
    sw = open(os.path.join(ROOT, 'sw.js'), encoding='utf-8').read()
    assets = re.findall(r"'\./([^']+)'", sw.split('const ASSETS = [')[1].split(']')[0])
    missing = [a for a in assets if a and not os.path.exists(os.path.join(ROOT, a))]
    check(not missing, f'ogni file di ASSETS esiste ({len(assets)} voci): mancanti {missing}')
    check(all(f in assets for f in ['js/backup.js', 'js/backuplib.js', 'vendor/jszip.min.js']), 'backup.js, backuplib.js e jszip.min.js sono in sw.js')
    ver = re.search(r"CACHE_VERSION = '(v\d+)'", sw).group(1)
    check(int(ver[1:]) >= 17, f'CACHE_VERSION {ver} (almeno v17)')

    print('1) primo avvio: segnatore di modifica spento durante i semi dei dati')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    first = js(page, "async (m) => ({ last: await m.getSetting('lastChangeAt'), first: await m.getSetting('firstChangeAt'), bk: await m.getSetting('lastBackupAt'), games: await m.db.games.count() })")
    check(first['last'] is None and first['first'] is None and first['bk'] is None and first['games'] >= 3, f'dopo il primo avvio nessuna modifica registrata: {first}')
    page.wait_for_function("document.querySelector('#bk-info').innerText.startsWith('Ultimo backup')")
    check(page.locator('#bk-info').inner_text().startswith('Ultimo backup: mai.'), 'Altro: "Ultimo backup: mai."')
    labels = [page.locator(s).inner_text() for s in ['#bk-save', '#bk-share', '#bk-restore']]
    check(labels == ['Salva backup', 'Condividi backup', 'Ripristina da un backup…'], f'pulsanti: {labels}')
    check(page.locator('#bk-file').get_attribute('accept').startswith('.zip'), 'selettore file per .zip')

    print('2) dati di prova: giochi, immagini, font, regole, template, partita, coda, icone, recenti e preferiti')
    ids = js(page, SEED_JS)
    page.reload()
    page.wait_for_selector('#bk-save')
    js(page, "async (m) => { await (await import('./js/fonts.js')).loadUserFonts(); }")
    check(page.evaluate("document.fonts.check('16px \"Prova Font\"')"), 'il font importato e\' registrato')
    st = js(page, "async (m) => ({ last: await m.getSetting('lastChangeAt'), first: await m.getSetting('firstChangeAt') })")
    check(st['last'] is not None and st['first'] is not None and st['first'] <= st['last'], f'le modifiche hanno segnato lastChangeAt/firstChangeAt: {st}')
    before = snap(page)
    n_before = {t: len(r) for t, r in before.items()}
    check(n_before['images'] >= 6 and n_before['fonts'] == 1 and n_before['queue'] == 2 and n_before['matchEvents'] == 6 and n_before['rules'] == 1 and n_before['recents'] == 1,
          f'tabelle popolate: {n_before}')
    check(any(r['key'] == 'iconTemplates' and isinstance(list(r['value'].values())[0]['ranged'], dict) for r in before['settings']), 'icone di riconoscimento in settings (Blob annidati)')

    print('3) Salva backup')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-save')
    with page.expect_download() as dl:
        page.locator('#bk-save').click()
    d = dl.value
    zpath = os.path.join(TMP, d.suggested_filename)
    d.save_as(zpath)
    check(re.fullmatch(r'BR_backup_\d{8}\.zip', d.suggested_filename) is not None, f'nome file: {d.suggested_filename}')
    z = zipfile.ZipFile(zpath)
    names = z.namelist()
    data = json.loads(z.read('data.json'))
    check(data['app'] == 'sticker-br' and data['schemaVersion'] == 4 and re.match(r'\d{4}-\d\d-\d\dT', data['exportedAt']), f'data.json: app, schemaVersion {data["schemaVersion"]}, exportedAt {data["exportedAt"]}')
    check(sorted(data['tables']) == sorted(before.keys()), 'data.json ha tutte le tabelle dello schema v4')
    check(all(any(n.startswith(p) for n in names) for p in ['images/', 'fonts/', 'queue/', 'settings/']), 'cartelle images/, fonts/, queue/, settings/ nello zip')
    check(not any(n.startswith('cards/') for n in names) and data['tables']['cards'] == [], 'nessuna carta nel backup')
    shas = {n: hashlib.sha256(z.read(n)).hexdigest() for n in names if n != 'data.json'}
    expect = {}
    for t in ['images', 'fonts', 'queue']:
        for r in before[t]:
            for k, v in r.items():
                if isinstance(v, dict) and '$b' in v:
                    expect[v['sha']] = (t, r['id'], k)
    check(set(expect) <= set(shas.values()), 'ogni Blob del database e\' nello zip con gli stessi byte (sha-256 identico)')
    check(z.getinfo(next(n for n in names if n.startswith('queue/'))).compress_type == zipfile.ZIP_STORED, 'i PNG nello zip non sono ricompressi')
    ls = js(page, "async (m) => ({ bk: await m.getSetting('lastBackupAt'), last: await m.getSetting('lastChangeAt') })")
    check(ls['bk'] is not None and ls['bk'] >= ls['last'], 'lastBackupAt salvato')
    page.wait_for_function("!document.querySelector('#bk-info').innerText.includes('mai')")
    check('(oggi)' in page.locator('#bk-info').inner_text() and 'modifiche successive' not in page.locator('#bk-info').inner_text(), 'Altro: "Ultimo backup: ... (oggi)." senza modifiche successive: ' + page.locator('#bk-info').inner_text())
    after_save = snap(page, skip=['lastBackupAt'])
    check(diff_tables({k: v for k, v in before.items()}, snap(page)) == ['settings'], 'salvare il backup cambia solo lastBackupAt')
    page.screenshot(path=f'{SHOTS}/01-altro-backup.png')

    print('4) Condividi backup (senza Web Share: ripiego sul download)')
    page.evaluate("delete navigator.canShare; delete navigator.share")
    with page.expect_download() as dl2:
        page.locator('#bk-share').click()
    check(re.fullmatch(r'BR_backup_\d{8}\.zip', dl2.value.suggested_filename) is not None, 'download di ripiego con lo stesso nome')
    page.wait_for_selector('.toast:not([hidden])')
    check('Condivisione non disponibile' in page.locator('.toast').inner_text(), 'toast: ' + page.locator('.toast').inner_text())
    # con Web Share: condivide un solo file zip
    page.evaluate("""() => { window.__shared = null; navigator.canShare = (d) => !!(d && d.files && d.files.length); navigator.share = async (d) => { window.__shared = d.files.map((f) => [f.name, f.type, f.size]); }; }""")
    page.locator('#bk-share').click()
    page.wait_for_function("window.__shared")
    sh = page.evaluate("window.__shared")
    check(len(sh) == 1 and re.fullmatch(r'BR_backup_\d{8}\.zip', sh[0][0]) and sh[0][1] == 'application/zip' and sh[0][2] > 1000, f'condivisione di un solo file zip: {sh}')
    # annullando la condivisione lastBackupAt non cambia
    bk1 = js(page, "async (m) => m.getSetting('lastBackupAt')")
    page.wait_for_timeout(30)
    page.evaluate("""() => { navigator.share = async () => { const e = new Error('annullato'); e.name = 'AbortError'; throw e; }; }""")
    page.locator('#bk-share').click()
    page.wait_for_function("!document.querySelector('#bk-share').disabled")
    page.wait_for_timeout(100)
    check(js(page, "async (m) => m.getSetting('lastBackupAt')") == bk1, 'condivisione annullata: lastBackupAt invariato')

    print('5) cancello i dati del sito (database eliminato) e ricarico')
    page.evaluate("""async () => { const m = await import('./js/db.js'); m.db.close(); await new Promise((res, rej) => { const r = indexedDB.deleteDatabase('sticker-br'); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; }); }""")
    page.goto(BASE + '#/altro')
    page.reload()
    page.wait_for_selector('#bk-save')
    wiped = snap(page)
    check(len(wiped['fonts']) == 0 and len(wiped['queue']) == 0 and len(wiped['matches']) == 0 and len(wiped['units']) == 0 and len(wiped['games']) >= 3, f'database nuovo, solo dati iniziali: giochi {len(wiped["games"])}, miniature {len(wiped["units"])}')
    check(js(page, "async (m) => (await m.getSetting('lastBackupAt'))") is None, 'nessun ultimo backup dopo la cancellazione')
    wiped_snapshot = wiped

    print('6) file sbagliati: errore e nessun dato toccato')

    def bad_zip(name, files):
        p = os.path.join(TMP, name)
        with zipfile.ZipFile(p, 'w') as zz:
            for k, v in files.items():
                zz.writestr(k, v)
        return p

    base = {'app': 'sticker-br', 'schemaVersion': 4, 'exportedAt': '2026-11-01T10:00:00Z', 'tables': {}}
    bad_files = {
        'testo.zip': (None, b'non sono uno zip'),
        'senza-data.zip': (bad_zip('senza-data.zip', {'x.txt': 'ciao'}), None),
        'altra-app.zip': (bad_zip('altra-app.zip', {'data.json': json.dumps({**base, 'app': 'altra'})}), None),
        'schema-nuovo.zip': (bad_zip('schema-nuovo.zip', {'data.json': json.dumps({**base, 'schemaVersion': 9})}), None),
        'id-doppi.zip': (bad_zip('id-doppi.zip', {'data.json': json.dumps({**base, 'tables': {'games': [{'id': 1, 'name': 'A'}, {'id': 1, 'name': 'B'}]}})}), None),
        'file-mancante.zip': (bad_zip('file-mancante.zip', {'data.json': json.dumps({**base, 'tables': {'images': [{'id': 1, 'kind': 'unit', 'blob': {'$blob': 'images/1.png', 'type': 'image/png'}}]}})}), None),
        'troncato.zip': (None, open(zpath, 'rb').read()[: os.path.getsize(zpath) // 2]),
        'immagine.png': (None, b'\x89PNG\r\n\x1a\n' + b'0' * 50),
    }
    expect_msg = {'testo.zip': 'zip valido', 'senza-data.zip': 'manca data.json', 'altra-app.zip': 'app diversa', 'schema-nuovo.zip': 'più recente',
                  'id-doppi.zip': 'ripetuto', 'file-mancante.zip': 'manca il file images/1.png', 'troncato.zip': '', 'immagine.png': 'zip valido'}
    downloads = []
    page.on('download', lambda d: downloads.append(d.suggested_filename))
    for name, (path, raw) in bad_files.items():
        if path is None:
            path = os.path.join(TMP, name)
            open(path, 'wb').write(raw)
        page.set_input_files('#bk-file', path)
        sheet_wait(page)
        title = page.locator('.sheet-title').inner_text()
        text = page.locator('.sheet').inner_text()
        check(title == 'File non valido' and expect_msg[name] in text and 'Non è stato toccato nessun dato' in text, f'{name}: «{[l for l in text.splitlines() if l.strip()][1][:80]}»')
        page.locator('.sheet [data-ok]').click()
        sheet_gone(page)
        page.wait_for_function("!document.querySelector('#bk-restore').disabled")
    check(not downloads, 'nessun backup automatico scaricato per i file sbagliati')
    check(diff_tables(wiped_snapshot, snap(page)) == [], 'dopo tutti i file sbagliati i dati sono identici')
    page.screenshot(path=f'{SHOTS}/02-file-non-valido.png')

    print('7) ripristino: riepilogo, annullo, conferma')
    page.set_input_files('#bk-file', zpath)
    sheet_wait(page)
    text = page.locator('.sheet').inner_text()
    check(page.locator('.sheet-title').inner_text() == 'Ripristinare questo backup?', 'pannello di conferma')
    check(all(s in text for s in [f'{n_before["games"]} giochi', f'{n_before["units"]} miniature', f'{n_before["weapons"]} armi', f'{n_before["actions"]} azioni',
                                  f'{n_before["images"]} immagini', f'{n_before["templates"]} template', '1 font', '2 sticker in coda', '1 partite', 'Sostituisce tutti i dati attuali']),
          'riepilogo: ' + text.replace('\n', ' | '))
    page.wait_for_timeout(450)
    page.screenshot(path=f'{SHOTS}/03-conferma-ripristino.png')
    page.locator('.sheet [data-cancel]').click()
    sheet_gone(page)
    page.wait_for_timeout(300)
    check(not downloads and diff_tables(wiped_snapshot, snap(page)) == [], 'Annulla: nessun download e nessun dato cambiato')

    page.set_input_files('#bk-file', zpath)
    sheet_wait(page)
    with page.expect_download() as dla:
        page.locator('.sheet [data-ok]').click()
    autod = dla.value
    autop = os.path.join(TMP, autod.suggested_filename)
    autod.save_as(autop)
    check(re.fullmatch(r'BR_backup_prima-del-ripristino_\d{8}-\d{6}\.zip', autod.suggested_filename) is not None, f'backup automatico dei dati attuali: {autod.suggested_filename}')
    auto = json.loads(zipfile.ZipFile(autop).read('data.json'))
    check(len(auto['tables']['units']) == 0 and len(auto['tables']['games']) == len(wiped_snapshot['games']), 'il backup automatico contiene i dati di PRIMA del ripristino')
    page.wait_for_function("location.hash === '#/crea'")
    page.wait_for_selector('#crea-q')
    page.wait_for_timeout(500)

    print('8) dopo il ripristino: tutto identico')
    restored = snap(page)
    d_tables = diff_tables(before, restored)
    # lastChangeAt/firstChangeAt: dopo il ripristino coincidono con la data del backup (nessuna modifica successiva)
    if d_tables == ['settings']:
        keys = lambda s: {r['key']: r for r in s['settings']}
        kb, kr = keys(before), keys(restored)
        other = [k for k in set(kb) | set(kr) if k not in ('lastChangeAt', 'firstChangeAt', 'lastBackupAt') and json.dumps(kb.get(k), sort_keys=True) != json.dumps(kr.get(k), sort_keys=True)]
        check(not other, f'settings identiche (a parte i 3 segnatori): differenze {other}')
        d_tables = []
    check(d_tables == [], f'tutte le tabelle identiche, id e Blob compresi: differenze {d_tables}')
    for t in ['games', 'factions', 'units', 'weapons', 'actions', 'images', 'templates', 'fonts', 'rules', 'matches', 'matchUnits', 'matchEvents', 'queue', 'recents']:
        check(restored[t] == before[t], f'  {t}: {len(restored[t])} righe uguali')
    check(restored['cards'] == [], '  cards vuota')
    st = js(page, "async (m) => ({ bk: await m.getSetting('lastBackupAt'), ch: await m.getSetting('lastChangeAt') })")
    check(st['bk'] == st['ch'], 'lastBackupAt = lastChangeAt = data del file ripristinato')
    exported = int(__import__('datetime').datetime.fromisoformat(data['exportedAt'].replace('Z', '+00:00')).timestamp() * 1000)
    check(st['bk'] == exported, f'data del backup ripristinato {st["bk"]} = exportedAt {exported}')

    print('9) indici, ricerca, font e id dopo il ripristino')
    mu = js(page, """async (m, ids) => ({
      byUnit: (await m.db.weapons.where('unitIds').equals(ids.uGrunt).toArray()).map((w) => w.name),
      byUnit2: (await m.db.weapons.where('unitIds').equals(ids.uSgt).toArray()).map((w) => w.name).sort(),
      ev: (await m.db.matchEvents.where('[matchId+seq]').between([ids.mid, 0], [ids.mid, 99]).toArray()).length,
      qkey: (await m.db.queue.where('key').equals('rnd-2').toArray()).length,
      rkey: await m.db.recents.count(),
      fav: (await m.getSetting('favCombos')).length,
      nextUnit: await m.addUnit(ids.fa, 'Dopo il ripristino'), maxUnit: Math.max(...(await m.db.units.toArray()).map((u) => u.id)),
      nextQ: await m.queueAdd({ key: 'dopo', name: 'x.png', blob: new Blob([new Uint8Array([1])], { type: 'image/png' }) }), maxQ: Math.max(...(await m.db.queue.toArray()).map((u) => u.id)),
      dirty: await m.getSetting('lastChangeAt')
    })""", ids)
    check(mu['byUnit'] == ['Bolt rifle'] and mu['byUnit2'] == ['Bolt rifle', 'Chainsword'], f'indice multi-valore weapons.unitIds: {mu["byUnit"]} / {mu["byUnit2"]}')
    check(mu['ev'] == 6 and mu['qkey'] == 1 and mu['rkey'] == 1 and mu['fav'] == 1, f'indici composto e unici: eventi {mu["ev"]}, coda per chiave {mu["qkey"]}')
    check(mu['nextUnit'] == mu['maxUnit'] and mu['nextQ'] == mu['maxQ'] and mu['nextUnit'] > ids['uGrunt'], f'nuovi id dopo il ripristino senza collisioni: miniatura {mu["nextUnit"]}, coda {mu["nextQ"]}')
    check(page.evaluate("document.fonts.check('16px \"Prova Font\"')"), 'font importato registrato dopo il ripristino (nessun ricaricamento a mano)')
    fam = page.evaluate("[...document.fonts].filter((f) => f.family.replace(/\"/g, '') === 'Prova Font' && f.status === 'loaded').length")
    check(fam == 1, f'un solo FontFace "Prova Font" caricato: {fam}')
    page.locator('#crea-q').fill('zorblax')
    page.wait_for_selector('#crea-body .item, #crea-body [data-unit], #crea-body button')
    page.wait_for_timeout(400)
    res_text = page.locator('#crea-body').inner_text()
    check('Zorblax Sergeant' in res_text, 'ricerca in Crea trova subito la miniatura ripristinata')
    page.screenshot(path=f'{SHOTS}/04-crea-dopo-ripristino.png')
    # il PNG dello sticker usa il font (si disegna senza errori)
    ok_draw = page.evaluate("""async (id) => {
      const D = await import('./js/db.js'); const R = await import('./js/render.js'); const S = await import('./js/stickerinput.js');
      const src = await D.getStickerSource({ unitId: id.u, weaponId: id.w }); const tpl = await D.getDefaultTemplate('activation');
      const cfg = JSON.parse(JSON.stringify(tpl.config)); cfg.lines[0].font = 'Prova Font';
      const b = await R.renderSticker(S.buildStickerInput(src, tpl, {}).data, cfg); return b.size > 1000 && b.type === 'image/png';
    }""", {'u': ids['uSgt'], 'w': ids['wBolt']})
    check(ok_draw, 'sticker disegnato con il font ripristinato')

    print('10) transazione unica: un errore a meta\' non cambia nulla')
    before_tx = snap(page)
    n_err = len(page.errors)
    res = page.evaluate("""async () => {
      const B = await import('./js/backup.js');
      const cur = await B.exportBackup();
      const parsed = await B.readBackup(cur.blob);
      parsed.tables.queue.push({ ...parsed.tables.queue[0] }); // stesso id: bulkAdd fallisce DOPO aver svuotato le tabelle
      try { await B.restoreBackup(parsed, { autoBackup: false }); return 'nessun errore'; } catch (e) { return e.name + ': ' + e.message; }
    }""")
    check(res.startswith('BackupError: Ripristino non riuscito') and 'non sono stati toccati' in res, 'errore: ' + res[:120])
    check(len(page.errors) - n_err == 1, f'l\'errore previsto e\' l\'unico scritto in console: {page.errors[n_err:]}')
    del page.errors[n_err:]
    check(diff_tables(before_tx, snap(page)) == [], 'dopo l\'errore ogni tabella e\' com\'era (rollback)')

    print('11) segnatore di modifica e avviso in Crea')
    js(page, "async (m) => { const D = m; await D.setSetting('lastBackupAt', Date.now() - 20 * 86400000); }")
    base_ch = js(page, "async (m) => { await m.changeSettled(); return m.getSetting('lastChangeAt'); }")
    # solo uso di uno sticker: non conta
    page.wait_for_timeout(20)
    js(page, "async (m, ids) => { await m.recordUse({ unitId: ids.uBoss, weaponId: ids.wClaw, templateId: null }); await m.db.units.update(ids.uBoss, { lastUsed: Date.now(), useCount: 9 }); await m.db.recents.add({ key: 'zz', unitId: 1, usedAt: 1 }); await m.setSetting('lastGameId', 'all'); }", ids)
    same_ch = js(page, "async (m) => { await m.changeSettled(); return m.getSetting('lastChangeAt'); }")
    check(same_ch == base_ch, 'uso di uno sticker (lastUsed, useCount, recents, settings) non conta come modifica')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.wait_for_timeout(300)
    check(page.locator('#bk-warn').is_hidden(), 'backup vecchio ma nessuna modifica dopo: nessun avviso')
    # una modifica vera: rinomina
    page.wait_for_timeout(20)
    js(page, "async (m, ids) => { await m.db.units.update(ids.uBoss, { name: 'Boss Rinominato' }); }", ids)
    ch2 = js(page, "async (m) => { await m.changeSettled(); return m.getSetting('lastChangeAt'); }")
    check(ch2 > base_ch, 'una modifica vera aggiorna lastChangeAt')
    page.goto(BASE + '#/altro')
    page.wait_for_selector('#bk-info')
    page.wait_for_function("document.querySelector('#bk-info').innerText.includes('modifiche successive')")
    check('(20 giorni fa)' in page.locator('#bk-info').inner_text(), 'Altro: ' + page.locator('#bk-info').inner_text())
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#bk-warn:not([hidden])')
    wt = page.locator('#bk-warn').inner_text()
    check("L'ultimo backup è di 20 giorni fa e da allora hai fatto modifiche." in wt.replace("e'", 'è') or '20 giorni fa' in wt, 'avviso in Crea: ' + wt.replace('\n', ' '))
    check(page.locator('#bk-warn a').get_attribute('href') == '#/altro', 'l\'avviso porta ad Altro')
    box = page.locator('#bk-warn').bounding_box()
    check(box['height'] < 90 and page.locator('[data-bk-hide]').bounding_box()['width'] >= 48, f'avviso discreto (alto {box["height"]:.0f}px, tasto ✕ da almeno 48 px)')
    page.screenshot(path=f'{SHOTS}/05-crea-avviso.png')
    page.locator('[data-bk-hide]').click()
    check(page.locator('#bk-warn').is_hidden(), '✕ nasconde l\'avviso')
    page.goto(BASE + '#/libreria')
    page.goto(BASE + '#/crea')
    page.wait_for_selector('#crea-q')
    page.wait_for_timeout(300)
    check(page.locator('#bk-warn').is_hidden(), 'nascosto anche tornando in Crea nella stessa sessione')
    # 13 giorni: niente avviso (nuova pagina = stato nuovo)
    js(page, "async (m) => { await m.setSetting('lastBackupAt', Date.now() - 13 * 86400000); }")
    page2 = new_page(ctx)
    page2.goto(BASE + '#/crea')
    page2.wait_for_selector('#crea-q')
    page2.wait_for_timeout(400)
    check(page2.locator('#bk-warn').is_hidden(), 'backup di 13 giorni con modifiche: nessun avviso')
    js(page2, "async (m) => { await m.setSetting('lastBackupAt', Date.now() - 14 * 86400000); }")
    page2.goto(BASE + '#/crea')
    page2.reload()
    page2.wait_for_selector('#bk-warn:not([hidden])')
    check('14 giorni' in page2.locator('#bk-warn').inner_text(), '14 giorni: avviso')
    # mai fatto un backup: avviso solo dopo 14 giorni dai primi dati
    js(page2, "async (m) => { await m.db.settings.delete('lastBackupAt'); await m.setSetting('firstChangeAt', Date.now() - 3 * 86400000); }")
    page2.reload()
    page2.wait_for_selector('#crea-q')
    page2.wait_for_timeout(400)
    check(page2.locator('#bk-warn').is_hidden(), 'nessun backup ma dati da 3 giorni: nessun avviso')
    js(page2, "async (m) => { await m.setSetting('firstChangeAt', Date.now() - 15 * 86400000); }")
    page2.reload()
    page2.wait_for_selector('#bk-warn:not([hidden])')
    check('nessun backup' in page2.locator('#bk-warn').inner_text(), 'nessun backup e dati da 15 giorni: ' + page2.locator('#bk-warn').inner_text())
    # il salvataggio del backup spegne l'avviso
    page2.goto(BASE + '#/altro')
    page2.wait_for_selector('#bk-save')
    with page2.expect_download():
        page2.locator('#bk-save').click()
    page2.wait_for_function("document.querySelector('#bk-info').innerText.includes('(oggi)')")
    page2.goto(BASE + '#/crea')
    page2.reload()
    page2.wait_for_selector('#crea-q')
    page2.wait_for_timeout(400)
    check(page2.locator('#bk-warn').is_hidden(), 'dopo "Salva backup" l\'avviso sparisce')
    page2.close()

    print('12) errori in console')
    check(not page.errors, f'nessun errore in console: {page.errors[:3]}')
    browser.close()

print()
if fails:
    print(f'{len(fails)} controlli falliti:')
    for f in fails:
        print('  -', f)
    sys.exit(1)
print('Tutti i controlli passati')
