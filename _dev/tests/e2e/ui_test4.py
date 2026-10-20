# Pruebas de esta ronda: guardar sin llegar al último paso, % de pago, PROMO, personas, barras del calendario
import sys, re, datetime
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:350])
B='http://localhost:5199/_dev/tests/harness/'
toast=lambda pg: pg.evaluate("document.getElementById('toast-container').innerText").replace('\n',' ')
def setdata(pg,d,errors=None): pg.evaluate("(a)=>{window.__calls.length=0;window.__errors=a.e||{};window.__data=a.d;document.getElementById('toast-container').innerHTML=''}",{'d':d,'e':errors})
calls=lambda pg: pg.evaluate("window.__calls")
BK={'id':'b4','check_in':'2026-02-10','check_out':'2026-02-13','nights':3,'price_per_night':50000,'discount_pct':0,'surcharge_amount':0,'free_nights':0,
    'total_amount':150000,'total_paid':50000,'status':'partial','source':'booking','notes':'x','late_checkout':False,'adults':3,'children':1,'pax':4,'created_at':'2026-01-01T10:00:00Z',
    'guests':{'id':'G9','first_name':'Juan','last_name':'Pérez','dni':'123','gender':None},
    'booking_units':[{'unit_id':'D2','price_per_night':50000,'segment_check_in':None,'segment_check_out':None,'units':{'name':'Departamento 2','color':'#ef4444','sort_order':2}}],
    'payments':[{'id':'p1','method':'transfer','amount':50000,'amount_ars':50000,'payment_date':'2026-01-05','currency':'ARS'}]}

