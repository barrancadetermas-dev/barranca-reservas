"""Reservas de 2+ deptos (formulario real + base simulada): ajustes y huéspedes POR UNIDAD.
Criterios de aceptación: descuento/recargo/noche sin cargo a UN depto sin tocar el otro · distribución de adultos y niños ·
aviso si no suma · capacidad por depto · total consistente · se conserva al guardar y reabrir · reservas viejas sin cambios.
Requiere vite en :5199 (ver LEEME.md) y harness regenerado (regen_harness.py)."""
import sys, json
from playwright.sync_api import sync_playwright
P = F = 0
def t(n, c, x=''):
    global P, F
    if c: P += 1; print('✅', n)
    else: F += 1; print('❌', n, str(x)[:420])
B = 'http://localhost:5199/_dev/tests/harness/'
U = lambda i, n, c: {'name': n, 'color': c, 'sort_order': i}
def booking(units, **kw):
    bus = [{'unit_id': uid, 'price_per_night': pr, 'segment_check_in': None, 'segment_check_out': None, 'units': U(int(uid[1:]), f'Departamento {uid[1:]}', '#22c55e'), **extra} for uid, pr, extra in units]
    d = {'id': 'm1', 'check_in': '2026-10-21', 'check_out': '2026-10-25', 'nights': 4, 'price_per_night': sum(u[1] for u in units), 'discount_pct': 0, 'surcharge_amount': 0,
         'free_nights': 0, 'total_amount': 920000, 'total_paid': 50000, 'status': 'partial', 'source': 'family', 'notes': '', 'late_checkout': False,
         'adults': 4, 'children': 2, 'pax': 6, 'created_at': '2026-10-01T10:00:00Z', 'unit_pricing': False,
         'guests': {'id': 'G1', 'first_name': 'Familia', 'last_name': 'Pérez', 'dni': '1', 'gender': None},
         'booking_units': bus, 'payments': [{'id': 'p1', 'method': 'transfer', 'amount': 50000, 'amount_ars': 50000, 'payment_date': '2026-10-02', 'currency': 'ARS'}]}
    d.update(kw); return d
LEGACY = booking([('D2', 120000, {}), ('D3', 110000, {})])

def new_page(b, errors=None):
    pg = b.new_context(viewport={'width': 1100, 'height': 1300}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + 'harness.html'); pg.wait_for_function('window.__ready===true')
    return pg, errs
def load(pg, bk, errors=None):
    pg.evaluate("(a)=>{window.__calls.length=0;window.__errors=a.e||{};window.__data={'bookings:select':a.b,'payments:select':a.b.payments,'booking_units:select':[],'bookings:update':[{'id':a.b.id}],'guests:update':[{'id':'G1'}]};document.getElementById('toast-container').innerHTML=''}", {'b': bk, 'e': errors})
    pg.evaluate("form.openEdit('m1')"); pg.wait_for_timeout(900); pg.evaluate("form._goToStep(3)"); pg.wait_for_timeout(300)
calls = lambda pg: pg.evaluate("window.__calls")
txt = lambda pg, sel: pg.evaluate("(s)=>document.querySelector(s)?.innerText||''", sel)
toast = lambda pg: pg.evaluate("document.getElementById('toast-container').innerText").replace('\n', ' ')
def saved(pg):
    cs = calls(pg)
    bu = [c for c in cs if c['table'] == 'bookings' and c['op'] == 'update' and 'total_amount' in c['args'][0][1]]
    up = [c for c in cs if c['table'] == 'booking_units' and c['op'] == 'upsert']
    return (bu[-1]['args'][0][1] if bu else None), (up[-1]['args'][0][1] if up else None), cs
def open_all(pg): pg.evaluate("document.querySelectorAll('.ud-item').forEach(d => d.open = true)"); pg.wait_for_timeout(100)
def add_adj(pg, kind, unit=None, value=None, mode=None, reason=None, other=None, charged=None):
    """Agrega un ajuste con la pantalla de ajustes (tipo, a quién se aplica, valor, motivo)."""
    pg.click('[data-adj="add"]')
    pg.click(f'#adj-form [data-kind="{kind}"]')
    if unit: pg.select_option('#adj-target', unit)
    if mode: pg.click(f'#adj-form [data-mode="{mode}"]')
    if value is not None: pg.fill('#adj-value', str(value))
    if charged is False: pg.uncheck('#adj-charged')
    if reason: pg.click(f'#adj-form [data-reason="{reason}"]')
    if other: pg.fill('#adj-other', other)
    pg.click('[data-adj="save"]'); pg.wait_for_timeout(250)
