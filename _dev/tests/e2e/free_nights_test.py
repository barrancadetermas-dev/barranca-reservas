"""Noches sin cargo en el calendario: el degradé debe caer EXACTO en el borde de celda.
Mide píxeles reales (Playwright + PIL). Requiere vite en :5199 (ver LEEME.md)."""
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
def iso(d): return d.strftime('%Y-%m-%d')
def add(i,n): return iso(datetime.fromisoformat(i)+timedelta(days=n))
def bk(id,ci,co,last,unit='D2',free=0,units=None,**kw):
    n=(datetime.fromisoformat(co)-datetime.fromisoformat(ci)).days
    bu=units or [{'unit_id':unit,'segment_check_in':None,'segment_check_out':None}]
    d={'id':id,'check_in':ci,'check_out':co,'nights':n,'status':'partial','source':'direct','is_blocked':False,'total_amount':50000*(n-free),'total_paid':10000,'balance':50000*(n-free)-10000,'pax':2,'adults':2,'children':0,'price_per_night':50000,'free_nights':free,
       'guests':{'first_name':'X','last_name':last,'gender':None,'tags':[]},'booking_units':[{**u,'price_per_night':50000,'units':U[u['unit_id']]} for u in bu]}
    d.update(kw); return d
def is_yellow(p): return p[0]>200 and 120<p[1]<200 and p[2]<90
def is_red(p): return p[0]>180 and p[1]<80 and p[2]<80
TODAY='2026-10-19'
def run(bookings, start=TODAY):
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_context(viewport={'width':1500,'height':800}).new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.clock.install(time=datetime.fromisoformat(TODAY+'T12:00:00'))
        pg.goto('http://localhost:5199/_dev/tests/harness/harness-cal.html'); pg.wait_for_function('window.__ready===true')
        pg.add_style_tag(content='#login-screen{display:none!important}')
        pg.evaluate("()=>{let e=document.getElementById('calendar-grid');while(e&&e!==document.body){e.classList.remove('hidden');if(getComputedStyle(e).display==='none')e.style.display='block';e=e.parentElement}}")
        pg.evaluate("(a)=>{window.__data={'bookings:select':a.b,'units':window.__units,'payments:select':[]};window.cal._windowStart=a.s}",{'b':bookings,'s':start})
        pg.evaluate("window.cal.load()"); pg.wait_for_timeout(2000)
        grid=pg.locator('#calendar-grid')
        img=Image.open(io.BytesIO(grid.screenshot())).convert('RGB')
        gb=grid.bounding_box()   # DESPUÉS de la captura (puede haber scrolleado)
        cells=pg.evaluate("()=>[...document.querySelectorAll('.cal-cell')].map(c=>{const r=c.getBoundingClientRect();return {d:c.dataset.date,u:c.dataset.unitId,l:r.left,r:r.right,t:r.top,b:r.bottom}})")
        global LASTBARS
        LASTBARS=pg.evaluate("()=>[...document.querySelectorAll('.bar')].map(e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}})")
        b.close()
    return img,gb,cells,errs
def analyse(img,gb,cells,unit,dates):
    """devuelve (clases por noche, x del cruce de la transición, borde de celda esperado)"""
    byd={c['d']:c for c in cells if c['u']==unit}
    ys=lambda c: int(c['b']-gb['y']-9)   # franja baja de la barra, sin texto
    out=[]
    for d in dates:
        c=byd.get(d)
        if not c: out.append(None); continue
        p=img.getpixel((int((c['l']+c['r'])/2-gb['x']), ys(c)))
        out.append('Y' if is_yellow(p) else 'R' if is_red(p) else '?')
    return out
def crossing(img,gb,cells,unit,d_paid,d_free):
    byd={c['d']:c for c in cells if c['u']==unit}
    a,b=byd[d_paid],byd[d_free]; y=int(a['b']-gb['y']-9); edge=a['r']-gb['x']
    xs=range(int(edge-25),int(edge+25)); g=[img.getpixel((x,y))[1] for x in xs]
    for x,v in zip(xs,g):
        if v>=98: return x-edge
    return None

def case(name, bookings, unit, dates, expect, start=TODAY, cross=None):
    img,gb,cells,errs=run(bookings,start)
    got=analyse(img,gb,cells,unit,dates)
    t(f'{name}: celdas {"".join(expect)}', got==list(expect), got)
    if cross:
        dx=crossing(img,gb,cells,unit,*cross)
        t(f'{name}: centro de la transición a ≤2px del borde de celda', dx is not None and abs(dx)<=2.5, dx)
    t(f'{name}: sin errores JS', not errs, errs)

