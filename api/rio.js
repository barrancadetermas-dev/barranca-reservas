// api/rio.js — Vercel Serverless Function
// Proxy server-side para datos del Río Uruguay desde el INA.
// Prueba múltiples endpoints en orden hasta encontrar uno que funcione.

const ENDPOINTS = [
  // WFS v1.0.0 — más compatible con GeoServer viejo
  {
    name: 'WFS v1.0.0',
    url: 'https://alerta.ina.gob.ar/geoserver/wfs'
      + '?service=WFS&version=1.0.0&request=GetFeature'
      + '&typeName=alerta5:ultimas_alturas'
      + '&outputFormat=application/json'
      + '&maxFeatures=500',
    parse: 'geojson',
  },
  // WFS v2.0.0
  {
    name: 'WFS v2.0.0',
    url: 'https://alerta.ina.gob.ar/geoserver/wfs'
      + '?service=WFS&version=2.0.0&request=GetFeature'
      + '&typeName=alerta5:ultimas_alturas'
      + '&outputFormat=application/json'
      + '&count=500',
    parse: 'geojson',
  },
  // WFS OWS
  {
    name: 'WFS ows',
    url: 'https://alerta.ina.gob.ar/geoserver/ows'
      + '?service=WFS&version=2.0.0&request=GetFeature'
      + '&typeName=alerta5:ultimas_alturas'
      + '&outputFormat=application%2Fjson'
      + '&count=500',
    parse: 'geojson',
  },
  // INA REST API
  {
    name: 'INA REST',
    url: 'https://alerta.ina.gob.ar/a/series/?tipo=puntual&fuentes_id=1',
    parse: 'rest',
  },
];

async function tryEndpoint(ep) {
  const res = await fetch(ep.url, {
    headers: {
      'User-Agent': 'MILA-PMS/1.0',
      'Accept': 'application/json, text/plain, */*',
    },
    signal: AbortSignal.timeout(10000),
  });

  const text = await res.text();
  const isXML = text.trimStart().startsWith('<');

  return {
    name:   ep.name,
    status: res.status,
    ok:     res.ok && !isXML,
    isXML,
    text:   res.ok ? text : null,
    error:  !res.ok ? `HTTP ${res.status}` : isXML ? 'XML response' : null,
    preview: text.slice(0, 300),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = [];

  for (const ep of ENDPOINTS) {
    try {
      const r = await tryEndpoint(ep);
      results.push({ name: r.name, status: r.status, ok: r.ok, isXML: r.isXML, error: r.error });

      if (r.ok && r.text) {
        try {
          const data = JSON.parse(r.text);
          // Éxito — devolver los datos con metadata de diagnóstico
          res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
          res.setHeader('X-INA-Source', r.name);
          return res.status(200).json(data);
        } catch (parseErr) {
          results[results.length - 1].error = 'JSON parse error: ' + parseErr.message;
          results[results.length - 1].preview = r.text.slice(0, 200);
        }
      } else {
        results[results.length - 1].preview = r.preview;
      }
    } catch (err) {
      results.push({ name: ep.name, error: err?.message ?? String(err) });
    }
  }

  // Todos fallaron — devolver diagnóstico detallado
  console.error('[api/rio] todos los endpoints fallaron:', JSON.stringify(results));
  return res.status(502).json({
    error: 'No se pudo obtener datos del INA',
    endpoints_tried: results,
  });
}
