"""Filtro por unidad: oculta filas COMPLETAS (etiqueta + celdas) sin desfasar la grilla, y filtra también las tarjetas de
'próximas reservas' y el cuadro tarifario. Doble click en una unidad = solo esa. Limpiar restaura todo."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__file__))
from _cal_helpers import *
R = Report()
B = [bk(f'b{i}', '2026-10-%02d' % (21 + i % 3), '2026-10-%02d' % (24 + i % 3), f'Huesped{i}', f'D{i}') for i in range(1, 8)]
SEL = ['D1', 'D3', 'D5', 'D7']
with sync_playwright() as p:
    b, pg, errs = open_calendar(p, B)
    R.t('botón Disponibilidad con nombre visible', 'Disponibilidad' in pg.locator('#cal-avail-toggle').inner_text())
    pg.evaluate("(s)=>{window.cal._filters={status:new Set(),source:new Set(),units:new Set(s)};window.cal._applyFilters(true)}", SEL)
    pg.wait_for_timeout(700)
    lab = pg.evaluate("""()=>[...document.querySelectorAll('.cal-unit-label[data-unit-id]')].filter(e=>getComputedStyle(e).display!=='none').map(e=>({id:e.dataset.unitId,x:Math.round(e.getBoundingClientRect().left),y:Math.round(e.getBoundingClientRect().top)}))""")
    R.t('solo quedan las etiquetas de las unidades elegidas', sorted(l['id'] for l in lab) == SEL, lab)
    R.t('las etiquetas siguen alineadas en la 1ª columna (grilla no desfasada)', len({l['x'] for l in lab}) == 1, lab)
    rows = pg.evaluate("""()=>{const g=document.getElementById('calendar-grid');return [...new Set([...g.querySelectorAll('.cal-cell[data-unit-id]')].filter(c=>getComputedStyle(c).display!=='none').map(c=>c.dataset.unitId))]}""")
    R.t('las celdas visibles son solo de esas unidades', sorted(rows) == SEL, rows)
    ys = [l['y'] for l in lab]; R.t('filas apiladas sin huecos (mismo paso vertical)', len({ys[i+1]-ys[i] for i in range(len(ys)-1)}) == 1, ys)
    cards = pg.evaluate("""()=>[...document.querySelectorAll('.cal-agenda-slot:not(.cal-agenda-slot--empty)')].map(e=>e.textContent)""")
    R.t('tarjetas de próximas reservas: solo unidades filtradas', len(cards) == len(SEL) and all(any(f'Unidad {n[1]}' in c for c in cards) for n in SEL), cards)
    R.t('tarjetas: ninguna de las unidades ocultas', not any(f'Unidad {k}' in ' '.join(cards) for k in (2, 4, 6)), cards)
    tf = pg.evaluate("""()=>[...document.querySelectorAll('#cal-tariff-wrap .cal-tf-unit')].filter(e=>!e.classList.contains('cal-row-hidden')&&e.closest('tr')&&getComputedStyle(e.closest('tr')).display!=='none').map(e=>e.dataset.unitId)""")
    R.t('cuadro tarifario: solo las unidades filtradas', sorted(tf) == SEL, tf)
    # doble click en una unidad desde el popover = solo esa
    pg.evaluate("window.cal._filters={status:new Set(),source:new Set(),units:new Set()};window.cal._applyFilters(true)")
    pg.locator('#cal-filter-btn').click(); pg.wait_for_timeout(300)
    # dos clicks consecutivos (detail 1 y 2) sobre el chip; el popover se vuelve a dibujar entre uno y otro
    for n in (1, 2):
        pg.evaluate("(n)=>document.querySelector('#cal-filter-pop .cal-chip[data-kind=\"units\"][data-val=\"D4\"]').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:n}))", n)
    pg.wait_for_timeout(500)
    only = pg.evaluate("[...window.cal._filters.units]")
    R.t('doble click en una unidad = solo esa unidad', only == ['D4'], only)
    lab = pg.evaluate("""()=>[...document.querySelectorAll('.cal-unit-label[data-unit-id]')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.dataset.unitId)""")
    R.t('y la grilla muestra solo esa fila', lab == ['D4'], lab)
    pg.evaluate("document.getElementById('cal-filter-clear').dispatchEvent(new MouseEvent('click',{bubbles:true}))"); pg.wait_for_timeout(500)
    lab = pg.evaluate("""()=>[...document.querySelectorAll('.cal-unit-label[data-unit-id]')].filter(e=>getComputedStyle(e).display!=='none').length""")
    cards = pg.evaluate("document.querySelectorAll('.cal-agenda-slot:not(.cal-agenda-slot--empty)').length")
    R.t('Limpiar restaura filas y tarjetas', lab == 7 and cards == 7, (lab, cards))
    R.t('sin errores de JS', not errs, errs); b.close()
R.done()
