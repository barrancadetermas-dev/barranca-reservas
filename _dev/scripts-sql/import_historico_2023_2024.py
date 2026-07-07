#!/usr/bin/env python3
"""
MILA PMS — Importador histórico 2023-2024
Genera SQL para insertar reservas desde el cuaderno Excel.

USO:
  python3 import_historico_2023_2024.py

ANTES DE CORRER:
  1. Completar UNIT_MAP con los UUIDs reales de Supabase
  2. Completar HOTEL_ID con el hotel_id real
  3. Revisar el SQL generado antes de ejecutarlo en Supabase

El script genera 2 archivos:
  - import_INSERT.sql  → las reservas a insertar
  - import_PREVIEW.csv → previsualización para revisar antes de correr el SQL
"""

import pandas as pd
import re, uuid
from datetime import datetime

# ══════════════════════════════════════════════════
# CONFIGURAR ANTES DE CORRER
# ══════════════════════════════════════════════════
HOTEL_ID = '363c06ec-4080-40a8-a7c7-ba44544725ca'

# Completar con los UUIDs reales de la tabla 'units' en Supabase
# (sort_order 1 → 7)
UNIT_MAP = {
    1: 'COMPLETAR_UUID_UNIDAD_1',
    2: 'COMPLETAR_UUID_UNIDAD_2',
    3: 'COMPLETAR_UUID_UNIDAD_3',
    4: 'COMPLETAR_UUID_UNIDAD_4',
    5: 'COMPLETAR_UUID_UNIDAD_5',
    6: 'COMPLETAR_UUID_UNIDAD_6',
    7: 'COMPLETAR_UUID_UNIDAD_7',
}

EXCEL_PATH = '/mnt/user-data/uploads/LIBRO.xlsx'
# ══════════════════════════════════════════════════

def sq(s):
    """Escapar string para SQL"""
    return str(s).replace("'", "''") if s else ''

def clean_name(s):
    s = re.sub(r'\(.*?\)', '', str(s)).strip()
    s = re.sub(r'GOLONDRINA', '', s, flags=re.IGNORECASE).strip()
    parts = s.split()
    if len(parts) >= 2:
        return parts[0].title(), ' '.join(parts[1:]).title()
    return s.title(), ''

def detect_source(nota):
    n = str(nota).upper()
    if 'BOOKING'   in n: return 'booking'
    if 'AIRBNB'    in n: return 'airbnb'
    if 'FAMILIA'   in n: return 'family'
    if 'GOLONDRINA'in n: return 'walkin'
    return 'direct'

def detect_method(nota, is_previaje):
    n = str(nota).upper()
    if 'TARJETA' in n or 'CREDITO' in n or 'CRÉDITO' in n: return 'credit_card'
    if is_previaje: return 'transfer'
    return 'transfer'

def safe_float(v, default=0):
    try:
        s = str(v).strip().replace(',','.')
        if not s or s.lower() in ('nan','none','a cuenta',''): return default
        return float(re.sub(r'[^\d.]', '', s) or '0')
    except: return default

# Cargar datos
df = pd.read_excel(EXCEL_PATH, sheet_name='Hoja1', header=None)
df.columns = ['nombre','depto','pax','ingreso','salida','noches','precio_noche',
              'senia','total','cobrado','nota','x1','x2','x3','x4','x5','x6']
df = df.dropna(subset=['nombre'])
df = df[df['nombre'].astype(str).str.strip() != 'nan']
df['ing_dt'] = pd.to_datetime(df['ingreso'], errors='coerce')
df['sal_dt'] = pd.to_datetime(df['salida'],  errors='coerce')

# Filtros
mask = (
    (df['ing_dt'] >= '2023-06-01') &
    (df['ing_dt'] <= '2024-04-30') &
    (~df['depto'].astype(str).str.contains(r'[Yy,\+&]|-', na=False, regex=True)) &
    (~df['precio_noche'].astype(str).str.contains('USD|U\$D|dolar', case=False, na=False)) &
    (df['depto'].astype(str).str.strip().isin(['1','2','3','4','5','6','7'])) &
    df['ing_dt'].notna() & df['sal_dt'].notna()
)
filtered = df[mask].copy()

insert_lines = []
booking_unit_lines = []
guest_lines = []
payment_lines = []
preview_rows = []
now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