adj_rows = lambda pg: pg.evaluate("[...document.querySelectorAll('.adj-li:not(.adj-h)')].map(r=>r.innerText.replace(/\\s+/g,' ').trim())")
adj_ins = lambda pg: [c for c in calls(pg) if c['table'] == 'booking_adjustments' and c['op'] == 'insert']

with sync_playwright() as p:
    b = p.chromium.launch()

    # ── 1. Reserva VIEJA de 2 deptos: sin cambios ─────────────────────────────
    pg, errs = new_page(b); load(pg, LEGACY)
    t('2 deptos: aparece la lista de ajustes y "Distribución por unidad"', pg.is_visible('#adj-wrap') and pg.is_visible('[data-adj="add"]') and pg.is_visible('#unit-dist-wrap'))
    t('el depósito de garantía ya no se pide en la pantalla', pg.locator('#f-deposit:visible').count() == 0)
    t('total idéntico al de siempre (920.000)', '920.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    t('sin distribución cargada: "sin distribuir" y sin advertencias', 'sin distribuir' in txt(pg, '#ud-chips') and pg.locator('.ud-alert').count() == 0)
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200)
    bk, up, cs = saved(pg)
    t('guardar sin tocar: total 920000 y unit_pricing=false (la fórmula de siempre)', bk and bk['total_amount'] == 920000 and bk.get('unit_pricing') is False and bk.get('unit_pricing_total') is None, bk)
    t('cada depto conserva su precio y no se inventan ajustes', up and {r['unit_id']: r['price_per_night'] for r in up} == {'D2': 120000, 'D3': 110000} and all((r.get('discount_pct') or 0) == 0 and (r.get('surcharge_amount') or 0) == 0 and (r.get('free_nights') or 0) == 0 for r in up), up)
    t('sin errores de JS (reserva vieja)', not errs, errs)

    # ── 2. CRITERIO: descuento a UN depto ─────────────────────────────────────
    pg, errs = new_page(b); load(pg, LEGACY)
    add_adj(pg, 'discount', 'D2', 10, reason='Atención comercial')
    t('descuento 10% solo al depto 2 → total 872.000 (el depto 3 no cambia)', '872.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    t('la tabla por unidad muestra D2 con descuento y D3 sin tocar', '432.000' in txt(pg, '#ud-table') and '440.000' in txt(pg, '#ud-table'), txt(pg, '#ud-table'))
    t('queda identificado en la lista: a qué depto, el valor y el motivo', any('Departamento 2' in r and '10 %' in r and 'Atención comercial' in r for r in adj_rows(pg)), adj_rows(pg))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200)
    bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('se guarda: total 872000 + unit_pricing=true + total propio para el trigger', bk and bk['total_amount'] == 872000 and bk['unit_pricing'] is True and bk['unit_pricing_total'] == 872000, bk)
    ins = adj_ins(pg)
    t('el ajuste se guarda en booking_adjustments con su motivo y su depto', ins and ins[-1]['args'][0][1][0]['kind'] == 'discount' and ins[-1]['args'][0][1][0]['unit_id'] == 'D2' and ins[-1]['args'][0][1][0]['reason'] == 'Atención comercial', ins and ins[-1]['args'])
    t('descuento SOLO en la fila del depto 2 (10%); el colectivo queda en 0', ru.get('D2', {}).get('discount_pct') == 10 and (ru.get('D3', {}).get('discount_pct') or 0) == 0 and (bk or {}).get('discount_pct') == 0, (up, bk and bk.get('discount_pct')))
    t('sin errores de JS (descuento por unidad)', not errs, errs)

    # ── 3. CRITERIO: recargo individual (monto y %) ───────────────────────────
    pg, errs = new_page(b); load(pg, LEGACY)
    add_adj(pg, 'surcharge', 'D3', 30000, mode='amt', reason='Mascota')
    t('recargo $30.000 solo al depto 3 → total 950.000', '950.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('recargo guardado solo en el depto 3', ru.get('D3', {}).get('surcharge_amount') == 30000 and (ru.get('D2', {}).get('surcharge_amount') or 0) == 0 and (bk or {}).get('surcharge_amount') == 0, (up, bk))
    t('sin errores de JS (recargo por unidad)', not errs, errs)

    # ── 4. CRITERIO: noche sin cargo en un depto, el otro todo pago ───────────
    pg, errs = new_page(b); load(pg, LEGACY)
    add_adj(pg, 'free_nights', 'D2', 1, reason='Cumpleaños')
    t('1 noche sin cargo solo en depto 2 → total 800.000', '800.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    t('las noches de la estadía siguen siendo 4', '4 noches' in txt(pg, '#pb-nights'), txt(pg, '#pb-nights'))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('noche sin cargo guardada solo en D2; colectiva = 0; fechas intactas', ru.get('D2', {}).get('free_nights') == 1 and (ru.get('D3', {}).get('free_nights') or 0) == 0 and (bk or {}).get('free_nights') == 0 and bk.get('check_in') == '2026-10-21' and bk.get('check_out') == '2026-10-25', (up, bk))
    t('sin errores de JS (noche sin cargo por unidad)', not errs, errs)

    # ── 5. Varios ajustes: colectivo + de un depto, editar y borrar ───────────
    pg, errs = new_page(b); load(pg, LEGACY)
    add_adj(pg, 'discount', None, 5, reason='Cliente frecuente')
    add_adj(pg, 'discount', 'D2', 10, reason='Otro', other='Vecino del barrio')
    t('5% a toda la reserva + 10% al depto 2 → D2 15%, D3 5% (total 826.000)', '826.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    t('la lista muestra los 2 descuentos con su motivo (el "Otro" con su texto)', len(adj_rows(pg)) == 2 and any('Vecino del barrio' in r for r in adj_rows(pg)), adj_rows(pg))
    pg.click('.adj-li:nth-child(3) [data-adj="edit"]'); pg.fill('#adj-value', '20'); pg.click('[data-adj="save"]'); pg.wait_for_timeout(250)
    t('editar un ajuste: 20% al depto 2 → D2 25% (total 480000×.75 + 440000×.95 = 778.000)', '778.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    pg.click('.adj-li:nth-child(3) [data-adj="del"]'); pg.wait_for_timeout(250)
    t('borrar un ajuste: queda solo el 5% (total 920000×.95 = 874.000)', '874.000' in txt(pg, '#pb-total') and len(adj_rows(pg)) == 1, (txt(pg, '#pb-total'), adj_rows(pg)))
    add_adj(pg, 'discount', 'D3', 10); add_adj(pg, 'discount', 'D3', 5)
    t('D3: 10% + 5% propios + 5% colectivo = 20% → 440000×.8 = 352000 (total 480000×.95 + 352000 = 808.000)', '808.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    pg.click('#adj-wrap [data-adj="add"]'); pg.click('#adj-form [data-kind="discount"]'); pg.click('[data-adj="save"]')
    t('validación: no deja guardar un ajuste sin valor', 'valor' in txt(pg, '#adj-err').lower(), txt(pg, '#adj-err'))
    pg.click('[data-adj="cancel"]')
    t('sin errores de JS (varios ajustes)', not errs, errs)

    # ── 5b. Late check-out POR DEPTO ──────────────────────────────────────────
    pg, errs = new_page(b); load(pg, LEGACY)
    add_adj(pg, 'late_checkout', 'D3', 55000, reason='Late check-out')
    t('late check-out solo en el depto 3 ($55.000) → total 975.000', '975.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('late guardado por depto: D3 sí ($55.000, se cobra) y D2 no; la reserva marca late', ru.get('D3', {}).get('late_checkout') is True and ru.get('D3', {}).get('late_checkout_amount') == 55000 and ru.get('D2', {}).get('late_checkout') is False and bk.get('late_checkout') is True, (up, bk and bk.get('late_checkout')))
    t('el total de la reserva incluye el late del depto 3 (975000) y pasa a precios por unidad', bk and bk['total_amount'] == 975000 and bk['unit_pricing'] is True, bk)
    pg, errs = new_page(b); load(pg, LEGACY)
    add_adj(pg, 'late_checkout', 'D2', None, charged=False)
    t('late SIN cargo en un depto no cambia el precio (920.000)', '920.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('late sin cargo: D2 con late_checkout y charged=false', ru.get('D2', {}).get('late_checkout') is True and ru.get('D2', {}).get('late_checkout_charged') is False, up)
    t('sin errores de JS (late por depto)', not errs, errs)

    # ── 5c. Reservas viejas → lista; guardadas con motivo → se recuperan ──────
    vieja = booking([('D2', 120000, {}), ('D3', 110000, {})], free_nights=1, discount_pct=10, surcharge_amount=5000, total_amount=3 * 230000 * 0.9 + 5000)
    pg, errs = new_page(b); load(pg, vieja)
    t('reserva VIEJA con descuento, noche sin cargo y recargo: se ve como 3 ajustes de toda la reserva', len(adj_rows(pg)) == 3 and all('Toda la reserva' in r for r in adj_rows(pg)), adj_rows(pg))
    t('y el total no cambia (3 noches × 230000 × 0,9 + 5000 = 626.000)', '626.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    guardada = booking([('D2', 120000, {}), ('D3', 110000, {})], total_amount=872000, unit_pricing=True)
    pg, errs = new_page(b)
    pg.evaluate("(a)=>{window.__calls.length=0;window.__errors={};window.__data={'bookings:select':a,'payments:select':a.payments,'booking_units:select':[],'bookings:update':[{'id':a.id}],'guests:update':[{'id':'G1'}],'booking_adjustments:select':[{id:'u1',unit_id:'D2',kind:'discount',mode:'pct',value:10,charged:true,reason:'Atención comercial',sort_order:0},{id:'u2',unit_id:null,kind:'surcharge',mode:'amt',value:15000,charged:true,reason:'Pago con tarjeta fuera de término',sort_order:1}]}}", guardada)
    pg.evaluate("form.openEdit('m1')"); pg.wait_for_timeout(1000); pg.evaluate("form._goToStep(3)"); pg.wait_for_timeout(300)
    t('reserva con ajustes guardados: se recuperan con su motivo (incluso el "Otro")', any('Atención comercial' in r for r in adj_rows(pg)) and any('Pago con tarjeta fuera de término' in r for r in adj_rows(pg)), adj_rows(pg))
    t('sin errores de JS (recuperar ajustes)', not errs, errs)

    # ── 6. CRITERIOS: distribución, suma y capacidad ──────────────────────────
    pg, errs = new_page(b); load(pg, LEGACY); open_all(pg)
    pg.fill('.ud-in[data-uid="D2"][data-f="adults"]', '3'); pg.fill('.ud-in[data-uid="D2"][data-f="children"]', '0')
    pg.fill('.ud-in[data-uid="D3"][data-f="adults"]', '1'); pg.fill('.ud-in[data-uid="D3"][data-f="children"]', '2'); pg.wait_for_timeout(250)
    t('3+1 adultos y 0+2 niños: coincide con el total (4 y 2) sin advertencias', pg.locator('.ud-alert').count() == 0 and 'Adultos 4/4' in txt(pg, '#ud-chips') and 'Niños 2/2' in txt(pg, '#ud-chips'), (txt(pg, '#ud-chips'), txt(pg, '#ud-warn')))
    pg.fill('.ud-in[data-uid="D3"][data-f="adults"]', '0'); pg.wait_for_timeout(250)
    t('si la suma no coincide: advertencia clara ("falta ubicar 1")', 'falta ubicar 1' in txt(pg, '#ud-warn'), txt(pg, '#ud-warn'))
    pg.fill('.ud-in[data-uid="D3"][data-f="adults"]', '1')
    pg.fill('.ud-in[data-uid="D2"][data-f="adults"]', '5'); pg.wait_for_timeout(250)
    t('capacidad: 5 personas en un depto de 4 → advertencia de capacidad', 'supera su capacidad' in txt(pg, '#ud-warn'), txt(pg, '#ud-warn'))
    pg.fill('.ud-in[data-uid="D2"][data-f="adults"]', '3'); pg.wait_for_timeout(200)
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
    pg.fill('.ud-in[data-uid="D3"][data-f="adults"]', '0'); pg.wait_for_timeout(200)
    pg.click('#btn-save-now'); pg.wait_for_timeout(800)
    t('guardar con la suma desparejada pide confirmación; si cancelás NO se escribe nada', dialogs and 'falta ubicar' in dialogs[0] and not [c for c in calls(pg) if c['op'] in ('update', 'upsert', 'insert')], (dialogs, [c['table'] + ':' + c['op'] for c in calls(pg)]))
    t('sin errores de JS (distribución)', not errs, errs)

    # ── 7. Guardar la distribución y reabrir: se conserva ─────────────────────
    pg, errs = new_page(b); load(pg, LEGACY); open_all(pg)
    for uid, a, c in (('D2', 3, 0), ('D3', 1, 2)):
        pg.fill(f'.ud-in[data-uid="{uid}"][data-f="adults"]', str(a)); pg.fill(f'.ud-in[data-uid="{uid}"][data-f="children"]', str(c))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('distribución guardada por depto (3+0 / 1+2) en booking_units', ru.get('D2', {}).get('adults') == 3 and ru.get('D2', {}).get('children') == 0 and ru.get('D3', {}).get('adults') == 1 and ru.get('D3', {}).get('children') == 2, up)
    t('con solo distribución (sin ajustes de precio) la reserva NO pasa a precios por unidad', bk and bk.get('unit_pricing') is False and bk['total_amount'] == 920000, bk)
    stored = booking([('D2', 120000, {'adults': 3, 'children': 0, 'free_nights': 1, 'discount_pct': 10, 'surcharge_amount': 0}), ('D3', 110000, {'adults': 1, 'children': 2, 'free_nights': 0, 'discount_pct': 0, 'surcharge_amount': 0})],
                     unit_pricing=True, total_amount=764000)
    pg, errs = new_page(b); load(pg, stored)
    t('reabrir (recarga): total 764.000 = D2 324.000 + D3 440.000', '764.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    t('reabrir: distribución y chips conservados (4/4 y 2/2)', pg.input_value('.ud-in[data-uid="D2"][data-f="adults"]') == '3' and 'Adultos 4/4' in txt(pg, '#ud-chips'), txt(pg, '#ud-chips'))
    t('reabrir: lo de cada depto sigue identificado', 'Departamento 2' in txt(pg, '#ud-table') and '324.000' in txt(pg, '#ud-table'), txt(pg, '#ud-table'))
    t('sin errores de JS (reabrir)', not errs, errs)

    # ── 7b. Nombre propio de cada depto dentro de la reserva ──────────────────
    pg, errs = new_page(b); load(pg, LEGACY); open_all(pg)
    pg.click('[data-adj="add"]')   # abre el formulario de ajuste: su selector de depto muestra el nombre propio
    pg.fill('.ud-lbl[data-uid="D2"]', 'Depto de los abuelos'); pg.fill('.ud-lbl[data-uid="D3"]', 'Los primos'); pg.wait_for_timeout(250)
    t('el nombre propio aparece en el encabezado del depto', 'Depto de los abuelos' in txt(pg, '.ud-name[data-uid="D2"]'), txt(pg, '.ud-name[data-uid="D2"]'))
    t('y en el selector de "A quién se aplica" (sin perder el foco al escribir)', 'Los primos' in pg.evaluate("[...document.querySelectorAll('#adj-target option')].map(o=>o.textContent).join('|')"))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('el nombre se guarda por depto (label) en booking_units', ru.get('D2', {}).get('label') == 'Depto de los abuelos' and ru.get('D3', {}).get('label') == 'Los primos', up)
    t('poner nombres NO cambia el precio (sigue 920.000, sin precios por unidad)', bk and bk['total_amount'] == 920000 and bk.get('unit_pricing') is False, bk)
    named = booking([('D2', 120000, {'label': 'Depto de los abuelos'}), ('D3', 110000, {'label': 'Los primos'})])
    pg, errs = new_page(b); load(pg, named); open_all(pg)
    t('reabrir: el nombre propio se conserva', pg.input_value('.ud-lbl[data-uid="D2"]') == 'Depto de los abuelos' and pg.input_value('.ud-lbl[data-uid="D3"]') == 'Los primos')
    pg.fill('.ud-lbl[data-uid="D3"]', ''); pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg); ru = {r['unit_id']: r for r in (up or [])}
    t('borrar el nombre lo limpia (null)', ru.get('D3', {}).get('label') is None and ru.get('D2', {}).get('label') == 'Depto de los abuelos', up)
    t('sin errores de JS (nombre por depto)', not errs, errs)

    # ── 7c. Edición rápida: abre directo en Precios; detalle con saldo por unidad ──
    stored2 = booking([('D2', 120000, {'adults': 3, 'children': 0, 'free_nights': 1, 'discount_pct': 10, 'surcharge_amount': 0, 'label': 'Depto de los abuelos'}), ('D3', 110000, {'adults': 1, 'children': 2, 'free_nights': 0, 'discount_pct': 0, 'surcharge_amount': 0, 'label': 'Los primos'})],
                       unit_pricing=True, total_amount=764000)
    pg, errs = new_page(b)
    pg.evaluate("(a)=>{window.__calls.length=0;window.__errors={};window.__data={'bookings:select':a,'payments:select':a.payments,'booking_units:select':[]}}", stored2)
    pg.evaluate("form.openEdit('m1', { step: 3 })"); pg.wait_for_timeout(1200)
    t('edición rápida: abre directo en el paso 3 (Precios)', pg.evaluate("form._currentStep") == 3 and pg.is_visible('#unit-dist-wrap'), pg.evaluate("form._currentStep"))
    pg.evaluate("(a)=>form.openDetail(a)", stored2); pg.wait_for_timeout(600)
    body = pg.evaluate("document.getElementById('detail-body').innerText")
    t('detalle: bloque "Saldo por unidad" con el nombre propio de cada depto', 'saldo por unidad' in body.lower() and 'Depto de los abuelos' in body and 'Los primos' in body, body[:600])
    t('detalle: el pago general ($50.000) se reparte proporcional → saldos 302.796 y 411.204', '302.796' in body and '411.204' in body, body[-500:])
    t('sin errores de JS (edición rápida y saldo por unidad)', not errs, errs)

    # ── 7d. Motivos: detalle, resumen y voucher ───────────────────────────────
    con_adj = booking([('D2', 120000, {}), ('D3', 110000, {})], total_amount=872000, unit_pricing=True,
                      booking_adjustments=[{'unit_id': 'D2', 'kind': 'discount', 'mode': 'pct', 'value': 10, 'charged': True, 'reason': 'Atención comercial', 'sort_order': 0}])
    pg, errs = new_page(b)
    pg.evaluate("(a)=>{window.__data={'bookings:select':a,'payments:select':a.payments,'booking_units:select':[]}}", con_adj)
    pg.evaluate("(a)=>form.openDetail(a)", con_adj); pg.wait_for_timeout(600)
    body = pg.evaluate("document.getElementById('detail-body').innerText")
    t('detalle: cada ajuste con su monto y su MOTIVO', 'Atención comercial' in body and '48.000' in body and 'DESCUENTO' in body.upper(), body[:700])
    pg2, errs2 = new_page(b); load(pg2, LEGACY)
    add_adj(pg2, 'discount', 'D2', 10, reason='Promo'); add_adj(pg2, 'surcharge', None, 5000, mode='amt', reason='Otro', other='Pago con tarjeta')
    summ = pg2.evaluate("form._adjSummaryHTML()")
    t('resumen del paso 5: lista los ajustes con su motivo (incluido el texto de "Otro")', 'Promo' in summ and 'Pago con tarjeta' in summ and 'Departamento 2' in summ, summ)
    t('sin errores de JS (motivos)', not errs and not errs2, (errs, errs2))

    # ── 8. Una sola unidad: nada nuevo en pantalla ────────────────────────────
    one = booking([('D2', 120000, {})], price_per_night=120000, total_amount=480000, adults=2, children=0, pax=2)
    pg, errs = new_page(b); load(pg, one)
    t('1 depto: lista de ajustes SIN selector de depto, y sin distribución', pg.locator('[data-adj="add"]').count() == 1 and not pg.is_visible('#unit-dist-wrap'))

    t('1 depto: total de siempre', '480.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg)
    t('1 depto: se guarda igual que antes (unit_pricing=false)', bk and bk['total_amount'] == 480000 and bk.get('unit_pricing') is False, bk)
    pg, errs = new_page(b); load(pg, one)
    add_adj(pg, 'discount', None, 10, reason='Promo')
    t('1 depto: descuento 10% sobre 480.000 → 432.000', '432.000' in txt(pg, '#pb-total'), txt(pg, '#pb-total'))
    pg.click('#btn-save-now'); pg.wait_for_timeout(1200); bk, up, cs = saved(pg)
    t('1 depto: el descuento va a la reserva (discount_pct 10), sin precios por unidad, y el motivo queda en booking_adjustments', bk and bk['total_amount'] == 432000 and bk['discount_pct'] == 10 and bk.get('unit_pricing') is False and adj_ins(pg) and adj_ins(pg)[-1]['args'][0][1][0]['reason'] == 'Promo', bk)

    # ── 9. Sin la migración: no se pierde nada en silencio ────────────────────
    pg, errs = new_page(b)
    load(pg, LEGACY, errors={'booking_units:select': {'message': 'column booking_units.adults does not exist'}})
    add_adj(pg, 'discount', 'D2', 10)
    pg.click('#btn-save-now'); pg.wait_for_timeout(1000)
    t('base SIN migración + ajuste por unidad: avisa y NO guarda a medias', 'migración multiunidad' in toast(pg) and not [c for c in calls(pg) if c['op'] in ('update', 'upsert', 'insert')], (toast(pg), [c['table'] + ':' + c['op'] for c in calls(pg)]))
    b.close()
print(f'\n{P} ok · {F} fallas'); sys.exit(1 if F else 0)
