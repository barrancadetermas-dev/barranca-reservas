import sys
from datetime import datetime
from playwright.sync_api import sync_playwright
P=F=0
def t(name, cond, extra=''):
    global P,F
    if cond: P+=1; print('✅', name)
    else: F+=1; print('❌', name, str(extra)[:300])

def run(day):
    with sync_playwright() as p:
        b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1300,'height':1400}); pg=ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.clock.install(time=datetime.fromisoformat(f'2026-01-{day}T12:00:00'))
        pg.goto('http://localhost:5199/_dev/tests/harness/harness-dash.html'); pg.wait_for_function('window.__ready===true')
        pg.evaluate("window.dash.load()"); pg.wait_for_timeout(2500)
        out = {
          'staying': pg.evaluate("document.getElementById('dash-staying-card')?.innerText ?? ''"),
          'map': pg.evaluate("document.getElementById('dash-unit-map-card')?.innerText ?? ''"),
          'occ': pg.evaluate("document.getElementById('kpi-occupied-val')?.innerText ?? document.querySelector('[id*=occup]')?.innerText ?? ''"),
          'ci': pg.evaluate("document.getElementById('kpi-checkins-val-sec')?.innerText ?? ''"),
          'co': pg.evaluate("document.getElementById('kpi-checkouts-val-sec')?.innerText ?? ''"),
          'body': pg.evaluate("document.body.innerText"),
          'errs': errs,
        }
        b.close(); return out


def kpi(day):
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_context(viewport={'width':1300,'height':1400}).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.clock.install(time=datetime.fromisoformat(f'2026-01-{day}T12:00:00'))
        pg.goto('http://localhost:5199/_dev/tests/harness/harness-dash.html'); pg.wait_for_function('window.__ready===true')
        pg.evaluate("window.dash.load()"); pg.wait_for_timeout(2500)
        g = lambda sel: pg.evaluate(f"document.querySelector('{sel}')?.innerText?.replace(/\\s+/g,' ').trim() ?? ''")
        r = {'label': g('#kpi-guests .kpi-label'), 'val': g('#kpi-guests-val'), 'sec': g('#kpi-guests-sec'),
             'ci': g('#kpi-checkins-sec'), 'co': g('#kpi-checkouts-sec'), 'map': g('#dash-unit-map-card'), 'errs': errs}
        b.close(); return r

r10, r11, r12, r13 = kpi('10'), kpi('11'), kpi('12'), kpi('13')
t('10/01 · check-in del día: depto de LLEGADA (Depto 2)', 'Departamento 2' in r10['ci'] and 'Departamento 5' not in r10['ci'], r10['ci'])
t('11/01 · alojado en Departamento 2', r11['val']=='1' and 'Departamento 2' in r11['sec'] and 'Departamento 5' not in r11['sec'], r11)
t('11/01 · etiqueta por género (no binario, 1 persona) = "Alojade"', r11['label']=='Alojade', r11['label'])
t('11/01 · mapa: 1/3 ocupadas (solo el 2, no el 5)', '1/3 ocupadas' in r11['map'], r11['map'])
t('12/01 · cambió de depto: ahora en Departamento 5, sigue 1 ocupada', r12['val']=='1' and 'Departamento 5' in r12['sec'] and 'Departamento 2' not in r12['sec'] and '1/3 ocupadas' in r12['map'], r12)
t('13/01 · check-out del día: depto de SALIDA (Depto 5)', 'Departamento 5' in r13['co'] and 'Departamento 2' not in r13['co'], r13['co'])
t('sin errores de JS en ninguna fecha', not any(r['errs'] for r in (r10,r11,r12,r13)), [r['errs'] for r in (r10,r11,r12,r13)])
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
