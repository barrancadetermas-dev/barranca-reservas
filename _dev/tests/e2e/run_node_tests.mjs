// Ejecuta en Node los tests unitarios pensados para el navegador (framework de _dev/tests/unit).
// Uso:  node _dev/tests/e2e/run_node_tests.mjs _dev/tests/unit/special-dates.test.js [otros...]
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const els = []; const mk = () => ({ className: '', textContent: '', appendChild: c => els.push(c) });
globalThis.document = { getElementById: () => mk(), createElement: () => { const e = mk(); els.push(e); return e; } };
for (const f of process.argv.slice(2)) await import(pathToFileURL(path.resolve(f)).href);
const fails = els.filter(e => e.className?.includes('fail')); const oks = els.filter(e => e.className?.includes('pass'));
console.log(`pasaron ${oks.length} · fallaron ${fails.length}`); fails.forEach(f => console.log(f.textContent));
process.exit(fails.length ? 1 : 0);
