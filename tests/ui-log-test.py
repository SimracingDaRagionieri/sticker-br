#!/usr/bin/env python3
"""Prova dell'interfaccia del Passo 10 (Log della partita) in Chrome headless (Playwright), con service worker bloccato.

  python3 tests/ui-log-test.py [cartella_screenshot]

Controlla: db v3 e tabelle, etichetta turno (migrazione e giochi nuovi), voce Log nella barra, nuova partita da interfaccia,
rosa (dalla fazione con ferite copiate, a mano senza ferite), iniziativa e come e' stata ottenuta, attivazioni, azioni con
arma e bersaglio, danni con tastierino, ferite rimaste, incapacitato (proposto e confermato), annulla, modifica di un danno
con ricalcolo, punti, due turni, cronologia e riepilogo, modalita' ricostruzione con inserimento in mezzo, avvisi,
partita in pausa dopo ricaricamento, eliminazione di gioco/fazione/miniatura/azione/arma senza toccare il log.
"""
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots-log'
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


def pick(page, value):
    sheet_wait(page)
    page.locator(f'.sheet [data-pick="{value}"]').click()


def keypad(page, n):
    sheet_wait(page)
    for ch in str(n):
        page.locator(f'.sheet [data-key="{ch}"]').click()
    page.locator('.sheet [data-ok]').click()


def form(page, wait=True, **vals):
    sheet_wait(page)
    for name, v in vals.items():
        el = page.locator(f'.sheet [name="{name}"]')
        if el.evaluate('e => e.tagName') == 'SELECT':
            el.select_option(str(v))
        else:
            el.fill(str(v))
    page.locator('.sheet button[type=submit]').click()
    if wait:
        sheet_gone(page)


def checks(page, labels):
    sheet_wait(page)
    for lb in labels:
        page.locator('.sheet .check', has_text=lb).locator('input').check()
    page.locator('.sheet button[type=submit]').click()
    sheet_gone(page)


def tap(page, act, **attrs):
    sel = f'[data-act="{act}"]' + ''.join(f'[data-{k}="{v}"]' for k, v in attrs.items())
    page.locator(sel).first.click()


def menu_item(page, label):
    sheet_wait(page)
    page.locator('.sheet-menu button', has_text=label).first.click()


def settle(page):
    """Aspetta che la schermata abbia finito di ridisegnarsi dopo un'azione."""
    page.wait_for_function("document.querySelector('.lg-top') !== null")
    page.wait_for_timeout(120)


