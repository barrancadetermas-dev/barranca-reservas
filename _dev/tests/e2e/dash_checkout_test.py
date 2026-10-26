"""Panel de Hoy → check-out: antes de la corrección rompía con "Error: notas is not defined" DESPUÉS de registrar el check-out
(no refrescaba la pantalla ni sonaba). Ahora avisa bien, refresca y crea la tarea de limpieza."""
import sys
from datetime import datetime
from playwright.sync_api import sync_playwright
P = F = 0
def t(n, c, x=''):
    global P, F
    if c: P += 1; print('✅', n)
    else: F += 1; print('❌', n, str(x)[:300])
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1300, 'height': 1000}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.install(time=datetime.fromisoformat('2026-01-13T12:00:00'))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness-dash.html'); pg.wait_for_function('window.__ready===true')
    pg.evaluate("window.dash.load()"); pg.wait_for_timeout(2000)
    pg.evaluate("window.__toasts=[];document.addEventListener('show:toast',e=>window.__toasts.push(e.detail));window.__events.length=0;window.__calls.length=0")
    pg.evaluate("window._dashCheckOut('b1234','row-x','Juan Pérez')"); pg.wait_for_timeout(1200)
    toasts = pg.evaluate("window.__toasts"); msgs = ' | '.join(x['msg'] for x in toasts)
    t('el aviso es de éxito (no "Error: notas is not defined")', toasts and toasts[-1]['type'] == 'success' and 'Check-out registrado' in msgs and 'notas' not in msgs, msgs)
    t('avisa la tarea de limpieza', 'Tarea de limpieza' in msgs, msgs)
    t('refresca la pantalla (booking:changed)', 'changed' in pg.evaluate("window.__events"), pg.evaluate("window.__events"))
    ops = [(c['table'], c['op']) for c in pg.evaluate("window.__calls")]
    t('registra el check-out y crea la tarea de limpieza', ('bookings', 'update') in ops and ('cleaning_tasks', 'insert') in ops, ops)
    t('sin errores de JS', not errs, errs); b.close()
print(f'\n{P} ok · {F} fallas'); sys.exit(1 if F else 0)
