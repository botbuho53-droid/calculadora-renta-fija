const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const ROOT = __dirname;

// =====================================================
// Primary / MATBA ROFEX API config
// Change these to your credentials and environment
// Demo (reMarkets): https://remarkets.primary.ventures/
// Production: contact mpi@primary.com.ar
// =====================================================
const PRIMARY_CONFIG = {
  baseUrl: 'https://api.remarkets.primary.com.ar', // demo; change to https://api.primary.com.ar for prod
  user: 'botbuho5322665',
  pass: 'tdoajX4$',
};
let primaryToken = '';
let primaryTokenExpiry = 0;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Proxy fetch helper (ignore SSL for dev)
function proxyFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      rejectUnauthorized: false,
      ...options
    };
    https.get(url, opts, (resp) => {
      // Follow redirects
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return proxyFetch(resp.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
function proxyPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: 'POST', rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', ...headers }
    };
    const req = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Primary API helpers
function primaryRequest(method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = PRIMARY_CONFIG.baseUrl + urlPath;
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search,
      method, rejectUnauthorized: false,
      headers: { 'User-Agent': 'Mozilla/5.0', ...headers }
    };
    const req = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function primaryAuth() {
  // Return cached token if still valid (tokens last ~30 min, we refresh at 20)
  if (primaryToken && Date.now() < primaryTokenExpiry) return primaryToken;
  if (!PRIMARY_CONFIG.user || !PRIMARY_CONFIG.pass) return '';
  try {
    const resp = await primaryRequest('POST', '/auth/getToken', {
      'X-Username': PRIMARY_CONFIG.user,
      'X-Password': PRIMARY_CONFIG.pass
    });
    const token = resp.headers['x-auth-token'] || '';
    if (token) {
      primaryToken = token;
      primaryTokenExpiry = Date.now() + 20 * 60 * 1000; // 20 min
      console.log('Primary auth OK, token cached');
    }
    return token;
  } catch (e) {
    console.warn('Primary auth error:', e.message);
    return '';
  }
}

async function primaryGetMarketData(symbol, token) {
  const entries = 'BI,OF,LA,SE,OI,NV,HI,LO,CL';
  const urlPath = `/rest/marketdata/get?marketId=ROFX&symbol=${encodeURIComponent(symbol)}&entries=${entries}&depth=1`;
  const resp = await primaryRequest('GET', urlPath, { 'X-Auth-Token': token });
  if (resp.status !== 200) return null;
  try { return JSON.parse(resp.body); } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  // /api/bonos — scrape IOL public quotes (bonos + letras, no auth needed)
  if (req.url === '/api/bonos') {
    try {
      const pages = await Promise.all([
        proxyFetch('https://iol.invertironline.com/mercado/cotizaciones/argentina/bonos/todos'),
        proxyFetch('https://iol.invertironline.com/mercado/cotizaciones/argentina/letras/todas')
      ]);
      const map = {};
      const parseAR = (s) => s ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : 0;
      for (const html of pages) {
        const trRegex = /<tr[^>]*data-tituloID[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        while ((trMatch = trRegex.exec(html)) !== null) {
          const tr = trMatch[1];
          const symMatch = tr.match(/data-symbol="([^"]+)"/);
          if (!symMatch) continue;
          const symbol = symMatch[1].trim();
          if (symbol.includes(' ')) continue; // skip "X15Y6 - VENTANA" etc
          const lastMatch = tr.match(/data-field="UltimoPrecio"[^>]*>\s*([\d.,]+)/);
          const prevMatch = tr.match(/data-field="UltimoCierre"[^>]*>\s*([\d.,]+)/);
          map[symbol] = {
            last: parseAR(lastMatch?.[1]),
            prevClose: parseAR(prevMatch?.[1]),
          };
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ count: Object.keys(map).length, data: map }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /api/rofex — DLR futures from Primary API (MATBA ROFEX), fallback to IOL scrape
  if (req.url === '/api/rofex') {
    // DLR symbols to query (same as ROFEX_CONTRACTS in the HTML)
    const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
    const now = new Date();
    const dlrSymbols = [];
    for (let m = 0; m < 18; m++) {
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      const sym = `DLR/${MONTHS[d.getMonth()]}${String(d.getFullYear()).slice(2)}`;
      dlrSymbols.push(sym);
    }

    // Fetch Primary + IOL in parallel, merge results (Primary wins on overlap)
    const map = {};
    let source = '';

    // IOL scrape (always attempt)
    const iolPromise = proxyFetch('https://iol.invertironline.com/mercado/cotizaciones/argentina/futuros/todos')
      .then(html => {
        const parseAR = (s) => s ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : 0;
        const trRegex = /<tr[^>]*data-tituloID[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        const iolMap = {};
        while ((trMatch = trRegex.exec(html)) !== null) {
          const tr = trMatch[1];
          const symMatch = tr.match(/data-symbol="([^"]+)"/);
          if (!symMatch) continue;
          const symbol = symMatch[1].trim();
          if (!symbol.startsWith('DLR')) continue;
          const lastMatch = tr.match(/data-field="UltimoPrecio"[^>]*>\s*([\d.,]+)/);
          const prevMatch = tr.match(/data-field="UltimoCierre"[^>]*>\s*([\d.,]+)/);
          const bidMatch = tr.match(/data-field="PrecioCompra"[^>]*>\s*([\d.,]+)/);
          const askMatch = tr.match(/data-field="PrecioVenta"[^>]*>\s*([\d.,]+)/);
          const volMatch = tr.match(/data-field="VolumenMonto"[^>]*>\s*([\d.,]+)/) || tr.match(/data-field="VolumenNominal"[^>]*>\s*([\d.,]+)/);
          const oiMatch = tr.match(/data-field="InteresAbierto"[^>]*>\s*([\d.,]+)/);
          iolMap[symbol] = {
            last: parseAR(lastMatch?.[1]),
            prevClose: parseAR(prevMatch?.[1]),
            bid: parseAR(bidMatch?.[1]),
            ask: parseAR(askMatch?.[1]),
            vol: parseAR(volMatch?.[1]),
            oi: parseAR(oiMatch?.[1])
          };
        }
        return iolMap;
      }).catch(e => { console.warn('IOL scrape error:', e.message); return {}; });

    // Primary API
    const token = await primaryAuth();
    let primaryMap = {};
    if (token) {
      try {
        const results = await Promise.allSettled(
          dlrSymbols.map(sym => primaryGetMarketData(sym, token))
        );
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled' || !r.value || r.value.status !== 'OK') return;
          const md = r.value.marketData;
          if (!md) return;
          const sym = dlrSymbols[i];
          const bid = md.BI && md.BI.length > 0 ? md.BI[0].price : 0;
          const ask = md.OF && md.OF.length > 0 ? md.OF[0].price : 0;
          const last = md.LA ? md.LA.price : 0;
          const settle = md.SE ? md.SE.price : 0;
          const oi = md.OI ? md.OI.size : 0;
          const vol = md.NV ? md.NV.size : 0;
          const hi = md.HI ? md.HI.price : 0;
          const lo = md.LO ? md.LO.price : 0;
          const prevClose = md.CL ? md.CL.price : 0;
          if (bid || ask || last || settle) {
            primaryMap[sym] = { bid, ask, last: last || settle, prevClose, settle, oi, vol, hi, lo };
          }
        });
      } catch (e) {
        console.warn('Primary API error:', e.message);
      }
    }

    // Wait for IOL and merge: IOL first (base), Primary overwrites
    const iolMap = await iolPromise;
    // Start with IOL as base
    for (const [sym, d] of Object.entries(iolMap)) {
      map[sym] = { ...d, _src: 'iol' };
    }
    // Primary overwrites (higher priority)
    for (const [sym, d] of Object.entries(primaryMap)) {
      map[sym] = { ...d, _src: 'primary' };
    }
    // Determine source label
    const primaryCount = Object.keys(primaryMap).length;
    const iolCount = Object.values(map).filter(d => d._src === 'iol').length;
    if (primaryCount > 0 && iolCount > 0) source = 'primary+iol';
    else if (primaryCount > 0) source = 'primary';
    else source = 'iol';
    // Clean _src from output
    for (const d of Object.values(map)) { delete d._src; }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ count: Object.keys(map).length, data: map, source }));
    return;
  }

  // /api/dolar-spot — TC mayorista BCRA (bid/ask/last)
  if (req.url === '/api/dolar-spot') {
    try {
      // Try BCRA API first
      const data = await proxyFetch('https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones');
      const json = JSON.parse(data);
      let mayorista = 0, compra = 0, venta = 0;
      let fecha = '';
      if (json && json.results && json.results.length > 0) {
        const last = json.results[json.results.length - 1];
        fecha = last.fecha || '';
        if (last.detalle) {
          for (const d of last.detalle) {
            if (d.descripcion && d.descripcion.toLowerCase().includes('mayorista')) {
              compra = d.valor_compra || 0;
              venta = d.valor_venta || 0;
              mayorista = venta || compra;
              break;
            }
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ mayorista, compra, venta, fecha }));
    } catch (e) {
      // Fallback: try ambito
      try {
        const html = await proxyFetch('https://www.ambito.com/contenidos/dolar-mayorista.html');
        const matches = html.match(/(\d+[.,]\d+)\s*<\/span>/g) || [];
        const vals = matches.map(m => parseFloat(m.replace(/<\/span>/, '').replace(',', '.').trim()));
        const compra = vals.length >= 2 ? vals[0] : 0;
        const venta = vals.length >= 2 ? vals[1] : (vals[0] || 0);
        const mayorista = venta || compra;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ mayorista, compra, venta, fecha: new Date().toISOString().slice(0,10), source: 'ambito' }));
      } catch (e2) {
        // Fallback 3: dolarapi.com
        try {
          const dolarData = await proxyFetch('https://dolarapi.com/v1/dolares/mayorista');
          const dj = JSON.parse(dolarData);
          const compra3 = dj.compra || 0;
          const venta3 = dj.venta || 0;
          const mayorista3 = venta3 || compra3;
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ mayorista: mayorista3, compra: compra3, venta: venta3, fecha: dj.fechaActualizacion || '', source: 'dolarapi' }));
        } catch (e3) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ mayorista: 0, compra: 0, venta: 0, fecha: '', error: e3.message }));
        }
      }
    }
    return;
  }

  // /api/quotes — batch Yahoo Finance quotes via v8 chart API
  if (req.url.startsWith('/api/quotes?')) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const symbols = (urlObj.searchParams.get('symbols') || '').split(',').filter(Boolean);
      if (!symbols.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No symbols' }));
        return;
      }
      const results = {};
      const chunks = [];
      for (let i = 0; i < symbols.length; i += 20) chunks.push(symbols.slice(i, i + 20));
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (sym) => {
          try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2d&interval=1d&includePrePost=false`;
            const data = await proxyFetch(url);
            const json = JSON.parse(data);
            const meta = json.chart?.result?.[0]?.meta;
            if (meta) {
              results[sym] = {
                price: meta.regularMarketPrice,
                prevClose: meta.previousClose || meta.chartPreviousClose,
                currency: meta.currency,
                name: meta.shortName || meta.longName || sym,
                exchange: meta.exchangeName,
                time: meta.regularMarketTime
              };
            }
          } catch (e) { results[sym] = { error: e.message }; }
        }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(results));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /api/chart-data — Yahoo Finance chart data
  if (req.url.startsWith('/api/chart-data?')) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const symbol = urlObj.searchParams.get('symbol') || 'DX-Y.NYB';
      const range = urlObj.searchParams.get('range') || '3y';
      const interval = urlObj.searchParams.get('interval') || '1wk';
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
      const data = await proxyFetch(url);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /api/dolar-rates — all dollar rates from DolarAPI
  if (req.url === '/api/dolar-rates') {
    try {
      const data = await proxyFetch('https://dolarapi.com/v1/dolares');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Generic proxy for any URL
  if (req.url.startsWith('/api/proxy?')) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const target = urlObj.searchParams.get('url');
      if (!target) { res.writeHead(400); res.end('Missing url param'); return; }
      const data = await proxyFetch(target);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  let filePath = path.join(ROOT, req.url === '/' ? 'calculadora-renta-fija.html' : req.url);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
