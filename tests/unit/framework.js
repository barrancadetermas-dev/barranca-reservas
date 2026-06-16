// tests/unit/framework.js — Test runner minimalista (sin dependencias)
const results = { passed: 0, failed: 0, total: 0 };
const out     = () => document.getElementById('output');

export function describe(section, fn) {
  const el = document.createElement('div');
  el.className = 'section';
  el.textContent = section;
  out()?.appendChild(el);
  fn();
}

export function test(name, fn) {
  results.total++;
  const el = document.createElement('div');
  el.className = 'result';
  try {
    fn();
    results.passed++;
    el.className += ' pass';
    el.textContent = `✅ ${name}`;
  } catch (e) {
    results.failed++;
    el.className += ' fail';
    el.textContent = `❌ ${name} — ${e.message}`;
  }
  out()?.appendChild(el);
  updateSummary();
}

export function expect(actual) {
  return {
    toBe:            (expected) => { if (actual !== expected) throw new Error(`esperaba ${JSON.stringify(expected)}, recibí ${JSON.stringify(actual)}`); },
    toEqual:         (expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`esperaba ${JSON.stringify(expected)}, recibí ${JSON.stringify(actual)}`); },
    toBeGreaterThan: (n)        => { if (!(actual > n)) throw new Error(`${actual} no es mayor que ${n}`); },
    toBeLessThan:    (n)        => { if (!(actual < n)) throw new Error(`${actual} no es menor que ${n}`); },
    toContain:       (v)        => { if (!actual.includes(v)) throw new Error(`${JSON.stringify(actual)} no contiene ${JSON.stringify(v)}`); },
    toBeTruthy:      ()         => { if (!actual) throw new Error(`${JSON.stringify(actual)} no es truthy`); },
    toBeFalsy:       ()         => { if (actual) throw new Error(`${JSON.stringify(actual)} no es falsy`); },
  };
}

function updateSummary() {
  const el = document.getElementById('summary');
  if (!el) return;
  const allDone = results.total > 0;
  el.className = results.failed === 0 ? 'pass-bg' : 'fail-bg';
  el.textContent = allDone
    ? `${results.passed} de ${results.total} tests pasaron${results.failed ? ` · ${results.failed} fallaron` : ''}`
    : '';
}