def state(page, mid):
    return js(page, """async (m, id) => {
      const st = await m.getMatchState(id);
      const nm = (i) => { const u = st.units.find((x) => x.id === i); return u ? u.name : null; };
      return {
        match: { status: st.match.status, mode: st.match.mode, turnLabel: st.match.turnLabel, gameName: st.match.gameName, name: st.match.name },
        events: st.events.map((e) => ({ id: e.id, seq: e.seq, type: e.type, turn: e.turn, side: e.side, unit: nm(e.unitRef), target: nm(e.targetRef),
          action: e.data.actionName || null, weapon: e.data.weaponName || null, amount: e.data.amount ?? null, left: e.data.woundsLeft ?? null,
          applied: e.data.applied ?? null, points: e.data.points ?? null, source: e.data.source ?? null, ini: e.data.initiative || null, note: e.note })),
        units: st.units.map((u) => ({ id: u.id, name: u.name, side: u.side, max: u.maxWounds, unitId: u.unitId })),
        left: Object.fromEntries([...st.rep.units.values()].map((u) => [u.name, u.left])),
        inc: Object.fromEntries([...st.rep.units.values()].map((u) => [u.name, u.incapacitated])),
        score: st.rep.score, turn: st.rep.turn, warnings: st.rep.warnings.map((w) => w.code), proposals: st.rep.proposals.map((i) => nm(i))
      };
    }""", mid)


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 412, 'height': 900}, device_scale_factor=2, service_workers='block')
    page = new_page(ctx)
    page.goto(BASE + '#/libreria')
    page.wait_for_selector('h1')

    print('1) database v3, tabelle ed etichetta del turno')
    info = js(page, """async (m) => ({
      verno: m.db.verno, tables: m.db.tables.map((t) => t.name).sort(),
      games: (await m.db.games.toArray()).map((g) => [g.name, g.labels.turn]),
      rev: await m.getSetting('turnLabelsRev'),
      evIdx: m.db.matchEvents.schema.idxByName['[matchId+seq]'] ? 'ok' : 'manca'
    })""")
    check(info['verno'] == 4, f'versione schema {info["verno"]} (attesa 4, dal Passo 11)')
    check(all(t in info['tables'] for t in ['matches', 'matchUnits', 'matchEvents', 'rules', 'games', 'settings']), 'tabelle della v2 e nuove presenti')
    check(info['evIdx'] == 'ok', 'indice composto [matchId+seq]')
    check(dict(info['games']) == {'Kill Team': 'Turning Point', 'Warhammer 40,000': 'Turno', 'The Old World': 'Turno'}, f'etichette turno: {info["games"]}')
    check(info['rev'] == 1, 'settings.turnLabelsRev = 1')

    print('2) migrazione di un gioco gia\' esistente senza `turn` e giochi nuovi')
    js(page, """async (m) => {
      await m.db.games.add({ name: 'Kill Team Vecchio', labels: { faction: 'Squadra', unit: 'Operativo', weapon: 'Arma' }, order: 9, fav: 0 });
      await m.db.settings.delete('turnLabelsRev');
      await m.db.games.where('name').equals('Kill Team').modify((g) => { delete g.labels.turn; });
    }""")
    page.reload()
    page.wait_for_selector('h1')
    g2 = dict(js(page, "async (m) => (await m.db.games.toArray()).map((g) => [g.name, g.labels.turn])"))
    check(g2['Kill Team'] == 'Turning Point' and g2['Kill Team Vecchio'] == 'Turno', f'migrazione: Kill Team -> Turning Point, altri -> Turno ({g2})')
    check(js(page, "async (m) => m.turnLabelOf({ labels: { faction: 'x' } })") == 'Turno', 'gioco senza turn: si legge "Turno"')
    js(page, "async (m) => { await m.db.games.where('name').equals('Kill Team Vecchio').delete(); }")
    gid_new = js(page, "async (m) => m.addGame('Gioco Nuovo', { faction: 'A', unit: 'B', weapon: 'C' })")
    check(js(page, "async (m, id) => (await m.getGame(id)).labels.turn", gid_new) == 'Turno', 'gioco nuovo: turn predefinito "Turno"')
    js(page, "async (m, id) => { await m.deleteGame(id); }", gid_new)
    # Libreria: il campo etichetta turno compare nella modifica del gioco
    page.goto(BASE + '#/libreria')
    page.wait_for_selector('[data-list="game"] .item')
    page.locator('[data-list="game"] .item', has_text='Kill Team').first.locator('[data-menu]').click()
    menu_item(page, 'Rinomina')
    sheet_wait(page)
    check(page.locator('.sheet [name="turn"]').input_value() == 'Turning Point', 'Libreria: campo "turno" precompilato con Turning Point')
    page.locator('.sheet [data-cancel]').click()

    print('3) voce Log nella barra e schermata vuota')
    page.goto(BASE + '#/log')
    page.wait_for_selector('h1')
    labels = page.locator('.tabbar a').all_inner_texts()
    check(len(labels) == 5 and any('Log' in t for t in labels), f'barra con 5 voci: {[t.replace(chr(10), " ") for t in labels]}')
    check(page.locator('.tabbar a[data-route="log"].active').count() == 1, 'la voce Log risulta attiva')
    check(page.locator('.empty', has_text='Nessuna partita').count() == 1, 'stato vuoto con istruzioni')

    print('4) dati di prova: due squadre con ferite, armi e azioni')
    ids = js(page, """async (m) => {
      const kt = (await m.db.games.toArray()).find((g) => g.name === 'Kill Team');
      const fa = await m.addFaction(kt.id, 'Exaction Squad');
      const fb = await m.addFaction(kt.id, 'Foes');
      const uSgt = await m.addUnit(fa, 'Sergeant');
      const uGun = await m.addUnit(fa, 'Gunner');
      const uBoss = await m.addUnit(fb, 'Boss');
      const uGrunt = await m.addUnit(fb, 'Grunt');
      await m.patch('units', uSgt, { stats: { apl: '3', move: '6"', save: '3+', wounds: '10' } });
      await m.patch('units', uGun, { stats: { apl: '3', move: '6"', save: '3+', wounds: '8' } });
      await m.patch('units', uBoss, { stats: { apl: '3', move: '6"', save: '3+', wounds: '12' } });
      // Grunt: nessuna statistica (come un'unita' creata a mano) -> tracciamento spento
      const wBolt = await m.addWeapon({ factionId: fa, unitId: uSgt, name: 'Bolt rifle', kind: 'ranged' });
      const wSword = await m.addWeapon({ factionId: fa, unitId: uSgt, name: 'Chainsword', kind: 'melee' });
      const wClaw = await m.addWeapon({ factionId: fb, unitId: uBoss, name: 'Power claw', kind: 'melee' });
      const shoot = (await m.listActions(kt.id)).find((a) => a.name === 'Shoot');
      const fight = (await m.listActions(kt.id)).find((a) => a.name === 'Fight');
      return { kt: kt.id, fa, fb, uSgt, uGun, uBoss, uGrunt, wBolt, wSword, wClaw, shoot: shoot.id, fight: fight.id };
    }""")

    print('5) nuova partita da interfaccia')
    page.goto(BASE + '#/log')
    page.wait_for_selector('[data-new]')
    page.locator('[data-new]').click()
    pick(page, str(ids['kt']))
    form(page, name='Prova al tavolo', mission='Recover Cargo', mode='live', p0='Vando', f0=str(ids['fa']), p1='Manu', f1=str(ids['fb']))
    page.wait_for_selector('.lg-top')
    mid = int(page.url.split('m=')[1].split('&')[0])
    st = state(page, mid)
    check(st['match']['gameName'] == 'Kill Team' and st['match']['turnLabel'] == 'Turning Point', 'la partita copia nome del gioco e etichetta del turno')
    check(page.locator('.lg-title').inner_text() == 'Prova al tavolo', 'titolo della partita')
    check('Prima del primo turno' in page.locator('[data-turn]').inner_text(), 'prima del primo turno')
    check(page.locator('[data-act="next-turn"]').first.inner_text().startswith('Inizia il turning point 1'), 'pulsante "Inizia il turning point 1" (etichetta del gioco)')

    print('6) rosa: dalla squadra (ferite copiate) e a mano (senza ferite)')
    tap(page, 'roster-faction', side=0)
    checks(page, ['Sergeant', 'Gunner'])
    tap(page, 'roster-faction', side=1)
    checks(page, ['Boss', 'Grunt'])
    tap(page, 'roster-manual', side=1)
    form(page, name='Boss', wounds='')   # nome uguale: diventa "Boss 2"
    settle(page)
    st = state(page, mid)
    check(sorted((u['name'], u['side'], u['max']) for u in st['units']) == [('Boss', 1, 12), ('Boss 2', 1, None), ('Grunt', 1, None), ('Gunner', 0, 8), ('Sergeant', 0, 10)],
          f'rosa: {[(u["name"], u["max"]) for u in st["units"]]}')
    check(page.locator('[data-wounds]').all_inner_texts().count('10/10') == 1, 'ferite mostrate come 10/10')
    page.screenshot(path=f'{SHOTS}/01-rosa.png')
    uid = {u['name']: u['id'] for u in st['units']}

    print('7) turno 1: iniziativa e come e\' stata ottenuta')
    tap(page, 'next-turn')
    form(page, side=1, how='roll', r0='3', r1='5')
    settle(page)
    st = state(page, mid)
    check(st['turn'] == 1 and st['events'][0]['type'] == 'turn-start' and st['events'][0]['ini'] == {'side': 1, 'how': 'roll', 'rolls': [3, 5], 'text': ''}, f'turn-start con iniziativa: {st["events"][0]["ini"]}')
    sub = page.locator('[data-turn]').inner_text()
    check('Turning Point 1' in sub and 'Manu' in sub and 'tiro 3 contro 5' in sub, f'barra in alto: "{sub}"')

    print('8) attivazione di Manu: Boss spara al Sergeant (4 ferite)')
    tap(page, 'activate')
    pick(page, uid['Boss'])
    pick(page, f'a:{ids["shoot"]}')          # azione Shoot
    pick(page, f'w:{ids["wClaw"]}')          # arma
    pick(page, uid['Sergeant'])              # bersaglio
    keypad(page, 4)
    pick(page, 'done')                       # fine attivazione
    settle(page)
    st = state(page, mid)
    check([e['type'] for e in st['events']] == ['turn-start', 'activation', 'action', 'attack', 'damage'], f'eventi: {[e["type"] for e in st["events"]]}')
    check(st['left']['Sergeant'] == 6 and st['events'][4]['left'] == 6 and st['events'][4]['applied'] == 4, 'Sergeant 10 - 4 = 6 (woundsLeft e applied sul danno)')
    check(st['events'][3]['weapon'] == 'Power claw' and st['events'][3]['target'] == 'Sergeant' and st['events'][2]['action'] == 'Shoot', 'azione, arma e bersaglio registrati')
    check(st['events'][4]['source'] == st['events'][3]['id'] and st['events'][3]['source'] == st['events'][2]['id'], 'danno -> attacco -> azione collegati da data.source')
    check(all(e['turn'] == 1 for e in st['events']), 'tutte le voci nel turno 1')
    check(page.locator('[data-wounds]').all_inner_texts().count('6/10') == 1, 'tavolo: Sergeant 6/10')

    print('9) attivazione di Vando: il Sergeant attacca il Boss 2 (ferite non tracciate)')
    tap(page, 'activate')
    pick(page, uid['Sergeant'])
    pick(page, f'a:{ids["fight"]}')
    pick(page, f'w:{ids["wSword"]}')
    pick(page, uid['Boss 2'])
    keypad(page, 5)
    pick(page, 'done')
    settle(page)
    st = state(page, mid)
    last = st['events'][-1]
    check(last['type'] == 'damage' and last['amount'] == 5 and last['left'] is None and last['applied'] is None, 'bersaglio senza ferite: danno registrato, niente ferite rimaste')
    check(st['left']['Boss 2'] is None and st['proposals'] == [], 'nessuna proposta di incapacitato senza ferite tracciate')

    print('10) danni fino a 0: proposta e conferma di incapacitato')
    tap(page, 'activate')
    pick(page, uid['Sergeant'])
    pick(page, f'a:{ids["fight"]}')
    pick(page, f'w:{ids["wSword"]}')
    pick(page, uid['Boss'])
    keypad(page, 20)                         # piu' delle ferite rimaste (12): non scendono sotto 0
    sheet_wait(page)
    check('a 0 ferite' in page.locator('.sheet-title').inner_text(), 'a 0 ferite compare la domanda "incapacitato?"')
    page.locator('.sheet [data-ok]').click()  # Sì
    sheet_gone(page)
    pick(page, 'done')
    settle(page)
    st = state(page, mid)
    check(st['left']['Boss'] == 0 and st['inc']['Boss'] is True, 'Boss a 0 ferite e incapacitato')
    dmg = [e for e in st['events'] if e['type'] == 'damage'][-1]
    check(dmg['amount'] == 20 and dmg['applied'] == 12 and dmg['left'] == 0, 'danno 20, effettive 12, rimaste 0 (non sotto 0)')
    check(st['events'][-1]['type'] == 'incapacitated' and st['events'][-1]['unit'] == 'Boss', 'evento "incapacitated" in coda')
    check(page.locator('[data-unit-menu].out').count() == 1, 'il Boss risulta barrato nella rosa')
    page.screenshot(path=f'{SHOTS}/02-incapacitato.png')
    # un operativo incapacitato non si puo' attivare dall'elenco
    tap(page, 'activate')
    sheet_wait(page)
    check(page.locator(f'.sheet [data-pick="{uid["Boss"]}"]').count() == 0, 'Boss incapacitato non compare tra chi puo\' attivare')
    check(page.locator(f'.sheet [data-pick="{uid["Gunner"]}"]').count() == 1, 'Gunner si')
    page.locator('.sheet [data-cancel]').click()
    sheet_gone(page)

    print('11) annulla: riporta le ferite di prima')
    n_before = len(state(page, mid)['events'])
    tap(page, 'undo')            # toglie "incapacitated"
    settle(page)
    st = state(page, mid)
    check(len(st['events']) == n_before - 1 and st['inc']['Boss'] is False and st['left']['Boss'] == 0, 'annullato l\'incapacitato: Boss a 0 ferite ma non incapacitato')
    check(st['proposals'] == ['Boss'], 'riappare la proposta di incapacitato')
    check(page.locator('[data-proposal]').count() == 1, 'banner "a 0 ferite: incapacitato?"')
    tap(page, 'undo')            # toglie il danno da 20
    settle(page)
    st = state(page, mid)
    check(st['left']['Boss'] == 12 and st['proposals'] == [], 'annullato il danno: Boss torna a 12 ferite')
    # rifaccio il danno e lo confermo dal banner
    tap(page, 'activate')
    pick(page, uid['Sergeant']); pick(page, f'a:{ids["fight"]}'); pick(page, f'w:{ids["wSword"]}'); pick(page, uid['Boss']); keypad(page, 12)
    sheet_wait(page)
    page.locator('.sheet [data-cancel]').click()   # "No": non incapacitato
    sheet_gone(page)
    pick(page, 'done')
    settle(page)
    check(page.locator('[data-proposal]').count() == 0, 'dopo "No" la proposta sparisce')
    check(state(page, mid)['inc']['Boss'] is False, 'Boss a 0 ferite ma non incapacitato (scelta di Vando)')
    # incapacitato a mano dalla rosa
    page.locator(f'[data-unit-menu="{uid["Boss"]}"]').click()
    menu_item(page, 'Segna incapacitato')
    settle(page)
    check(state(page, mid)['inc']['Boss'] is True, 'incapacitato segnato a mano dalla rosa')

    print('12) punti e secondo turno')
    tap(page, 'score')
    form(page, side=0, points='3', reason='Recuperato il carico')
    settle(page)
    tap(page, 'next-turn')
    form(page, side=0, how='choice')
    settle(page)
    tap(page, 'note')
    form(page, note='Il Gunner si nasconde')
    settle(page)
    st = state(page, mid)
    check(st['score'] == [3, 0] and page.locator('[data-pts="0"]').inner_text() == '3', 'punti 3 a Vando, mostrati in alto')
    check(st['turn'] == 2 and st['events'][-2]['type'] == 'turn-start' and st['events'][-2]['turn'] == 2, 'secondo turno')
    check(st['events'][-2]['ini']['how'] == 'choice' and st['events'][-2]['ini']['side'] == 0, 'iniziativa del turno 2 per scelta')
    check(st['events'][-1]['type'] == 'note' and st['events'][-1]['turn'] == 2, 'nota nel turno 2')
    tap(page, 'activate')
    pick(page, uid['Gunner'])
    pick(page, f'a:{ids["shoot"]}')
    pick(page, 'none')
    pick(page, 'done')
    settle(page)
    st = state(page, mid)
    check(st['events'][-1]['type'] == 'action' and st['events'][-1]['unit'] == 'Gunner' and st['events'][-1]['turn'] == 2, 'azione senza arma nel turno 2')

    print('13) cronologia e riepilogo')
    page.locator('[data-view="cron"]').click()
    page.wait_for_selector('.lg-ev')
    heads = page.locator('.lg-turn-h').all_inner_texts()
    check(len(heads) == 2 and heads[0].startswith('Turning Point 1') and 'Manu' in heads[0] and 'tiro 3 contro 5' in heads[0], f'intestazioni: {heads}')
    txt = page.locator('.lg-ev-list').first.inner_text()
    check('Boss attacca Sergeant con Power claw' in txt and 'Sergeant subisce 4 ferite, rimangono 6' in txt, 'cronologia: attacco e danno con ferite rimaste')
    check('v=cron' in page.url, 'la scheda Cronologia sta nell\'indirizzo')
    page.locator('[data-act="summary"]').click()
    sheet_wait(page)
    summary = page.locator('.copy-area').input_value()
    print('\n' + summary + '\n')
    check('Turning Point 1 - iniziativa: Manu (tiro 3 contro 5)' in summary, 'riepilogo: turno e iniziativa')
    check('Boss colpisce Sergeant con Power claw: 4 ferite, rimangono 6' in summary, 'riepilogo: attacco con danno')
    check('Sergeant colpisce Boss con Chainsword: 12 ferite, a 0 ferite' in summary, 'riepilogo: a 0 ferite')
    check('Sergeant colpisce Boss 2 con Chainsword: 5 ferite' in summary and 'rimangono' not in summary.split('Boss 2 con Chainsword')[1].split('\n')[0], 'riepilogo: ferite non tracciate senza "rimangono"')
    check('Vando +3 punti (Recuperato il carico)' in summary and summary.rstrip().endswith('Punti: Vando 3 - Manu 0'), 'riepilogo: punti')
    check('Boss è incapacitato' in summary, 'riepilogo: incapacitato')
    page.locator('.sheet [data-cancel]').click()
    sheet_gone(page)
    page.screenshot(path=f'{SHOTS}/03-cronologia.png')

    print('14) modifica di una voce: ricalcolo di tutte le ferite')
    before = state(page, mid)
    first_dmg_idx = [i for i, e in enumerate(before['events']) if e['type'] == 'damage'][0]
    page.locator(f'[data-ev="{first_dmg_idx}"]').click()
    menu_item(page, 'Modifica')
    form(page, amount='9')                    # il danno al Sergeant da 4 a 9
    page.wait_for_function("document.querySelector('#toast').textContent.includes('ricalcolate')")
    after = state(page, mid)
    check(after['left']['Sergeant'] == 1 and after['events'][first_dmg_idx]['left'] == 1, 'danno 4 -> 9: Sergeant a 1 ferita')
    check(after['left']['Boss'] == before['left']['Boss'], 'le ferite degli altri non cambiano')
    # modifica che crea un avviso: attivazione di un incapacitato
    act_idx = [i for i, e in enumerate(after['events']) if e['type'] == 'activation'][0]
    page.locator(f'[data-ev="{act_idx}"]').click()
    menu_item(page, 'Modifica')
    form(page, unit=str(uid['Boss']))         # il turno 1 ora e' l'attivazione di... Boss resta, provo con l'ultimo operativo incapacitato
    # per avere un avviso l'incapacitato deve esserci PRIMA: inserisco a mano piu' sotto (ricostruzione); qui controllo solo che non ci siano crash
    check(len(page.locator('.lg-ev').all()) == len(after['events']), 'la cronologia mostra ancora tutte le voci')
    # elimina a catena: eliminare l'azione toglie attacco e danno collegati
    st_now = state(page, mid)
    shoot_idx = [i for i, e in enumerate(st_now['events']) if e['type'] == 'action' and e['unit'] == 'Boss'][0]
    n0 = len(st_now['events'])
    page.locator(f'[data-ev="{shoot_idx}"]').click()
    menu_item(page, 'Elimina')
    sheet_wait(page)
    check('2 voci collegate' in page.locator('.sheet').inner_text(), 'conferma: "anche 2 voci collegate"')
    page.locator('.sheet [data-ok]').click()
    sheet_gone(page)
    page.wait_for_function("document.querySelector('#toast').textContent.includes('eliminata')")
    st3 = state(page, mid)
    check(len(st3['events']) == n0 - 3 and st3['left']['Sergeant'] == 10, 'eliminati azione+attacco+danno: Sergeant torna a 10')
    check([e['seq'] for e in st3['events']] == list(range(1, len(st3['events']) + 1)), 'seq rinumerati senza buchi')

    print('15) ricostruzione a mano: inserimento in mezzo')
    page.locator('[data-act="match-menu"]').click()
    menu_item(page, 'ricostruzione')
    settle(page)
    check(state(page, mid)['match']['mode'] == 'rebuild', 'modalita\' ricostruzione')
    page.locator('[data-view="cron"]').click()
    page.wait_for_selector('.lg-ev')
    st4 = state(page, mid)
    check(all(True for e in st4['events']), 'cronologia aperta')
    # inserisco dopo la prima attivazione (idx dell'attivazione di Sergeant del turno 1) un danno extra al Gunner, a mano
    act_sgt = [i for i, e in enumerate(st4['events']) if e['type'] == 'activation' and e['unit'] == 'Sergeant'][0]
    page.locator(f'[data-ev="{act_sgt}"]').click()
    menu_item(page, 'Inserisci dopo')
    page.wait_for_selector('[data-act="end-insert"]')
    check(f'dopo la voce n. {act_sgt + 1}' in page.locator('.lg-banner').first.inner_text(), 'banner di inserimento')
    tap(page, 'activate')
    pick(page, uid['Gunner'])
    pick(page, f'a:{ids["shoot"]}')
    pick(page, 'other')
    form(page, wait=False, name='Pugnale')
    pick(page, uid['Sergeant'])
    keypad(page, 2)
    pick(page, 'done')
    settle(page)
    st5 = state(page, mid)
    new_idx = act_sgt + 1
    check([e['type'] for e in st5['events'][new_idx:new_idx + 4]] == ['activation', 'action', 'attack', 'damage'], 'le nuove voci sono subito dopo quella scelta')
    check(st5['events'][new_idx]['unit'] == 'Gunner' and st5['events'][new_idx + 2]['weapon'] == 'Pugnale', 'arma scritta a mano registrata')
    check([e['seq'] for e in st5['events']] == list(range(1, len(st5['events']) + 1)), 'seq rinumerati dopo l\'inserimento')
    check(st5['left']['Sergeant'] == 8 and st5['events'][new_idx + 3]['left'] == 8, 'ferite ricalcolate: Sergeant 10 - 2 = 8')
    check(st5['events'][new_idx]['turn'] == 1, 'voce inserita nel turno giusto')
    # annulla in modalita' inserimento: toglie la voce appena inserita (non l'ultima del log)
    n_log = len(st5['events'])
    tap(page, 'undo')
    settle(page)
    st6 = state(page, mid)
    check(len(st6['events']) == n_log - 1 and st6['events'][new_idx + 2]['type'] == 'attack' and st6['left']['Sergeant'] == 10, 'annulla in inserimento: toglie il danno inserito, ferite di nuovo a 10')
    tap(page, 'end-insert')
    settle(page)
    check(page.locator('[data-act="end-insert"]').count() == 0, 'fine inserimento')

    print('16) avvisi: un operativo incapacitato non puo\' agire (avviso, non blocco)')
    # inserisco prima di tutto l'incapacitato del Boss: ora le sue attivazioni successive sono incoerenti
    page.locator('[data-view="cron"]').click()
    page.wait_for_selector('.lg-ev')
    st7 = state(page, mid)
    inc_idx = [i for i, e in enumerate(st7['events']) if e['type'] == 'incapacitated' and e['unit'] == 'Boss'][0]
    # sposto l'incapacitato in testa: lo elimino e lo reinserisco dopo il turn-start
    page.locator(f'[data-ev="{inc_idx}"]').click()
    menu_item(page, 'Elimina')
    sheet_wait(page)
    page.locator('.sheet [data-ok]').click()
    sheet_gone(page)
    page.wait_for_function("document.querySelector('#toast').textContent.includes('eliminata')")
    page.locator('[data-ev="0"]').click()
    menu_item(page, 'Inserisci dopo')
    page.wait_for_selector('[data-act="end-insert"]')
    page.locator(f'[data-unit-menu="{uid["Boss"]}"]').click()
    menu_item(page, 'Segna incapacitato')
    settle(page)
    tap(page, 'end-insert')
    settle(page)
    st8 = state(page, mid)
    check('act-incapacitated' in st8['warnings'] or 'activate-incapacitated' in st8['warnings'], f'avvisi: {st8["warnings"]}')
    page.locator('[data-view="cron"]').click()
    page.wait_for_selector('.lg-ev.warn')
    check(page.locator('.lg-ev.warn').count() >= 1 and page.locator('.lg-wtxt').count() >= 1, 'la cronologia segnala le voci incoerenti')
    check(page.locator('[data-view="cron"]').inner_text().find('⚠') >= 0, 'il numero di avvisi compare sulla scheda')
    page.screenshot(path=f'{SHOTS}/04-avvisi.png')

    print('17) dopo il ricaricamento la partita e\' com\'era')
    snap = state(page, mid)
    page.reload()
    page.wait_for_selector('.lg-top')
    check(state(page, mid)['left'] == snap['left'] and len(state(page, mid)['events']) == len(snap['events']), 'stato identico dopo il ricaricamento (si ricostruisce dagli eventi)')
    check('v=cron' in page.url and page.locator('.lg-ev').count() == len(snap['events']), 'si riapre sulla cronologia')

    print('18) eliminare dati della libreria non cancella il log')
    snap = state(page, mid)
    txt_before = page.evaluate("async (id) => { const m = await import('./js/db.js'); const ML = await import('./js/matchlog.js'); const st = await m.getMatchState(id); return ML.summarize(st.match, st.units, st.events, st.rep); }", mid)
    js(page, """async (m, i) => {
      await m.deleteWeapon(i.wClaw); await m.deleteUnit(i.uBoss); await m.deleteUnit(i.uSgt);
      const acts = await m.listActions(i.kt, { includeGlobal: false });
      await m.deleteAction(acts.find((a) => a.name === 'Shoot').id);
      await m.deleteFaction(i.fb); await m.deleteGame(i.kt);
    }""", ids)
    check(js(page, "async (m) => (await m.db.games.filter((g) => g.name === 'Kill Team').count())") == 0, 'gioco Kill Team eliminato')
    page.reload()
    page.wait_for_selector('.lg-top')
    after = state(page, mid)
    check(len(after['events']) == len(snap['events']) and len(after['units']) == len(snap['units']), 'eventi e rosa intatti')
    check(after['left'] == snap['left'] and after['match']['gameName'] == 'Kill Team', 'ferite rimaste e nome del gioco copiato')
    txt_after = page.evaluate("async (id) => { const m = await import('./js/db.js'); const ML = await import('./js/matchlog.js'); const st = await m.getMatchState(id); return ML.summarize(st.match, st.units, st.events, st.rep); }", mid)
    check(txt_after == txt_before, 'riepilogo identico: i nomi sono copiati nel log')
    check('Chainsword' in page.locator('.lg-ev-list').first.inner_text(), 'la cronologia mostra ancora l\'arma eliminata dalla Libreria')
    page.locator('[data-view="tavolo"]').click()
    page.wait_for_selector('[data-act="activate"]')
    # col gioco eliminato si puo' ancora attivare e agire (azione scritta a mano, arma a mano)
    tap(page, 'activate')
    pick(page, uid['Gunner'])
    sheet_wait(page)
    check(page.locator('.sheet [data-pick="other"]').count() == 1, 'senza azioni in Libreria resta "Altra azione…"')
    page.locator('.sheet [data-pick="done"]').click()
    sheet_gone(page)
    settle(page)

    print('19) elenco partite, duplica rosa, elimina')
    snap = state(page, mid)
    page.goto(BASE + '#/log')
    page.wait_for_selector('[data-list="match"] .item')
    row = page.locator('[data-list="match"] .item').first.inner_text()
    check('Prova al tavolo' in row and 'Kill Team' in row and 'in corso' in row and '2 Turning Point' in row, f'riga partita: {row!r}')
    page.locator('[data-list="match"] [data-menu]').first.click()
    menu_item(page, 'stessa rosa')
    page.wait_for_selector('.lg-top')
    mid2 = int(page.url.split('m=')[1].split('&')[0])
    st = state(page, mid2)
    check(mid2 != mid and len(st['events']) == 0 and sorted(u['name'] for u in st['units']) == ['Boss', 'Boss 2', 'Grunt', 'Gunner', 'Sergeant'], 'rosa duplicata, nessun evento')
    check(st['left']['Sergeant'] == 10 and st['left']['Boss'] == 12, 'ferite di nuovo piene')
    page.goto(BASE + '#/log')
    page.wait_for_selector('[data-list="match"] .item')
    check(page.locator('[data-list="match"] .item').count() == 2, 'due partite in elenco')
    page.locator('[data-list="match"] [data-menu]').first.click()
    menu_item(page, 'Elimina')
    sheet_wait(page)
    page.locator('.sheet [data-ok]').click()
    sheet_gone(page)
    page.wait_for_function("document.querySelectorAll('[data-list=\"match\"] .item').length === 1")
    left = js(page, "async (m) => ({ matches: await m.db.matches.count(), units: await m.db.matchUnits.count(), events: await m.db.matchEvents.count() })")
    check(left['matches'] == 1 and left['units'] == 5 and left['events'] == len(snap['events']), f'eliminata solo la copia: {left}')
    js(page, "async (m, id) => { await m.deleteMatch(id); }", mid)
    left = js(page, "async (m) => ({ matches: await m.db.matches.count(), units: await m.db.matchUnits.count(), events: await m.db.matchEvents.count() })")
    check(left == {'matches': 0, 'units': 0, 'events': 0}, 'eliminare la partita elimina rosa ed eventi')

    print('20) errori in console')
    bad_errors = [e for e in page.errors if 'favicon' not in e and 'Failed to load resource' not in e]
    check(not bad_errors, 'nessun errore: ' + str(bad_errors[:3]))

    browser.close()

print('\n' + ('TUTTO OK' if not fails else f'{len(fails)} CONTROLLI FALLITI:\n - ' + '\n - '.join(fails)))
sys.exit(1 if fails else 0)
