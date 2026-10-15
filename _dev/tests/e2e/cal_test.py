import sys
from datetime import datetime
from playwright.sync_api import sync_playwright
P=F=0
def t(n,c,x=''):
    global P,F
    if c: P+=1; print('✅',n)
    else: F+=1; print('❌',n,str(x)[:300])
def bk(id,ci,co,first,last,gender,unit='D2',src='direct',status='paid'):
    nights=(datetime.fromisoformat(co)-datetime.fromisoformat(ci)).days
    u={'D2':{'name':'Departamento 2','color':'#ef4444','sort_order':2},'D3':{'name':'Departamento 3','color':'#22c55e','sort_order':3}}[unit]
    return {'id':id,'check_in':ci,'check_out':co,'nights':nights,'status':status,'source':src,'is_blocked':False,'total_amount':50000*nights,'total_paid':50000*nights if status=='paid' else 0,'balance':0 if status=='paid' else 50000*nights,'pax':2,'adults':2,'children':0,'price_per_night':50000,
            'guests':{'first_name':first,'last_name':last,'gender':gender,'tags':[]},'booking_units':[{'unit_id':unit,'price_per_night':50000,'segment_check_in':None,'segment_check_out':None,'units':u}]}
def run(today, bookings):
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_context(viewport={'width':1400,'height':1000}).new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.clock.install(time=datetime.fromisoformat(today+'T12:00:00'))
        pg.goto('http://localhost:5199/_dev/tests/harness/harness-cal.html'); pg.wait_for_function('window.__ready===true')
        pg.evaluate("(a)=>{window.__data={'bookings:select':a.b,'units':window.__units,'payments:select':[]}}", {'b':bookings})
        pg.evaluate("window.cal.load()"); pg.wait_for_timeout(2500)
        bars=pg.evaluate("""()=>[...document.querySelectorAll('.bar')].map(e=>({text:e.textContent.replace(/\\s+/g,' ').trim(), sym:[...e.querySelectorAll('.g-sym')].map(s=>s.textContent), aria:[...e.querySelectorAll('.g-sym')].map(s=>s.getAttribute('aria-label')),
           chips:[...e.querySelectorAll('.sd-chip')].map(c=>c.textContent.trim()), title:(e.querySelector('.sd-chip')?.getAttribute('title')||''), html:e.innerHTML}))""")
        b.close(); return bars, errs
find=lambda bars,name: next((x for x in bars if name in x['text']), None)

# ── Noviembre 2026: Soberanía (finde largo 21–23) ──
bars,errs=run('2026-11-15',[bk('a','2026-11-20','2026-11-23','Ana','Gómez','female'),
                            bk('b','2026-11-25','2026-11-28','Luis','Díaz','male',unit='D2',src='booking',status='pending'),
                            bk('c','2026-11-24','2026-11-26','Eli','Ríos',None,unit='D3',src='family')])
a,l,e=find(bars,'Ana'),find(bars,'Luis'),find(bars,'Eli')
t('tarjeta con género Femenino muestra ♀ junto al nombre', a and a['sym']==['♀'] and a['aria']==['Femenino'], a)
t('el símbolo va pegado al nombre, no suelto en la tarjeta', a and a['text'].index('Gómez Ana')<a['text'].index('♀'))
t('fin de semana largo de Soberanía: "🇦🇷 Finde largo" en la tarjeta', a and a['chips']==['🇦🇷 Finde largo'], a and a['chips'])
t('el tooltip lista la fecha exacta del feriado', a and 'Soberanía' in a['title'] and '23/11' in a['title'], a and a['title'])
t('tarjeta con género Masculino muestra ♂', l and l['sym']==['♂'] and l['aria']==['Masculino'], l)
t('estadía sin fecha especial (25–28/11): sin chips, no se inventa un feriado', l and l['chips']==[], l and l['chips'])
t('huésped SIN género cargado: ningún símbolo (no se infiere por el nombre)', e and e['sym']==[], e)
t('reserva sin género ni fecha especial: tarjeta limpia', e and e['sym']==[] and e['chips']==[])
t('un solo chip principal por tarjeta (sin etiquetas duplicadas)', a and len([c for c in a['chips'] if 'Finde' in c])==1)
t('sin errores de JS', not errs, errs)

# ── Febrero 2027: Carnaval + verano ──
bars,errs=run('2027-02-05',[bk('m','2027-02-06','2027-02-10','Luis','Díaz','male')])
m=find(bars,'Luis')
t('Carnaval 2027 (6 al 9/2): "🎭 Carnaval" + ☀️ de verano en la misma tarjeta', m and m['chips']==['🎭 Carnaval','☀️'], m and m['chips'])
t('el tooltip lista Carnaval Y la temporada de verano', m and 'Carnaval' in m['title'] and 'Temporada de verano' in m['title'], m and m['title'])
t('Carnaval 2027 cae en febrero (no se fija el día): fechas del tooltip 6/02 al 9/02', m and '06/02 al 09/02' in m['title'], m and m['title'])
t('♂ junto al nombre también con fecha especial', m and m['sym']==['♂'])
t('sin errores de JS', not errs, errs)

# ── Fin de año: Año Nuevo + verano ──
bars,errs=run('2026-12-29',[bk('y','2026-12-30','2027-01-04','Ana','Gómez','nonbinary')])
y=find(bars,'Ana')
t('Año Nuevo: "🎆 Año Nuevo" + ☀️ (la estadía entra en la temporada)', y and y['chips']==['🎆 Año Nuevo','☀️'], y and y['chips'])
t('No binario: ⚧ accesible', y and y['sym']==['⚧'] and y['aria']==['No binario'], y)

# ── Verano sin otra fecha: solo ☀️ ──
bars,errs=run('2027-02-20',[bk('v','2027-02-22','2027-02-25','Eli','Ríos','female')])
v=find(bars,'Eli')
t('verano sin feriados: solo ☀️ (no se marca como feriado)', v and v['chips']==['☀️'], v and v['chips'])
# fuera de temporada
bars,errs=run('2026-10-20',[bk('o','2026-10-22','2026-10-25','Eli','Ríos','female')])
o=find(bars,'Eli')
t('fuera de temporada y sin feriado: sin ningún chip', o and o['chips']==[], o and o['chips'])
# escape del nombre
bars,errs=run('2026-10-20',[bk('x','2026-10-22','2026-10-25','<b>Hack</b>','Ríos','female')])
x=find(bars,'Hack')
t('nombres con HTML se muestran como texto (no se interpretan)', x and '<b>' in x['text'] and '<b>Hack' not in x['html'].replace('&lt;b&gt;','') , x and x['text'])
print(f"\n{P} ok · {F} fallos"); sys.exit(1 if F else 0)
