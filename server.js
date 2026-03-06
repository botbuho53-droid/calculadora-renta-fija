const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const ROOT = __dirname;

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
