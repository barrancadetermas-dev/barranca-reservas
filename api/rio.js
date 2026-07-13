// api/rio.js — Vercel Serverless — Proxy nivel Río Uruguay

const GEOSERVER = 'https://alerta.ina.gob.ar/geoserver';
const KEYWORDS  = ['concepcion', 'uruguay'];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function get(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r    = await fetch(url, {
      headers: { 'User-Agent': 'MILA-PMS/1.0', 'Accept': '*/*' },
      signal: ctrl.signal,
    });
    const text = await r.text();
    clearTimeout(t);
    return { status: r.status, ok: r.ok, text };
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// Extrae el primer layer que matchea keywords del XML de GetCapabilities
function findLayerInCapabilities(xml) {
  const nameRx   = /<(?:Name|FeatureType)>([\w:]+)<\/(?:Name|FeatureType)>/g;
  const layerRx  = /<(?:FeatureType|Layer)>[\s\S]*?<\/(?:FeatureType|Layer)>/g;

  // Buscar todos los Name dentro de FeatureType
  let match;
  const names = [];
  while ((match = nameRx.exec(xml)) !== null) names.push(match[1]);

  const lower = names.map(n => n.toLowerCase());
  // Buscar layer que contenga "altura" o "nivel" y "ina" o "alerta"
  const found = names.find((_, i) =>
    (lower[i].includes('altura') || lower[i].includes('nivel')) &&
    !lower[i].includes('test')
  ) ?? names.find((_, i) => lower[i].includes('altura'))
    ?? names.find((_, i) => lower[i].includes('nivel'));

  return found ?? null;
}

// Parsear GML/XML de WFS para extraer datos de la estación
function parseGML(xml) {
  const features = [];
  // Regex para bloques de feature (funciona para GML 2 y 3)
  const blockRx = /<(?:\w+:)?(?:featureMember|member)>([\s\S]*?)<\/(?:\w+:)?(?:featureMember|member)>/g;
  let block;
  while ((block = blockRx.exec(xml)) !== null) {
    const content = block[1];
    const get = tag => {
      const m = new RegExp(`<[\\w:]*${tag}[^>]*>([^<]*)<\\/[\\w:]*${tag}>`, 'i').exec(content);
      return m ? m[1].trim() : null;
    };
    const nombre = get('nombre') ?? get('name');
    const valor  = parseFloat(get('valor') ?? get('altura') ?? get('nivel') ?? '');
    const alerta = parseFloat(get('nivel_alerta') ?? get('alerta') ?? '');
    if (nombre) features.push({ nombre, valor: isNaN(valor) ? null : valor, nivel_alerta: isNaN(alerta) ? null : alerta });
  }
  return features;
}

// Buscar la estación Concepción del Uruguay en el array de features
function findStation(features) {
  return features.find(f =>
    KEYWORDS.every(k => (f.nombre ?? '').toLowerCase().includes(k))
  ) ?? features.find(f =>
    (f.nombre ?? '').toLowerCase().includes('concepcion')
  ) ?? null;
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const log = [];

  // ── Paso 1: GetCapabilities para descubrir nombre real del layer ──────────
  let layerName = 'alerta5:ultimas_alturas'; // default
  try {
    const caps = await get(`${GEOSERVER}/wfs?service=WFS&version=1.0.0&request=GetCapabilities`);
    log.push({ step: 'GetCapabilities', status: caps.status });
    if (caps.ok) {
      const found = findLayerInCapabilities(caps.text);
      if (found) { layerName = found; log.push({ step: 'layer_found', layer: layerName }); }
      else {
        // Extraer todos los nombres para diagnóstico
        const allNames = [...caps.text.matchAll(/<Name>([\w:]+)<\/Name>/g)].map(m => m[1]);
        log.push({ step: 'layer_not_found', all_names: allNames.slice(0, 30) });
      }
    }
  } catch (e) {
    log.push({ step: 'GetCapabilities_error', error: e.message });
  }

  // ── Paso 2: WFS GetFeature con outputFormat=json ───────────────────────────
  const formats = ['json', 'application/json', 'text/javascript'];
  for (const fmt of formats) {
    const url = `${GEOSERVER}/wfs?service=WFS&version=1.0.0&request=GetFeature`
      + `&typeName=${encodeURIComponent(layerName)}&outputFormat=${encodeURIComponent(fmt)}&maxFeatures=500`;
    try {
      const r = await get(url);
      log.push({ step: `WFS-json-${fmt}`, status: r.status, isXML: r.text.trimStart().startsWith('<') });
      if (r.ok && !r.text.trimStart().startsWith('<')) {
        const data = JSON.parse(r.text);
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
        res.setHeader('X-Source', `WFS-json:${fmt}`);
        return res.status(200).json({ ...data, _log: log });
      }
    } catch (e) {
      log.push({ step: `WFS-json-${fmt}`, error: e.message });
    }
  }

  // ── Paso 3: WFS GetFeature con GML (XML) + parser propio ─────────────────
  const urlGML = `${GEOSERVER}/wfs?service=WFS&version=1.0.0&request=GetFeature`
    + `&typeName=${encodeURIComponent(layerName)}&maxFeatures=500`;
  try {
    const r = await get(urlGML);
    log.push({ step: 'WFS-GML', status: r.status, len: r.text.length });
    if (r.ok || r.text.includes('<gml:')) {
      const features = parseGML(r.text);
      log.push({ step: 'GML-parsed', count: features.length });
      if (features.length > 0) {
        const station = findStation(features);
        if (station) {
          res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
          res.setHeader('X-Source', 'WFS-GML');
          // Devolver en formato compatible con GeoJSON
          return res.status(200).json({
            type: 'FeatureCollection',
            features: features.map(f => ({ type: 'Feature', properties: f })),
            _log: log,
          });
        }
        log.push({ step: 'station_not_found', available: features.map(f=>f.nombre).slice(0,10) });
      } else {
        log.push({ step: 'GML_preview', text: r.text.slice(0, 300) });
      }
    }
  } catch (e) {
    log.push({ step: 'WFS-GML-error', error: e.message });
  }

  // ── Sin datos ─────────────────────────────────────────────────────────────
  console.error('[api/rio] sin datos. Log:', JSON.stringify(log));
  return res.status(502).json({ error: 'Sin datos del INA', log });
}
