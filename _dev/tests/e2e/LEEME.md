# Pruebas de integración (Playwright + Vite)

Montan el HTML real de Mila con una base de datos SIMULADA (no tocan Supabase) y manejan la interfaz con clics reales.

## Preparación (una vez)
    pip install playwright && playwright install chromium
    npm install            # incluye vite; para editor_test.mjs además:  npm i -D jsdom
    printf 'VITE_SUPABASE_URL=http://localhost:9\nVITE_SUPABASE_ANON_KEY=dummy\n' > .env.local   # valores falsos: solo para arrancar
    npx vite --port 5199 --strictPort &

## Ejecutar
    for t in _dev/tests/e2e/*_test*.py; do python3 $t; done
    node _dev/tests/e2e/editor_test.mjs && node _dev/tests/e2e/avail_test.mjs
    node _dev/tests/e2e/run_node_tests.mjs _dev/tests/unit/special-dates.test.js     # (y los demás unit/*.test.js)

Los arneses (`_dev/tests/harness/*.html`) copian el HTML REAL de `index.html` (y sus 7 hojas de estilo).
**Si cambiás ese HTML, regenerarlos antes de probar:**

    python3 _dev/tests/e2e/regen_harness.py

(si no, las pruebas ven la versión vieja del formulario). Además:

    node _dev/tests/e2e/undef_check.mjs     # detecta imports que faltan (el build de Vite no los marca)