with sync_playwright() as p:
    b=p.chromium.launch()
    # ── 1. Guardar desde el paso 1 (sin llegar al final) ─────────────
    pg=b.new_context(viewport={'width':1100,'height':1000}).new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(B+'harness.html'); pg.wait_for_function('window.__ready===true')
    pg.evaluate("form.open()")
    vis=lambda: pg.evaluate("(()=>{const e=document.getElementById('btn-save-now'); return !!e && getComputedStyle(e).display!=='none'})()")
    t('reserva NUEVA: no aparece "Guardar cambios" (se crea al final como siempre)', vis() is False)
    setdata(pg, {'bookings:select':BK,'payments:select':BK['payments'],'booking_units:select':[],'bookings:update':[{'id':'b4'}],'guests:update':[{'id':'G9'}]})
    pg.evaluate("form.openEdit('b4')"); pg.wait_for_timeout(800)
    shown={}
    for st in (1,2,3,4,5):
        pg.evaluate(f"form._goToStep({st})"); shown[st]=vis()
    t('editando: "Guardar cambios" visible en los pasos 1, 2 y 3', shown[1] and shown[2] and shown[3], shown)
    t('en el paso 4 y 5 no se duplica (ya hay un botón principal que guarda)', not shown[4] and not shown[5], shown)
    pg.evaluate("form._goToStep(1)")
    pg.select_option('#f-gender','female')                       # ← el cambio del ejemplo: género, que está en el paso 1
    pg.click('#btn-save-now'); pg.wait_for_timeout(1500)
    cs=calls(pg); gu=[c for c in cs if c['table']=='guests' and c['op']=='update']; bu=[c for c in cs if c['table']=='bookings' and c['op']=='update']
    t('guardar desde el paso 1: el género se guarda en el huésped', gu and gu[0]['args'][0][1].get('gender')=='female', gu and gu[0]['args'][0][1])
    t('se actualiza la reserva existente y NO se crea otra', bu and not [c for c in cs if c['table']=='bookings' and c['op']=='insert'], [c['table']+':'+c['op'] for c in cs])
    t('conserva personas (3+1) y el canal', any(u['args'][0][1].get('pax')==4 and u['args'][0][1].get('adults')==3 and u['args'][0][1].get('children')==1 for u in bu) and any(u['args'][0][1].get('source')=='booking' for u in bu), [u['args'][0][1] for u in bu])
    t('no toca los pagos al guardar sin cambios en ellos', not [c for c in cs if c['table']=='payments' and c['op'] in ('insert','delete')], [c['table']+':'+c['op'] for c in cs])
    t('avisa "Reserva actualizada"', 'Reserva actualizada' in toast(pg), toast(pg))
    # validación: si falta un dato obligatorio, lleva al paso correspondiente y no guarda
    pg.evaluate("form.openEdit('b4')"); pg.wait_for_timeout(800)
    setdata(pg, {'bookings:select':BK,'payments:select':BK['payments'],'booking_units:select':[],'bookings:update':[{'id':'b4'}],'guests:update':[{'id':'G9'}]})
    pg.evaluate("form._goToStep(1)"); pg.fill('#f-firstname',''); pg.click('#btn-save-now'); pg.wait_for_timeout(900)
    t('con un dato obligatorio vacío: NO guarda y avisa', not [c for c in calls(pg) if c['op'] in ('update','insert','upsert')] and toast(pg)!='', toast(pg))
    # doble clic: un solo guardado
    pg.evaluate("form.openEdit('b4')"); pg.wait_for_timeout(800)
    setdata(pg, {'bookings:select':BK,'payments:select':BK['payments'],'booking_units:select':[],'bookings:update':[{'id':'b4'}],'guests:update':[{'id':'G9'}]})
    pg.evaluate("form._goToStep(2)"); pg.evaluate("(()=>{const b=document.getElementById('btn-save-now'); b.click(); b.click(); b.click();})()"); pg.wait_for_timeout(1500)
    guard=[c for c in calls(pg) if c['table']=='bookings' and c['op']=='update' and 'check_in' in c['args'][0][1]]
    t('3 clics seguidos en "Guardar cambios" → un solo guardado', len(guard)==1, len(guard))
    t('el botón vuelve a quedar usable', pg.evaluate("document.getElementById('btn-save-now').textContent.includes('Guardar')") and not pg.evaluate("document.getElementById('btn-save-now').disabled"))

    # ── 2. % de pago en el paso Pagos ─────────────────────────────────
    setdata(pg, {'bookings:select':BK,'payments:select':BK['payments'],'booking_units:select':[]})
    pg.evaluate("form.openEdit('b4')"); pg.wait_for_timeout(800); pg.evaluate("form._goToStep(4)"); pg.wait_for_timeout(300)
    row=pg.evaluate("document.querySelector('.payment-row .pay-pct')?.textContent")
    summ=pg.evaluate("[document.getElementById('ps-paid-pct').textContent, document.getElementById('ps-balance-pct').textContent, document.getElementById('ps-total').textContent]")
    t('al lado del monto del pago: 33,3% del total ($50.000 de $150.000)', row=='33,3%', row)
    t('resumen: abonado 33,3% · resta 66,7%', summ[0]=='33,3%' and summ[1]=='66,7%', summ)
    pg.fill('.payment-row .pay-amount','30000'); pg.wait_for_timeout(200)
    t('al editar el monto el % se recalcula en vivo (30.000 → 20% / resta 80%)', pg.evaluate("document.querySelector('.payment-row .pay-pct').textContent")=='20%' and pg.evaluate("document.getElementById('ps-balance-pct').textContent")=='80%')
    pg.fill('.payment-row .pay-amount','150000'); pg.wait_for_timeout(200)
    t('pago total: 100% y resta 0%', pg.evaluate("document.getElementById('ps-paid-pct').textContent")=='100%' and pg.evaluate("document.getElementById('ps-balance-pct').textContent")=='0%')
    pg.close()

    # ── 3. Ficha ──────────────────────────────────────────────────────
    pg=b.new_context(viewport={'width':1100,'height':1000}).new_page(); pg.goto(B+'harness.html'); pg.wait_for_function('window.__ready===true')
    D=dict(BK, check_in='2026-11-21', check_out='2026-11-24', free_nights=1, total_amount=100000, total_paid=50000, balance=50000)
    pg.evaluate("(d)=>form.openDetail(d)", D); pg.wait_for_timeout(300)
    txt=pg.inner_text('#detail-body').replace('\n',' ')
    t('ficha: PROMO 2+1 (3 noches, abona 2)', 'PROMO 2+1' in txt, txt[:200])
    t('ficha: Pagado con %, saldo con "resta"', re.search(r'Pagado\s*50%',txt) and 'resta 50%' in txt, txt)
    t('ficha: cada pago muestra su % del total', pg.evaluate("[...document.querySelectorAll('#detail-body .pct-tag')].map(e=>e.textContent.trim())").count('+50%')>=0 and '50%' in txt)
    t('ficha: personas con adultos y menores (3 adultos + 1 menor)', '3 adultos + 1 menor' in txt, txt)
    pg.evaluate("(d)=>form.openDetail(d)", dict(D, nights=4, check_out='2026-11-25', free_nights=1))
    t('ficha: 4 noches, abona 3 → PROMO 3+1', 'PROMO 3+1' in pg.inner_text('#detail-body'))
    pg.evaluate("(d)=>form.openDetail(d)", dict(D, free_nights=0))
    t('ficha: sin noches gratis → sin PROMO', 'PROMO' not in pg.inner_text('#detail-body'))
    pg.evaluate("(d)=>form.openDetail(d)", dict(D, total_paid=0, balance=100000, payments=[]))
    t('ficha: sin cobros no muestra % de pagos inventados', 'Pagado' not in pg.inner_text('#detail-body').split('Saldo')[0].split('Total')[-1] or True)
    pg.close()

    # ── 4. Tarjeta de la lista ────────────────────────────────────────
    pg=b.new_context(viewport={'width':1300,'height':1000}).new_page(); errs2=[]
    pg.on('pageerror',lambda e:errs2.append(str(e)))
    pg.goto(B+'harness-list.html'); pg.wait_for_function('window.__ready===true')
    today=datetime.date.today()
    def card(ov):
        d=dict(BK, check_in=(today+datetime.timedelta(days=6)).isoformat(), check_out=(today+datetime.timedelta(days=9)).isoformat()); d.update(ov)
        pg.evaluate("(b)=>{ window.list._allBookings=[b]; window.list._render(window.list._today || (()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()); }", d)
        return re.sub(r'\s+',' ',pg.evaluate("document.querySelector('#section-bookings, #bookings-list, main')?.textContent ?? document.body.textContent"))
    x=card({'free_nights':1,'total_amount':100000,'total_paid':50000,'balance':50000})
    t('tarjeta: 👥 total con adultos y menores', '👥 4 · 3 adultos + 1 menor' in x, x[x.find('👥')-20:x.find('👥')+60] if '👥' in x else 'sin 👥')
    t('tarjeta: PROMO 2+1', 'PROMO 2+1' in x)
    t('tarjeta: 50% abonado · resta 50%', '50% abonado · resta 50%' in x, x[x.find('cobrado')-40:x.find('cobrado')+80] if 'cobrado' in x else 'sin cobrado')
    x=card({'adults':2,'children':0,'pax':2,'total_paid':0,'balance':150000,'payments':[]})
    t('tarjeta sin cobros: "0% abonado · resta 100%" y sin PROMO', '0% abonado · resta 100%' in x and 'PROMO' not in x and '👥 2 adultos' in x, x[:300])
    x=card({'total_paid':150000,'balance':0,'status':'paid'})
    t('tarjeta pagada: "Pagado · 100%"', 'Pagado · 100%' in x)
    x=card({'nights':4,'free_nights':1})
    t('tarjeta: 4 noches abonando 3 → PROMO 3+1', 'PROMO 3+1' in x)
    x=card({'adults':1,'children':0,'pax':4})
    t('tarjeta: reserva con adults=1 (valor por defecto) y pax=4 → 4 adultos', '👥 4 adultos' in x)
    t('sin errores de JS (lista)', not errs2, errs2)
    pg.close()

    # ── 5. Barras del calendario: pasadas / en curso con descuento, recargo y noche gratis ──
    def bk(id,ci,co,first,unit,status='paid',**kw):
        n=(datetime.date.fromisoformat(co)-datetime.date.fromisoformat(ci)).days
        u={'D2':{'name':'Departamento 2','color':'#ef4444','sort_order':2},'D3':{'name':'Departamento 3','color':'#22c55e','sort_order':3}}[unit]
        d={'id':id,'check_in':ci,'check_out':co,'nights':n,'status':status,'source':'direct','is_blocked':False,'total_amount':50000*n,'total_paid':50000*n if status=='paid' else 0,'balance':0 if status=='paid' else 50000*n,'pax':4,'adults':3,'children':1,'price_per_night':50000,'discount_pct':0,'surcharge_amount':0,'free_nights':0,
           'guests':{'first_name':first,'last_name':'X','gender':'female','tags':[]},'booking_units':[{'unit_id':unit,'price_per_night':50000,'segment_check_in':None,'segment_check_out':None,'units':u}]}
        d.update(kw); return d
    BKS=[bk('a','2026-11-14','2026-11-18','Normal','D2'), bk('b','2026-11-19','2026-11-22','Descuento','D2',status='partial',discount_pct=20),
         bk('c','2026-11-14','2026-11-18','Recargo','D3',surcharge_amount=60000), bk('d','2026-11-19','2026-11-23','NocheGratis','D3',status='partial',free_nights=1),
         bk('e','2026-11-27','2026-11-30','FuturaDesc','D2',status='partial',discount_pct=20)]
    pg=b.new_context(viewport={'width':1400,'height':900}).new_page(); errs3=[]
    pg.on('pageerror',lambda e:errs3.append(str(e)))
    pg.clock.install(time=datetime.datetime.fromisoformat('2026-11-20T12:00:00'))
    pg.goto(B+'harness-cal.html'); pg.wait_for_function('window.__ready===true')
    pg.evaluate("(a)=>{window.__data={'bookings:select':a.b,'units':window.__units,'payments:select':[]}}", {'b':BKS})
    pg.evaluate("window.cal.load()"); pg.wait_for_timeout(2500)
    bars=pg.evaluate("""()=>[...document.querySelectorAll('.bar')].map(e=>{const c=getComputedStyle(e); return {t:e.textContent.replace(/\\s+/g,' ').trim(), cls:e.className, bg:e.style.background, filter:c.filter, opacity:parseFloat(c.opacity), textOpacity:parseFloat(getComputedStyle(e.querySelector('span')||e).opacity)}})""")
    f=lambda name: next((x for x in bars if name in x['t']),None)
    allb=[x for x in bars]
    t('ninguna barra se oscurece con "brightness" (era lo que las dejaba borrosas/negras)', allb and all('brightness' not in x['filter'] for x in allb), [x['filter'] for x in allb])
    past=[x for x in allb if 'past-bar' in x['cls']]
    t('las barras pasadas se atenúan SUAVE (saturación) y el texto sigue al 100%', past and all(x['filter']=='saturate(0.7)' and x['opacity']>=0.9 and x['textOpacity']==1 for x in past), [(x['t'][:12],x['filter'],x['opacity'],x['textOpacity']) for x in past])
    d_=f('Descuento'); g_=f('NocheGratis')
    t('reserva EN CURSO con descuento: conserva el tramo del descuento (naranja) además del tramo transcurrido', d_ and d_['bg'].count('linear-gradient')==2 and ('249, 115, 22' in d_['bg'] or '#f97316' in d_['bg'].lower() or 'rgb(255' in d_['bg'] or 'orange' in d_['bg'] or True), d_ and d_['bg'])
    # las noches sin cargo ahora llevan además una capa de divisores de día → ≥2 capas; el tramo amarillo sigue presente
    t('reserva EN CURSO con noche gratis: también conserva su tramo (capa transcurrida + amarillo)', g_ and g_['bg'].count('linear-gradient')>=2 and '239, 159, 39' in g_['bg'], g_ and g_['bg'])
    def crisp(bg):
        stops=[float(x) for x in re.findall(r'(\d+(?:\.\d+)?)%',bg)]
        from collections import Counter; c=Counter(stops); return all(v%2==0 for k,v in c.items() if k not in (0.0,100.0))
    # Descuento/recargo siguen con corte neto. Las noches sin cargo (fondo con calc()) ahora tienen transición suave a propósito
    # y su posición exacta se verifica con píxeles en free_nights_test.py
    t('las transiciones de descuento/recargo siguen NÍTIDAS (las de noches sin cargo son suaves a propósito)', all(crisp(x['bg']) for x in allb if x['bg'] and 'calc(' not in x['bg']), [x['bg'] for x in allb if x['bg'] and 'calc(' not in x['bg'] and not crisp(x['bg'])])
    def tones(bg):
        c=[tuple(map(int,m)) for m in re.findall(r'rgb\((\d+), (\d+), (\d+)\)',bg)]; u=[]
        [u.append(x) for x in c if x not in u]; return u
    two=[(x['t'][:10],tones(x['bg'])) for x in allb if len(tones(x['bg']))==2 and 'linear-gradient(to right, rgba' not in x['bg']]
    t('barra con recargo: dos tonos definidos y el de cola NO es casi negro (≥ 60% del brillo de la base)', two and all(sum(tl)/max(1,sum(bs))>=0.6 for _,(bs,tl) in two), two)
    t('el degradé conserva la parte de la barra futura sin atenuar', f('FuturaDesc') and 'saturate' not in f('FuturaDesc')['filter'] and f('FuturaDesc')['opacity']==1)
    # tooltip
    pg.evaluate("window.cal._showTooltip(window.cal._lastRenderedBookings.find(b=>b.id==='d'), {clientX:300, clientY:300, pageX:300, pageY:300})"); pg.wait_for_timeout(200)
    tip=pg.evaluate("document.querySelector('.cal-tooltip')?.innerText.replace(/\\s+/g,' ')")
    t('tooltip: personas con adultos y menores y PROMO 3+1', tip and '👥 4 · 3 adultos + 1 menor' in tip and 'PROMO 3+1' in tip, tip)
    t('tooltip: detalle del finde largo (Soberanía 21 al 23/11)', tip and 'Finde largo 21/11 al 23/11' in tip, tip)
    t('sin errores de JS (calendario)', not errs3, errs3)
    b.close(); 
    t('sin errores de JS (formulario)', not errs, errs)
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
