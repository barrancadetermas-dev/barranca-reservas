// api/rio.js — Vercel Serverless — Proxy nivel Río Uruguay
// Layer correcto descubierto: siyah:alturas_sim_view

const GEOSERVER    = 'https://alerta.ina.gob.ar/geoserver';
const PRIMARY_LAYER = 'siyah:alturas_sim_view';   // nombre real del INA
const FALLBACK_LAYER = 'alerta5:ultimas_alturas'; // por si cambia de nuevo

async function get(url, ms = 10000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  try {
    const r    = await fetch(url, {
      headers: { 'User-Agent': 'MILA-PMS/1.0', 'Accept': '*/*' },
      signal: ctrl.signal,
    });
    const text = await r.text();
    clearTimeout(t);
    return { status: r.status, ok: r.ok, text };
  } catch (e) { clearTimeout(t); throw e; }
}

function isXML(text) { return text.trimStart().startsWith('<'); }

// Parsear GML como fallback si JSON no funciona
function parseGML(xml) {
  const features = [];
  const blockRx  = /<(?:\w+:)?(?:featureMember|member)>([\s\S]*?)<\/(?:\w+:)?(?:featureMember|member)>/g;
  let b;
  while ((b = blockRx.exec(xml)) !== null) {
    const c   = b[1];
    const val = tag => {
      const m = new RegExp(`<[\\w:]*${tag}[^>]*>([^<]*)<\\/[\\w:]*${tag}>`, 'i').exec(c);
      return m ? m[1].trim() : null;
    };
    const nombre = val('nombre') ?? val('name');
    const valor  = parseFloat(val('valor') ?? val('altura') ?? val('nivel') ?? '');
    const alerta = parseFloat(val('nivel_alerta') ?? val('alerta') ?? '');
    if (nombre) features.push({
      nombre,
      valor:        isNaN(valor) ? null : valor,
      nivel_alerta: isNaN(alerta) ? null : alerta,
    });
  }
  return features;
}

async function fetchLayer(layerName) {
  // Intento 1: JSON
  const urlJson = `${GEOSERVER}/wfs?service=WFS&version=1.0.0&request=GetFeature`
    + `&typeName=${encodeURIComponent(layerName)}&outputFormat=json&maxFeatures=500`;
  try {
    const r = await get(urlJson);
    if (r.ok && !isXML(r.text)) {
      const data = JSON.parse(r.text);
      return { ok: true, data, method: 'json' };
    }
  } catch (e) { /* seguir */ }

  // Intento 2: GML → parser propio
  const urlGML = `${GEOSERVER}/wfs?service=WFS&version=1.0.0&request=GetFeature`
    + `&typeName=${encodeURIComponent(layerName)}&maxFeatures=500`;
  try {
    const r = await get(urlGML);
    if (r.text.includes('<gml:')) {
      const features = parseGML(r.text);
      if (features.length > 0) {
        return {
          ok: true,
          method: 'gml',
          data: {
            type: 'FeatureCollection',
            features: features.map(f => ({ type: 'Feature', properties: f })),
          },
        };
      }
    }
  } catch (e) { /* seguir */ }

  return { ok: false };
}

// Si el layer primario falla, redescubrir con GetCapabilities
async function discoverLayer() {
  try {
    const r = await get(`${GEOSERVER}/wfs?service=WFS&version=1.0.0&request=GetCapabilities`);
    if (!r.ok) return null;
    const names = [...r.text.matchAll(/<Name>([\w:]+)<\/Name>/g)].map(m => m[1]);
    return names.find(n => n.toLowerCase().includes('altura') || n.toLowerCase().includes('nivel')) ?? null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Intentar con el layer conocido primero
  let result = await fetchLayer(PRIMARY_LAYER);

  // Si falla, intentar redescubrir
  if (!result.ok) {
    const discovered = await discoverLayer();
    if (discovered && discovered !== PRIMARY_LAYER) {
      result = await fetchLayer(discovered);
      if (result.ok) result.layer = discovered;
    }
  }

  // Último recurso: fallback layer
  if (!result.ok) {
    result = await fetchLayer(FALLBACK_LAYER);
    if (result.ok) result.layer = FALLBACK_LAYER;
  }

  if (!result.ok) {
    return res.status(502).json({ error: 'Sin datos del INA — todos los métodos fallaron' });
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  res.setHeader('X-INA-Layer',  result.layer ?? PRIMARY_LAYER);
  res.setHeader('X-INA-Method', result.method ?? 'unknown');
  return res.status(200).json(result.data);
}
