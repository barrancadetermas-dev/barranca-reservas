import fs from 'fs';

const f = 'js/components/statistics.js';
const lines = fs.readFileSync(f, 'utf8').split('\n');
const result = [];

for (let i = 0; i < lines.length; i++) {
  const n = i + 1; // número de línea (1-based)

  // Saltar el bloque problemático: prevRevenue + await + revDelta
  if (n >= 255 && n <= 273) continue;

  let line = lines[i];

  // Corregir referencias a deltaColor/deltaLabel que quedaron
  if (line.includes('deltaColor,') && line.includes('deltaLabel')) {
    line = line
      .replace('deltaColor,', "'blue',")
      .replace('deltaLabel', "'vs período'");
  }

  result.push(line);
}

fs.writeFileSync(f, result.join('\n'), 'utf8');
console.log('OK - statistics.js corregido');
