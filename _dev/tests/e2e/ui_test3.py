import sys, json
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:300])
URL='http://localhost:5199/_dev/tests/harness/harness.html'
SOURCES=['direct','walkin','booking','airbnb','family','company','referral','despegar','expedia']

def fresh_page(b, vp=None):
    pg=(b.new_context(viewport=vp or {'width':1100,'height':1000})).new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(URL); pg.wait_for_function('window.__ready===true'); return pg, errs
toast=lambda pg: pg.evaluate("document.getElementById('toast-container').innerText").replace('\n',' ')
def calls(pg): return pg.evaluate("window.__calls")
def setdata(pg, d, errors=None):
    pg.evaluate("(a)=>{window.__calls.length=0;window.__errors=a.e||{};window.__data=a.d;document.getElementById('toast-container').innerHTML=''}", {'d':d,'e':errors})

def create_via_ui(pg, src, pax=None):
    pg.evaluate("form.open()")
    pg.fill('#f-firstname','Juan'); pg.fill('#f-lastname','Perez')
    pg.click('#btn-step-next'); pg.wait_for_timeout(250)                      # → paso 2
    pg.evaluate("""()=>{const f=form;f._datePicker.setValue('2026-02-10','2026-02-13');document.getElementById('f-checkin').value='2026-02-10';document.getElementById('f-checkout').value='2026-02-13';f._datePicker._onChange('2026-02-10','2026-02-13');}""")
    pg.click('#units-selector .unit-option[data-unit-id="D2"]')
    if pax:
        pg.evaluate("(n)=>{document.getElementById('f-adults').value=n; form._updatePaxCap?.();}", pax)
    pg.evaluate("window.scrollTo(0,0)")
    pg.click(f'#f-source-selector .src-chip[data-source="{src}"]', force=True)
    pg.click('#btn-step-next'); pg.wait_for_timeout(250)                      # → paso 3
    pg.evaluate("document.getElementById('f-price').value='40000'; form._updateBreakdown()")
    pg.click('#btn-step-next'); pg.click('#btn-step-next'); pg.wait_for_timeout(250)   # → pagos → resumen
    pg.evaluate("document.getElementById('toast-container').innerHTML=''")
    pg.click('#btn-voucher-confirm'); pg.wait_for_timeout(1100)

