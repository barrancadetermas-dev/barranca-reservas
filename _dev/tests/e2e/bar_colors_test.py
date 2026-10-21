"""Colores de barra: Booking celeste · Airbnb naranja · Familia lila · Expedia naranja rojizo → degradé del canal al color de estado.
Resto de canales: verde pagada / rojo seña / amarillo sin seña. Noches sin cargo → degradé a amarillo."""
import sys, re; sys.path.insert(0, __import__('os').path.dirname(__file__))
from _cal_helpers import *
R = Report()
def hexrgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def has(bg, hexcolor): r, g, b = hexrgb(hexcolor); return f'rgb({r}, {g}, {b})' in bg
S = dict(paid='#16A34A', partial='#DC2626', pending='#EAB308')
CH = dict(booking='#0EA5E9', airbnb='#F97316', family='#8B5CF6', expedia='#E8501A')
B = [bk('1', '2026-10-21', '2026-10-25', 'Bk', 'D1', source='booking', status='paid', total_paid=200000, balance=0),
     bk('2', '2026-10-21', '2026-10-25', 'Ab', 'D2', source='airbnb', status='pending', total_paid=0, balance=200000),
     bk('3', '2026-10-21', '2026-10-25', 'Fa', 'D3', source='family', status='partial'),
     bk('4', '2026-10-21', '2026-10-25', 'Ex', 'D4', source='expedia', status='paid', total_paid=200000, balance=0),
     bk('5', '2026-10-21', '2026-10-25', 'DirPag', 'D5', status='paid', total_paid=200000, balance=0),
     bk('6', '2026-10-21', '2026-10-25', 'DirSena', 'D6'),
     bk('7', '2026-10-21', '2026-10-25', 'DirSin', 'D7', status='pending', total_paid=0, balance=200000),
     bk('8', '2026-10-27', '2026-10-30', 'FaGratis', 'D3', source='family', status='partial', free_nights=1, total_amount=100000),
     bk('9', '2026-10-27', '2026-10-30', 'BkRecargo', 'D1', source='booking', status='pending', total_paid=0, surcharge_amount=60000, total_amount=210000)]
with sync_playwright() as p:
    b, pg, errs = open_calendar(p, B)
    bg = lambda key: pg.evaluate("(k)=>{const b=[...document.querySelectorAll('.bar-span')].find(x=>x.textContent.replace(/\\s/g,'').includes(k));return b?(b.style.background||getComputedStyle(b).backgroundImage):null}", key)
    for key, ch, st, label in [('Bk', 'booking', 'paid', 'Booking pagada'), ('Ab', 'airbnb', 'pending', 'Airbnb sin seña'), ('Fa', 'family', 'partial', 'Familia señada'), ('Ex', 'expedia', 'paid', 'Expedia pagada')]:
        v = bg(key) or ''
        R.t(f'{label}: gradiente del canal al estado', 'linear-gradient' in v and has(v, CH[ch]) and has(v, S[st]), v)
        rgb = lambda h: 'rgb(%d, %d, %d)' % hexrgb(h)
        R.t(f'{label}: empieza con el color del canal (y termina con el del estado)', 0 <= v.find(rgb(CH[ch])) < v.rfind(rgb(S[st])), v)
    for key, st, label in [('DirPag', 'paid', 'Directa pagada'), ('DirSena', 'partial', 'Directa señada'), ('DirSin', 'pending', 'Directa sin seña')]:
        v = bg(key) or ''
        R.t(f'{label}: color plano de estado', has(v, S[st]) and 'linear-gradient' not in v, v)
    v = bg('FaGratis') or ''
    R.t('Familia con noche sin cargo: lila → estado → amarillo', has(v, CH['family']) and (has(v, '#FACC15') or has(v, '#EF9F27')), v)
    v = bg('BkRecargo') or ''
    last = re.findall(r'rgb\((\d+), (\d+), (\d+)\)', v)[-1:]
    R.t('Booking con recargo: el tramo final no queda casi negro', bool(last) and sum(map(int, last[0])) > 150, v)
    R.t('sin errores de JS', not errs, errs); b.close()
R.done()
