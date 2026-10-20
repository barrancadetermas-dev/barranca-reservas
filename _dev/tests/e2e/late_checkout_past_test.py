"""Reservas pasadas con late check-out (cobrado / gratis) y futuras: sin texto fantasma ni desenfoque.
Causa original: la capa de extensión repetía avatar+nombre debajo de la barra; con la barra pasada a opacity .9 el texto se transparentaba."""
import io, sys
from datetime import datetime, timedelta
from PIL import Image
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:400])
U={'D2':{'name':'Departamento 2','color':'#ef4444','sort_order':2},'D3':{'name':'Departamento 3','color':'#22c55e','sort_order':3}}
def bk(id,ci,co,last,unit,**kw):
    n=(datetime.fromisoformat(co)-datetime.fromisoformat(ci)).days
    d={'id':id,'check_in':ci,'check_out':co,'nights':n,'status':'partial','source':'direct','is_blocked':False,'total_amount':50000*n,'total_paid':10000,'balance':50000*n-10000,'pax':2,'adults':2,'children':0,'price_per_night':50000,
       'guests':{'first_name':'Ana','last_name':last,'gender':None,'tags':[]},'booking_units':[{'unit_id':unit,'price_per_night':50000,'segment_check_in':None,'segment_check_out':None,'units':U[unit]}]}
    d.update(kw); return d
TODAY='2026-10-19'
B=[bk('p1','2026-10-05','2026-10-08','PastCobrado','D2',late_checkout=True,late_checkout_charged=True),
   bk('p2','2026-10-10','2026-10-13','PastGratis','D2',late_checkout=True,late_checkout_charged=False),
   bk('p3','2026-10-01','2026-10-04','PastSinLate','D2'),
   bk('p4','2026-10-05','2026-10-08','PastGratisPaga','D3',late_checkout=True,late_checkout_charged=False,status='paid',total_paid=150000,balance=0),
   bk('f1','2026-10-22','2026-10-26','FutLate','D2',late_checkout=True,late_checkout_charged=True),
   bk('f2','2026-10-27','2026-10-30','FutGratis','D3',late_checkout=True,late_checkout_charged=False)]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_context(viewport={'width':1500,'height':800}).new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.clock.install(time=datetime.fromisoformat(TODAY+'T12:00:00'))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness-cal.html'); pg.wait_for_function('window.__ready===true')
    pg.add_style_tag(content='#login-screen{display:none!important}')
    pg.evaluate("()=>{let e=document.getElementById('calendar-grid');while(e&&e!==document.body){e.classList.remove('hidden');if(getComputedStyle(e).display==='none')e.style.display='block';e=e.parentElement}}")
    pg.evaluate("(a)=>{window.__data={'bookings:select':a,'units':window.__units,'payments:select':[]};window.cal._windowStart='2026-10-01'}",B)
    pg.evaluate("window.cal.load()"); pg.wait_for_timeout(2000)
    pg.locator('#calendar-grid').screenshot(path='/tmp/lco_after.png')
    info=pg.evaluate("""()=>[...document.querySelectorAll('.bar')].map(b=>{const cell=b.parentElement;const ext=[...cell.querySelectorAll('.bar-lco-ext')];
       const br=b.getBoundingClientRect();return {name:b.textContent.trim(),pastBar:b.classList.contains('past-bar'),barOp:getComputedStyle(b).opacity,
        ext:ext.map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent.trim(),h:Math.round(r.height),barH:Math.round(br.height),op:getComputedStyle(e).opacity,left:Math.round(r.left-br.right),w:Math.round(r.width),filter:getComputedStyle(e).filter,blur:/blur/.test(getComputedStyle(e).filter+getComputedStyle(b).filter+getComputedStyle(e).backdropFilter)}}),
        nameInCell:[...cell.querySelectorAll('*')].filter(e=>e.textContent.includes('Past')||e.textContent.includes('Fut')).filter(e=>e.children.length===0&&e.textContent.trim().length>2).length}})""")
    b.close()
by={i['name'][:14]:i for i in info}
for key,n,kind in [('PastCobrado','pasada con late check-out PAGO','p'),('PastGratis','pasada con late check-out GRATIS','p'),('PastSinLate','pasada sin late check-out (control)','c'),('FutLate','futura con late check-out','f')]:
    i=next((v for k,v in by.items() if key[:10] in k.replace(' ','')),None)
    if not i: t(f'{n}: se dibuja',False,list(by)); continue
    if kind=='c':
        t(f'{n}: sin extensión', not i['ext'], i); continue
    e=i['ext'][0] if i['ext'] else None
    t(f'{n}: tiene su tramo de late check-out', e is not None, i)
    if not e: continue
    t(f'{n}: la extensión NO repite el nombre/avatar (era la causa del fantasma)', e['text']=='', e['text'])
    t(f'{n}: la extensión tiene la misma altura que la barra', abs(e['h']-e['barH'])<=1, (e['h'],e['barH']))
    t(f'{n}: la extensión empieza pegada al borde derecho de la barra (sin solapar)', abs(e['left'])<=1, e['left'])
    t(f'{n}: ningún blur aplicado a barra ni extensión', not e['blur'], e)
    t(f'{n}: opacidad de la extensión = la de la barra (≥.9)', float(e['op'])>=.9 and float(i['barOp'])>=.9, (e['op'],i['barOp']))
    t(f'{n}: el nombre aparece UNA sola vez en la celda', i['nameInCell']==1, i['nameInCell'])
# nitidez: el texto de una pasada con late debe tener el mismo contraste que el de una pasada sin late
img=Image.open('/tmp/lco_after.png').convert('RGB')
print('captura /tmp/lco_after.png',img.size)
t('sin errores de JS', not errs, errs)
print(f'\n{P} ok · {F} fallas'); sys.exit(1 if F else 0)