with sync_playwright() as p:
    b=p.chromium.launch()

    # ── A. Los 9 canales, por la interfaz real ───────────────────
    for src in SOURCES:
        pg,errs=fresh_page(b)
        setdata(pg, {'guests:insert':[{'id':'G1'}],'bookings:insert':[{'id':'NEW1'}],'booking_units:select':[]})
        create_via_ui(pg, src)
        ins=[c for c in calls(pg) if c['table']=='bookings' and c['op']=='insert']
        row=ins[0]['args'][0][1] if ins else {}
        t(f'canal {src:9}: se crea la reserva con su origen y avisa', len(ins)==1 and row.get('source')==src and 'Reserva creada' in toast(pg) and not errs, (len(ins), row.get('source'), toast(pg), errs))
        pg.close()

    # ── A2. La base rechaza el canal: mensaje claro, banner fijo, nada se queda colgado ──
    pg,errs=fresh_page(b)
    setdata(pg, {'guests:insert':[{'id':'G1'}],'bookings:insert':[{'id':'NEW1'}],'booking_units:select':[]},
            {'bookings:insert':{'code':'23514','message':'new row for relation "bookings" violates check constraint "chk_booking_source"'}})
    create_via_ui(pg, 'walkin')
    banner=pg.evaluate("(()=>{const e=document.getElementById('booking-form-error'); return [e && !e.classList.contains('hidden'), e?.innerText]})()")
    t('canal rechazado por la base: banner de error visible dentro del formulario', banner[0] is True, banner)
    t('el mensaje nombra el canal y la migración a ejecutar', 'Espontáneo' in banner[1] and 'migration_booking_source_channels.sql' in banner[1], banner[1])
    t('además aparece el aviso (toast)', 'Espontáneo' in toast(pg), toast(pg))
    t('el botón queda habilitado para reintentar', not pg.evaluate("document.getElementById('btn-voucher-confirm').disabled"))
    # reintento correcto limpia el banner
    pg.evaluate("window.__errors={}"); pg.click('#btn-voucher-confirm'); pg.wait_for_timeout(1000)
    t('al reintentar con éxito, el banner desaparece', pg.evaluate("document.getElementById('booking-form-error').classList.contains('hidden')") and 'Reserva creada' in toast(pg))
    pg.close()

    # ── B. Edición de una reserva de 4 personas ──────────────────
    BK={'id':'b4','check_in':'2026-02-10','check_out':'2026-02-13','nights':3,'price_per_night':50000,'discount_pct':0,'surcharge_amount':0,'free_nights':0,
        'total_amount':150000,'total_paid':50000,'status':'partial','source':'booking','notes':'nota original','late_checkout':False,'adults':4,'children':0,'pax':4,'created_at':'2026-01-01T10:00:00Z',
        'guests':{'id':'G9','first_name':'Juan','last_name':'Pérez','dni':'123','gender':'female'},
        'booking_units':[{'unit_id':'D2','price_per_night':50000,'segment_check_in':None,'segment_check_out':None,'units':{'name':'Departamento 2','color':'#ef4444','sort_order':2}}]}
    pg,errs=fresh_page(b)
    setdata(pg, {'bookings:select':BK,'payments:select':[],'booking_units:select':[],'bookings:update':[{'id':'b4'}],'guests:update':[{'id':'G9'}]})
    pg.evaluate("form.openEdit('b4')"); pg.wait_for_timeout(800)
    vals=lambda: pg.evaluate("[document.getElementById('f-adults').value, document.getElementById('f-children').value, document.getElementById('pax-total-num').textContent]")
    t('al abrir: 4 adultos y total 4 (no 2)', vals()==['4','0','4'], vals())
    t('el canal guardado (Booking) queda seleccionado', pg.evaluate("document.querySelector('input[name=\"booking-source\"]:checked')?.value")=='booking')
    # cambiar fechas, notas y departamento, navegando por los pasos
    pg.evaluate("form._goToStep(2)")
    pg.evaluate("""()=>{const f=form;f._datePicker.setValue('2026-02-11','2026-02-15');document.getElementById('f-checkin').value='2026-02-11';document.getElementById('f-checkout').value='2026-02-15';f._datePicker._onChange('2026-02-11','2026-02-15');}""")
    pg.fill('#f-notes','nota nueva con cambios')
    pg.evaluate("document.querySelector('#units-selector .unit-option[data-unit-id=\"D2\"]').click(); document.querySelector('#units-selector .unit-option[data-unit-id=\"D3\"]').click()")
    pg.wait_for_timeout(300)
    t('tras cambiar fechas, notas y depto: sigue en 4 personas', vals()==['4','0','4'], vals())
    for s in (3,4,5,2,1,2): pg.evaluate(f"form._goToStep({s})")
    t('tras ir y volver entre pasos: sigue en 4 personas', vals()==['4','0','4'], vals())
    pg.evaluate("form._goToStep(5)"); setdata(pg, {'bookings:select':BK,'payments:select':[],'booking_units:select':[],'bookings:update':[{'id':'b4'}],'guests:update':[{'id':'G9'}]})
    pg.evaluate("form._submit()"); pg.wait_for_timeout(1500)
    cs=calls(pg); ups=[c for c in cs if c['table']=='bookings' and c['op']=='update']
    core=next((u['args'][0][1] for u in ups if 'check_in' in u['args'][0][1]), {})
    paxu=next((u['args'][0][1] for u in ups if 'pax' in u['args'][0][1]), {})
    t('se guardan las fechas y notas nuevas, y el canal se conserva', core.get('check_in')=='2026-02-11' and core.get('check_out')=='2026-02-15' and core.get('notes')=='nota nueva con cambios' and core.get('source')=='booking', core)
    t('se guarda pax=4, adultos=4, menores=0', (paxu.get('pax'),paxu.get('adults'),paxu.get('children'))==(4,4,0), paxu)
    bu=[c for c in cs if c['table']=='booking_units' and c['op']=='upsert']
    t('el departamento cambia a D3 y se quita D2 (sin dejar la reserva sin depto)', bu and [r['unit_id'] for r in bu[0]['args'][0][1]]==['D3'] and any(c['op']=='delete' for c in cs if c['table']=='booking_units'), [c['key'] for c in cs])
    gu=[c for c in cs if c['table']=='guests' and c['op']=='update']
    t('el género del huésped (Femenino) se conserva al editar', gu and gu[0]['args'][0][1].get('gender')=='female', gu and gu[0]['args'][0][1])
    t('no se crea otra reserva', not [c for c in cs if c['table']=='bookings' and c['op']=='insert'])
    pg.close()

    # variante "adults=1 por defecto de la base, pax=4": no se pierde gente al guardar
    pg,errs=fresh_page(b); BK2=dict(BK, adults=1, children=0, pax=4)
    setdata(pg, {'bookings:select':BK2,'payments:select':[],'booking_units:select':[],'bookings:update':[{'id':'b4'}],'guests:update':[{'id':'G9'}]})
    pg.evaluate("form.openEdit('b4')"); pg.wait_for_timeout(800)
    pg.evaluate("form._goToStep(5)"); pg.evaluate("form._submit()"); pg.wait_for_timeout(1500)
    paxu=next((u['args'][0][1] for u in [c for c in calls(pg) if c['table']=='bookings' and c['op']=='update'] if 'pax' in u['args'][0][1]), {})
    t('reserva con adults=1 y pax=4: se sigue guardando 4 (antes se pisaba con 1)', paxu.get('pax')==4, paxu)
    pg.close()

    # ── C. Ficha: símbolo, estado de alojamiento, fechas especiales, personas ──
    pg,errs=fresh_page(b)
    DET=dict(BK, check_in='2026-11-21', check_out='2026-11-24', checked_in_at=None, adults=1, children=0, pax=4)
    pg.evaluate("(d)=>form.openDetail(d)", DET); pg.wait_for_timeout(300)
    txt=pg.inner_text('#detail-body')
    t('ficha: ♀ junto al nombre (género Femenino)', pg.evaluate("document.querySelector('#detail-body .detail-guest-name .g-sym')?.textContent")=='♀', txt[:120])
    t('ficha: el símbolo tiene texto alternativo accesible', pg.evaluate("document.querySelector('#detail-body .g-sym')?.getAttribute('aria-label')")=='Femenino')
    t('ficha: fechas especiales del feriado (Soberanía / Finde largo)', 'Soberanía' in txt or 'Finde largo' in txt, txt[:400])
    t('ficha: personas = 4 adultos (no 1)', '4 adultos' in txt, txt)
    for g,sym in (('male','♂'),('nonbinary','⚧')):
        pg.evaluate("(d)=>form.openDetail(d)", dict(DET, guests=dict(DET['guests'], gender=g)))
        t(f'ficha: símbolo {sym} para {g}', pg.evaluate("document.querySelector('#detail-body .detail-guest-name .g-sym')?.textContent")==sym)
    pg.evaluate("(d)=>form.openDetail(d)", dict(DET, guests=dict(DET['guests'], gender=None)))
    t('sin género cargado: no se muestra ningún símbolo', pg.evaluate("document.querySelectorAll('#detail-body .g-sym').length")==0)
    pg.evaluate("(d)=>form.openDetail(d)", dict(DET, guests=dict(DET['guests'], gender='female'), notes='<img src=x onerror=window.__x=1>'))
    t('ficha: no se confunde con el estado "Alojada" (el símbolo es solo género)', 'Alojad' not in pg.inner_text('#detail-body'))
    # estado de alojamiento
    import datetime
    today=datetime.date.today(); 
    for label,ci,co,cin,cout,esperado in [
        ('ingreso pendiente', (today-datetime.timedelta(days=1)).isoformat(), (today+datetime.timedelta(days=2)).isoformat(), None, None, 'Ingreso pendiente'),
        ('alojada (con saldo pendiente)', (today-datetime.timedelta(days=1)).isoformat(), (today+datetime.timedelta(days=2)).isoformat(), '2026-01-01T10:00:00Z', None, 'Alojada'),
    ]:
        pg.evaluate("(d)=>form.openDetail(d)", dict(BK, check_in=ci, check_out=co, checked_in_at=cin, checked_out_at=cout, status='partial', balance=100000))
        stay=pg.evaluate("document.querySelector('#detail-body .stay-badge')?.textContent")
        ci_btn=pg.evaluate("!!document.getElementById('detail-checkin-btn') && !document.getElementById('detail-checkin-btn').classList.contains('hidden') && getComputedStyle(document.getElementById('detail-checkin-btn')).display!=='none'")
        t(f'ficha {label}: estado "{esperado}"', stay==esperado, stay)
        if esperado=='Ingreso pendiente': t('ficha: botón de check-in visible solo con ingreso pendiente', ci_btn is True, ci_btn)
        else: t('ficha alojada: sin botón de check-in (no se duplica)', ci_btn is False, ci_btn)
    t('sin errores de JS', not errs, errs)
    pg.close()

    # ── D. Paso 2: menos scroll y diseño (escritorio y móvil) ────
    def s2(vp, mobile=False):
        ctx=b.new_context(viewport=vp, has_touch=mobile, is_mobile=mobile); pg=ctx.new_page()
        pg.goto(URL); pg.wait_for_function('window.__ready===true')
        pg.evaluate("form.open(); form._goToStep(2)"); pg.wait_for_timeout(600)
        r=pg.evaluate("""()=>{const st=document.getElementById('step-2'); const g=document.querySelector('#step-2 .s2-grid');
          const vis=e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.height>0};
          const ids=['f-adults','f-children','f-notes','units-selector','f-source-selector'].map(i=>vis(document.getElementById(i)));
          return {scroll: st.scrollHeight-st.clientHeight, cols: getComputedStyle(g).gridTemplateColumns.split(' ').length, allControlsRendered: ids.every(Boolean),
                  btnH: Math.round(document.querySelector('#step-2 .pax-btn, #step-2 [data-pax-btn], #step-2 .unit-option').getBoundingClientRect().height),
                  chipsWrapped: getComputedStyle(document.getElementById('f-source-selector')).flexWrap}}""")
        pg.close(); return r
    d=s2({'width':1280,'height':800}); m=s2({'width':390,'height':844}, True)
    t(f'escritorio: dos columnas y casi sin scroll (antes 479 px; ahora {d["scroll"]} px)', d['cols']==2 and d['scroll']<=30 and d['allControlsRendered'], d)
    t(f'escritorio: canales en filas (se ven todos)', d['chipsWrapped']=='wrap', d)
    t(f'móvil: una columna y scroll reducido a la mitad (antes 552 px; ahora {m["scroll"]} px)', m['cols']==1 and m['scroll']<=290 and m['allControlsRendered'], m)
    t('los controles siguen siendo tocables (altura ≥ 28 px)', d['btnH']>=28 and m['btnH']>=28, (d['btnH'], m['btnH']))
    b.close()
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
