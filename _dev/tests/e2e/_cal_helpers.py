"""Utilidades comunes de las pruebas del calendario (arnés harness-cal.html, servidor vite en :5199).
Uso:  npx vite --port 5199  y después  python3 _dev/tests/e2e/<prueba>.py"""
import sys
from datetime import datetime
from playwright.sync_api import sync_playwright

URL = 'http://localhost:5199/_dev/tests/harness/harness-cal.html'
COLORS = ['#ef4444', '#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']
UNITS = {f'D{i}': {'name': f'Unidad {i}', 'color': COLORS[i - 1], 'sort_order': i} for i in range(1, 8)}

class Report:
    def __init__(self): self.p = self.f = 0
    def t(self, name, cond, extra=''):
        if cond: self.p += 1; print('✅', name)
        else: self.f += 1; print('❌', name, str(extra)[:400])
    def done(self):
        print(f'\n{self.p} ok · {self.f} fallas'); sys.exit(1 if self.f else 0)

def bk(id, ci, co, last, unit, **kw):
    n = (datetime.fromisoformat(co) - datetime.fromisoformat(ci)).days
    d = {'id': id, 'check_in': ci, 'check_out': co, 'nights': n, 'status': 'partial', 'source': 'direct', 'is_blocked': False,
         'total_amount': 50000 * n, 'total_paid': 10000, 'balance': 50000 * n - 10000, 'pax': 2, 'adults': 2, 'children': 0,
         'price_per_night': 50000, 'guests': {'first_name': 'Ana', 'last_name': last, 'gender': None, 'tags': []},
         'booking_units': [{'unit_id': unit, 'price_per_night': 50000, 'segment_check_in': None, 'segment_check_out': None, 'units': UNITS[unit]}]}
    d.update(kw); return d

def open_calendar(p, bookings, today='2026-10-19', start='2026-10-18', units=None, width=1500, height=900):
    """Abre el arnés con reservas simuladas y devuelve (browser, page, errores_js)."""
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': width, 'height': height}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.clock.install(time=datetime.fromisoformat(today + 'T12:00:00'))
    pg.goto(URL); pg.wait_for_function('window.__ready===true')
    pg.add_style_tag(content='#login-screen,.ios-install-modal,[id*=ios]{display:none!important}')
    pg.evaluate("()=>{let e=document.getElementById('calendar-grid');while(e&&e!==document.body){e.classList.remove('hidden');if(getComputedStyle(e).display==='none')e.style.display='block';e=e.parentElement}}")
    us = units or list(UNITS)
    ul = [dict(id=k, name=UNITS[k]['name'], color=UNITS[k]['color'], sort_order=UNITS[k]['sort_order'], is_active=True, max_guests=4) for k in us]
    # se muta el array en el lugar: lo comparten AppContext.units y cal.ctx.units
    pg.evaluate("([a,u,s])=>{window.__units.length=0;window.__units.push(...u);window.__data={'bookings:select':a,'units':u,'payments:select':[]};window.cal._windowStart=s}", [bookings, ul, start])
    pg.evaluate("window.cal.load()"); pg.wait_for_timeout(2200)
    return b, pg, errs