# 1 noche sin cargo (la última de 3)
d=lambda s,n:[add(s,i) for i in range(n)]
case('1 noche sin cargo',[bk('a','2026-10-21','2026-10-24','Uno','D3',free=1)],'D3',d('2026-10-21',3),'RRY',cross=('2026-10-22','2026-10-23'))
case('2 noches sin cargo',[bk('a','2026-10-25','2026-10-30','Dos','D3',free=2)],'D3',d('2026-10-25',5),'RRRYY',cross=('2026-10-27','2026-10-28'))
case('3 noches sin cargo',[bk('a','2026-10-22','2026-10-29','Tres','D2',free=3)],'D2',d('2026-10-22',7),'RRRRYYY',cross=('2026-10-25','2026-10-26'))
# ventana recortada a la izquierda: check-in 16/10 (oculto), 2 gratis = 20 y 21/10
case('recortada a la izquierda',[bk('a','2026-10-16','2026-10-22','Izq','D2',free=2)],'D2',d('2026-10-19',3),'RYY',cross=('2026-10-19','2026-10-20'))
# ventana recortada a la derecha: las gratis (18 y 19/11) quedan fuera de la vista → nada amarillo
case('gratis fuera de la vista (derecha)',[bk('a','2026-11-12','2026-11-20','Der','D2',free=2)],'D2',d('2026-11-12',3),'RRR')
# arranca después del late check-out de otra reserva en la misma unidad
case('tras un late check-out',[bk('l','2026-10-19','2026-10-21','Late','D3',late_checkout=True,late_checkout_charged=True),bk('a','2026-10-21','2026-10-25','Post','D3',free=1)],'D3',d('2026-10-22',3),'RRY',cross=('2026-10-23','2026-10-24'))
# estadía en dos unidades (cambio de depto): la noche gratis es la última de TODA la estadía → solo en D3
seg=[{'unit_id':'D2','segment_check_in':'2026-10-20','segment_check_out':'2026-10-23'},{'unit_id':'D3','segment_check_in':'2026-10-23','segment_check_out':'2026-10-26'}]
bseg=[bk('s','2026-10-20','2026-10-26','Seg',units=seg,free=1)]
case('estadía dividida: tramo 1 (D2) sin amarillo',bseg,'D2',d('2026-10-20',3),'RRR')
case('estadía dividida: tramo 2 (D3) con la última noche amarilla',bseg,'D3',d('2026-10-23',3),'RRY')
# reserva común sin noches gratis: sin amarillo
case('sin noches sin cargo',[bk('a','2026-10-21','2026-10-24','Nada','D3',free=0)],'D3',d('2026-10-21',3),'RRR')

# ── Reserva EN CURSO: el oscurecido de los días ya transcurridos también corta exacto en el borde de celda
def is_dark(p): return 120<p[0]<190 and p[1]<60 and p[2]<60
def cls3(img,gb,cells,unit,dates):
    byd={c['d']:c for c in cells if c['u']==unit}; out=[]
    for d in dates:
        c=byd[d]; p=img.getpixel((int((c['l']+c['r'])/2-gb['x']), int(LASTBARS[0]['b']-gb['y']-6)))
        out.append('D' if is_dark(p) else 'Y' if is_yellow(p) else 'R' if is_red(p) else '?')
    return out
img,gb,cells,errs=run([bk('e','2026-10-17','2026-10-22','Curso','D2')],'2026-10-15')
got=cls3(img,gb,cells,'D2',d('2026-10-17',5)); t('en curso: 17-18 oscuros (pasados), 19-21 color pleno', got==list('DDRRR'), got)
byd={c['d']:c for c in cells if c['u']=='D2'}; a=byd['2026-10-18']; y=int(LASTBARS[0]['b']-gb['y']-6); edge=a['r']-gb['x']
xs=[x for x in range(int(edge-12),int(edge+12)) if img.getpixel((x,y))[0]>=190]
t('en curso: el corte cae a ≤2px del borde de celda', bool(xs) and abs(xs[0]-edge)<=2.5, (xs[:1],edge))
img,gb,cells,errs=run([bk('e','2026-10-17','2026-10-23','CursoGratis','D2',free=2)],'2026-10-15')
got=cls3(img,gb,cells,'D2',d('2026-10-17',6)); t('en curso con 2 noches sin cargo: DDRRYY', got==list('DDRRYY'), got)

# ── Tooltip y color de la extensión de late check-out por tramo
def page_for(bks,start=TODAY):
    pw=sync_playwright().start(); b=pw.chromium.launch(); pg=b.new_context(viewport={'width':1500,'height':800}).new_page()
    pg.clock.install(time=datetime.fromisoformat(TODAY+'T12:00:00'))
    pg.goto('http://localhost:5199/_dev/tests/harness/harness-cal.html'); pg.wait_for_function('window.__ready===true')
    pg.add_style_tag(content='#login-screen{display:none!important}')
    pg.evaluate("()=>{let e=document.getElementById('calendar-grid');while(e&&e!==document.body){e.classList.remove('hidden');if(getComputedStyle(e).display==='none')e.style.display='block';e=e.parentElement}}")
    pg.evaluate("(a)=>{window.__data={'bookings:select':a.b,'units':window.__units,'payments:select':[]};window.cal._windowStart=a.s}",{'b':bks,'s':start})
    pg.evaluate("window.cal.load()"); pg.wait_for_timeout(1500); return pw,b,pg
pw,b,pg=page_for([bk('a','2026-10-21','2026-10-25','Tip','D3',free=2)])
pg.locator('.bar').first.hover(); pg.wait_for_timeout(400); tip=pg.evaluate("document.querySelector('.cal-tooltip')?.innerText||''")
b.close(); pw.stop()
t('tooltip: lista exactamente las noches sin cargo (23/10 · 24/10)', 'Sin cargo: 23/10 · 24/10' in tip, tip)
pw,b,pg=page_for([bk('s','2026-10-20','2026-10-26','Seg',units=seg,free=1,late_checkout=True,late_checkout_charged=True)])
ext=pg.evaluate("[...document.querySelectorAll('.bar-lco-ext')].map(e=>[e.parentElement.dataset.unitId,getComputedStyle(e).backgroundColor])")
b.close(); pw.stop()
t('estadía dividida + late check-out: extensión del tramo intermedio NO es amarilla, la del último sí', dict(ext).get('D2')=='rgb(220, 38, 38)' and dict(ext).get('D3')=='rgb(239, 159, 39)', ext)
print(f'\n{P} ok · {F} fallas'); sys.exit(1 if F else 0)
