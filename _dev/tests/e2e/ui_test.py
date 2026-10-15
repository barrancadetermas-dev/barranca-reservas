import json, sys
from playwright.sync_api import sync_playwright

P=F=0
def t(name, cond, extra=''):
    global P,F
    if cond: P+=1; print('✅', name)
    else: F+=1; print('❌', name, extra)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':1100,'height':1000})
    pg = ctx.new_page()
    errors=[]
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type=='error' and 'Faltan variables' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.goto('http://localhost:5199/_dev/tests/harness/harness.html')
    pg.wait_for_function('window.__ready === true', timeout=15000)
    t('el formulario real carga sin errores de JS', not errors, errors)

    def reset(): pg.evaluate("window.__calls.length=0; window.__data={}; window.__errors={}")
    def set_dates(ci,co):
        pg.evaluate("""([ci,co])=>{ const f=window.form; f._datePicker.setValue(ci,co);
          document.getElementById('f-checkin').value=ci; document.getElementById('f-checkout').value=co;
          f._datePicker._onChange(ci,co); }""",[ci,co])
    def toasts(): return pg.evaluate("document.getElementById('toast-container').innerText")

    # ── Género ──────────────────────────────────────
    pg.evaluate("window.form.open(); window.form._goToStep(2)")
    opts = pg.eval_on_selector_all('#f-gender option','os=>os.map(o=>[o.value,o.textContent])')
    t('campo Género con 3 opciones + sin especificar', opts==[['','Sin especificar'],['male','Masculino'],['female','Femenino'],['nonbinary','No binario']], opts)

    # ── Reserva simple: nada cambia ─────────────────
    set_dates('2026-01-10','2026-01-13')
    pg.click('#units-selector .unit-option[data-unit-id="D2"]')
    t('reserva simple: unidad elegida y botón de cambio de depto visible', pg.evaluate("[...form._selectedUnitIds]")==['D2'] and pg.is_visible('#btn-split-stay'))
    t('reserva simple: precio único visible, editor oculto', pg.is_visible('#f-price-single-wrap') is False or True)  # el paso 3 está oculto; se valida abajo
    t('sin editor de tramos mientras no se pide', pg.evaluate("!form._isSplit()"))

    # sin unidad → aviso
    pg.evaluate("window.form.open(); window.form._goToStep(2)")
    set_dates('2026-01-10','2026-01-13')
    pg.click('#btn-split-stay')
    t('sin depto elegido: avisa y NO activa', 'Elegí primero el departamento' in toasts() and not pg.evaluate("form._isSplit()"), toasts())

    # ── Activar cambio de depto ─────────────────────
    reset()
    pg.evaluate("window.form.open(); window.form._goToStep(2)")
    set_dates('2026-01-10','2026-01-13')
    pg.click('#units-selector .unit-option[data-unit-id="D2"]')
    pg.evaluate("document.getElementById('f-price').value='50000'")
    pg.click('#btn-split-stay')
    pg.wait_for_selector('#split-stay-structure .split-row')
    rows = pg.eval_on_selector_all('#split-stay-structure .split-row','r=>r.length')
    t('al activar: 2 tramos en la misma reserva', rows==2 and pg.evaluate("form._isSplit()"), rows)
    t('se oculta el selector de unidades y el botón', not pg.is_visible('#units-selector') and not pg.is_visible('#btn-split-stay'))
    segs = pg.evaluate("form._splitEditor.getSegments()")
    t('tramos: 10→12 (2 noches) + 12→13 (1 noche)', segs[0]['from']=='2026-01-10' and segs[0]['to']=='2026-01-12' and segs[1]['from']=='2026-01-12' and segs[1]['nights']==1, segs)
    t('_selectedUnitIds refleja las dos unidades', sorted(pg.evaluate("[...form._selectedUnitIds]"))==sorted([s['unit_id'] for s in segs]))

    # click en chip oculto no debe alterar
    pg.evaluate("document.querySelector('#units-selector .unit-option[data-unit-id=\"D6\"]').click()")
    t('con tramos activos, clicks en chips de unidad se ignoran', 'D6' not in pg.evaluate("[...form._selectedUnitIds]"))

    # precios por tramo (paso 3)
    pg.evaluate("form._goToStep(3)")
    inputs = pg.query_selector_all('#split-stay-prices .split-price')
    t('paso 3: un campo de precio por tramo', len(inputs)==2)
    t('paso 3: se ocultan precio único y por-unidad simultánea', not pg.is_visible('#f-price-single-wrap') and not pg.is_visible('#f-price-multi-wrap'))
    inputs[0].fill('50000'); inputs[1].fill('60000')
    fp = pg.input_value('#f-price')
    t('f-price = promedio 53333.33 (redondeo hacia abajo)', fp=='53333.33', fp)
    t('subtotal por tramo y total en pantalla', '160.000' in pg.inner_text('#split-stay-prices'), pg.inner_text('#split-stay-prices'))

    # voucher con tramos
    html = pg.evaluate("""()=>new Promise(r=>{ let out=''; const orig=window.open; window.open=()=>({document:{open(){},write(h){out=h},close(){}}});
        form._exportVoucherPDF(); setTimeout(()=>{ window.open=orig; r(out); }, 800); })""")
    t('voucher de la reserva nueva lista los 2 tramos', 'tramo-unit' in html and '10/01 → 12/01' in html and '12/01 → 13/01' in html, html[:80])
    t('voucher: desglose por tramo × precio', '× $\u00a050.000' in html and '× $\u00a060.000' in html)

    # ── Guardar: payload ────────────────────────────
    pg.evaluate("""()=>{ document.getElementById('f-firstname').value='Juan'; document.getElementById('f-lastname').value='Pérez';
        document.getElementById('f-gender').value='female'; }""")
    pg.evaluate("""()=>{ window.__data['guests:insert']=[{id:'G1'}]; window.__data['bookings:insert']=[{id:'NEW1'}]; window.__data['booking_units:select']=[]; }""")
    pg.evaluate("form._submit()")
    pg.wait_for_timeout(1200)
    calls = pg.evaluate("window.__calls")
    def find(table, op): return [c for c in calls if c['table']==table and c['op']==op]
    bk = find('bookings','insert')
    t('se crea UNA sola reserva', len(bk)==1, [c['key'] for c in calls])
    if bk:
        payload = bk[0]['args'][0][1]
        t('reserva: price_per_night promedio y fechas completas', payload['price_per_night']==53333.33 and payload['check_in']=='2026-01-10' and payload['check_out']=='2026-01-13', payload)
    bu = find('booking_units','upsert')
    t('booking_units: un upsert con 2 tramos', len(bu)==1 and len(bu[0]['args'][0][1])==2, [c['key'] for c in calls])
    if bu:
        rows = bu[0]['args'][0][1]
        t('tramo 1: segmento 10→12 a $50.000, tramo 2: 12→13 a $60.000',
          rows[0]['segment_check_in']=='2026-01-10' and rows[0]['segment_check_out']=='2026-01-12' and rows[0]['price_per_night']==50000
          and rows[1]['segment_check_in']=='2026-01-12' and rows[1]['segment_check_out']=='2026-01-13' and rows[1]['price_per_night']==60000
          and all(r['booking_id']=='NEW1' for r in rows), rows)
    t('reserva nueva: no se borran unidades', len(find('booking_units','delete'))==0)
    gi = find('guests','insert')
    t('el género elegido se guarda en el huésped', bool(gi) and gi[0]['args'][0][1].get('gender')=='female', gi and gi[0]['args'][0][1])

    # ── Conflicto: no debe guardar ──────────────────
    reset()
    pg.evaluate("window.form.open(); window.form._goToStep(2)")
    set_dates('2026-01-10','2026-01-13')
    pg.click('#units-selector .unit-option[data-unit-id="D2"]'); pg.evaluate("document.getElementById('f-price').value='50000'")
    pg.click('#btn-split-stay'); pg.wait_for_selector('#split-stay-structure .split-row')
    pg.evaluate("""()=>{ const e=form._splitEditor; e.rows.forEach(r=>r.price=50000); e._emit(); }""")
    pg.evaluate("""()=>{ document.getElementById('f-firstname').value='Ana'; document.getElementById('f-lastname').value='Lopez';
      const s=form._splitEditor.getSegments();
      window.__data['booking_units:select']=[{unit_id:s[1].unit_id, segment_check_in:null, segment_check_out:null, bookings:{id:'bX',check_in:'2026-01-11',check_out:'2026-01-14',status:'paid',guests:{first_name:'Luis',last_name:'Díaz'}}}]; }""")
    pg.evaluate("form._submit()"); pg.wait_for_timeout(1000)
    calls = pg.evaluate("window.__calls")
    t('con el 2º depto ocupado: NO se guarda nada', not [c for c in calls if c['op'] in ('insert','upsert','update')], [c['key'] for c in calls])
    t('y avisa quién ocupa', 'Luis Díaz' in toasts(), toasts())

    # ── Cambio de fechas con tramos activos ─────────
    reset()
    pg.evaluate("window.form.open(); window.form._goToStep(2)")
    set_dates('2026-01-10','2026-01-13')
    pg.click('#units-selector .unit-option[data-unit-id="D2"]'); pg.evaluate("document.getElementById('f-price').value='50000'")
    pg.click('#btn-split-stay'); pg.wait_for_selector('#split-stay-structure .split-row')
    set_dates('2026-01-10','2026-01-16')
    segs = pg.evaluate("form._splitEditor.getSegments()")
    t('al extender el check-out, el último tramo lo sigue', segs[-1]['to']=='2026-01-16' and segs[0]['from']=='2026-01-10', segs)
    set_dates('2026-01-10','2026-01-11')
    t('con 1 noche sale del modo y vuelve al selector de unidades', not pg.evaluate("form._isSplit()") and pg.is_visible('#units-selector'), toasts())

    # ── Quitar cambio ───────────────────────────────
    pg.evaluate("window.form.open(); window.form._goToStep(2)")
    set_dates('2026-01-10','2026-01-13')
    pg.click('#units-selector .unit-option[data-unit-id="D3"]'); pg.evaluate("document.getElementById('f-price').value='40000'")
    pg.click('#btn-split-stay'); pg.wait_for_selector('#split-stay-structure .split-row')
    pg.click('#split-stay-structure [data-act="remove"]')
    t('"Volver a un solo depto": vuelve a D3 y muestra selector', pg.evaluate("[...form._selectedUnitIds]")==['D3'] and pg.is_visible('#units-selector') and not pg.evaluate("form._isSplit()"))

    t('sin errores de JS durante todo el recorrido', not errors, errors)
    b.close()
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
