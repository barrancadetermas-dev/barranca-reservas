import sys
from datetime import datetime
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:300])
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':1300,'height':1400}).new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.clock.install(time=datetime.fromisoformat('2026-01-10T12:00:00'))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness-dash.html'); pg.wait_for_function('window.__ready===true')
    pg.evaluate("window.__booking.checked_in_at=null; window.__booking.balance=160000; window.__booking.total_paid=0; window.__booking.status='pending'")
    pg.evaluate("window.dash.load()"); pg.wait_for_timeout(2500)
    btn=pg.locator('[data-action="checkin"]').first
    t('el Dashboard muestra la llegada de hoy con su botón de check-in', btn.count()>=0 and pg.evaluate("document.querySelectorAll('[data-action=\"checkin\"]').length")>=1)
    pg.evaluate("window.__calls.length=0; window.__events.length=0")
    pg.evaluate("document.querySelectorAll('[data-action=\"checkin\"]')[0].click()"); pg.wait_for_timeout(1200)
    calls=pg.evaluate("window.__calls"); ups=[c for c in calls if c['table']=='bookings' and c['op']=='update']
    t('un clic = UN solo UPDATE de check-in', len(ups)==1, [c['table']+':'+c['op'] for c in calls])
    t('escribe únicamente checked_in_at (no altera saldo/pagos/estado)', ups and list(ups[0]['args'][0][1].keys())==['checked_in_at'], ups and ups[0]['args'])
    t('es condicional (solo si todavía no había check-in)', ups and any('is("checked_in_at",null)' in f for f in ups[0]['filters']), ups and ups[0]['filters'])
    t('no se crea ninguna reserva ni se toca la tabla de pagos', not [c for c in calls if c['op'] in ('insert','delete','upsert')] and not [c for c in calls if c['table']=='payments'], [c['table']+':'+c['op'] for c in calls])
    t('la tarjeta del Dashboard queda marcada como hecha', pg.evaluate("!!document.querySelector('.dac-done-label, .dac-done-badge')"))
    t('avisa a Calendario y demás pantallas (booking:changed)', pg.evaluate("window.__events.length")>=1)
    # La base rechaza (permisos): el Dashboard ya NO muestra éxito falso
    pg.evaluate("window.dash.load()"); pg.wait_for_timeout(2000)
    pg.evaluate("window.__updateRows=[]; window.__calls.length=0; document.getElementById('toast-container').innerHTML=''")
    n=pg.evaluate("document.querySelectorAll('[data-action=\"checkin\"]').length")
    if n:
        pg.evaluate("document.querySelectorAll('[data-action=\"checkin\"]')[0].click()"); pg.wait_for_timeout(1200)
        toast=pg.evaluate("document.getElementById('toast-container').innerText")
        t('si la base no registra el check-in: aviso de error y la tarjeta NO se marca hecha', '✅' not in toast and not pg.evaluate("!!document.querySelector('.dac-done-label')"), toast)
    else:
        t('(rama de rechazo) la tarjeta reaparece con botón', False, 'sin botón tras recarga')
    t('sin errores de JS', not errs, errs)
    b.close()
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