for _, row in filtered.iterrows():
    nota    = str(row['nota']).strip()   if pd.notna(row['nota'])    else ''
    cobrado = str(row['cobrado']).strip().upper() if pd.notna(row['cobrado']) else ''
    nota_up = nota.upper()
    is_previaje   = 'PREVIAJE'  in cobrado
    is_cancelled  = 'CANCEL'    in cobrado
    is_postergado = 'POSTERG'   in cobrado
    is_acuenta    = 'CUENTA'    in cobrado
    is_golondrina = 'GOLONDRINA'in nota_up
    is_nc = is_cancelled or is_postergado or is_acuenta

    total = safe_float(row['total'])
    senia = safe_float(row['senia'])
    pax   = max(1, int(safe_float(row['pax'], 1)))
    ppn   = safe_float(row['precio_noche'])
    noches= max(1, int(safe_float(row['noches'], 1)))
    depto = int(float(row['depto']))
    unit_id = UNIT_MAP.get(depto)
    if not unit_id or 'COMPLETAR' in unit_id:
        print(f"⚠️  UNIT_MAP no configurado para depto {depto} — saltear")
        continue

    fname, lname = clean_name(row['nombre'])
    source       = detect_source(nota)
    method       = detect_method(nota, is_previaje)

    if is_cancelled or is_postergado:
        status     = 'cancelled'
        total_paid = senia
        nc_amount  = senia
        nota_final = nota[:180] + (f' | 🔄NC:${int(senia):,}'.replace(',','.') if senia > 0 else '')
    elif is_acuenta:
        status     = 'paid'
        total_paid = total if total > 0 else senia
        nc_amount  = senia
        nota_final = nota[:180] + (f' | 🔄NC:${int(senia):,}'.replace(',','.') if senia > 0 else '')
    elif is_previaje:
        status     = 'paid'
        total_paid = total
        nc_amount  = 0
        nota_final = nota[:200]
    elif is_golondrina and senia == 0:
        status     = 'paid'
        total_paid = total
        nc_amount  = 0
        method     = 'cash'
        nota_final = nota[:200]
    else:
        status     = 'paid'
        total_paid = total
        nc_amount  = 0
        nota_final = nota[:200]

    balance = max(0, total - total_paid)

    bid = str(uuid.uuid4())
    gid = str(uuid.uuid4())
    pid = str(uuid.uuid4())
    check_in  = row['ing_dt'].strftime('%Y-%m-%d')
    check_out = row['sal_dt'].strftime('%Y-%m-%d')

    # guest INSERT
    guest_lines.append(
        f"INSERT INTO guests (id, hotel_id, first_name, last_name, created_at) "
        f"VALUES ('{gid}', '{HOTEL_ID}', '{sq(fname)}', '{sq(lname)}', '{now}');"
    )

    # booking INSERT
    insert_lines.append(
        f"INSERT INTO bookings (id, hotel_id, guest_id, check_in, check_out, nights, pax, "
        f"price_per_night, total_amount, total_paid, balance, status, source, notes, created_at) "
        f"VALUES ('{bid}', '{HOTEL_ID}', '{gid}', '{check_in}', '{check_out}', {noches}, {pax}, "
        f"{ppn}, {total}, {total_paid}, {balance}, '{status}', '{source}', "
        f"'{sq(nota_final)}', '{now}');"
    )

    # booking_units INSERT
    booking_unit_lines.append(
        f"INSERT INTO booking_units (booking_id, unit_id, hotel_id, price_per_night) "
        f"VALUES ('{bid}', '{unit_id}', '{HOTEL_ID}', {ppn});"
    )

    # payment INSERT (solo si hay monto pagado real)
    if total_paid > 0 and not is_cancelled and not is_postergado:
        payment_lines.append(
            f"INSERT INTO payments (id, booking_id, hotel_id, amount, amount_ars, currency, "
            f"exchange_rate, method, payment_date, notes) "
            f"VALUES ('{pid}', '{bid}', '{HOTEL_ID}', {total_paid}, {total_paid}, 'ARS', 1, "
            f"'{method}', '{check_in}', 'Importado desde cuaderno histórico');"
        )

    preview_rows.append({
        'nombre': f'{fname} {lname}',
        'depto': depto,
        'check_in': check_in,
        'check_out': check_out,
        'total': total,
        'total_paid': total_paid,
        'status': status,
        'source': source,
        'method': method,
        'nc': nc_amount,
        'nota': nota_final[:60],
    })

# Escribir SQL
sql_lines = [
    '-- ══════════════════════════════════════════════',
    '-- MILA PMS — Importación histórica 2023-2024',
    f'-- Generado: {now}',
    f'-- Total reservas: {len(insert_lines)}',
    '-- ══════════════════════════════════════════════',
    '-- PASO 1: Huéspedes',
    '',
] + guest_lines + [
    '',
    '-- PASO 2: Reservas',
    '',
] + insert_lines + [
    '',
    '-- PASO 3: Relación reserva-unidad',
    '',
] + booking_unit_lines + [
    '',
    '-- PASO 4: Pagos',
    '',
] + payment_lines

with open('/home/claude/import_INSERT.sql', 'w') as f:
    f.write('\n'.join(sql_lines))

pd.DataFrame(preview_rows).to_csv('/home/claude/import_PREVIEW.csv', index=False)

print(f"✅ SQL generado: {len(insert_lines)} reservas, {len(payment_lines)} pagos")
print(f"   Canceladas/NC: {sum(1 for r in preview_rows if r['status']=='cancelled')}")
print(f"   Archivo: /home/claude/import_INSERT.sql")
print(f"   Preview: /home/claude/import_PREVIEW.csv")
