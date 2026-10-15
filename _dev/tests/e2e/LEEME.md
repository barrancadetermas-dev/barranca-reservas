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

Los arneses (`_dev/tests/harness/*.html|js`) copian el HTML del modal desde `index.html`:
si cambiás ese HTML, regenerarlos (ver el script en el historial de la revisión) o las pruebas verán la versión vieja.
