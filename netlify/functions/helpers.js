const https = require('https');

function proxyFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      rejectUnauthorized: false,
      ...options
    };
    https.get(url, opts, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return proxyFetch(resp.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function primaryRequest(method, urlPath, headers = {}) {
  const baseUrl = process.env.PRIMARY_BASE_URL || 'https://api.remarkets.primary.com.ar';
  return new Promise((resolve, reject) => {
    const url = baseUrl + urlPath;
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

let primaryToken = '';
let primaryTokenExpiry = 0;

async function primaryAuth() {
  if (primaryToken && Date.now() < primaryTokenExpiry) return primaryToken;
  const user = process.env.PRIMARY_USER || '';
  const pass = process.env.PRIMARY_PASS || '';
  if (!user || !pass) return '';
  try {
    const resp = await primaryRequest('POST', '/auth/getToken', {
      'X-Username': user,
      'X-Password': pass
    });
    const token = resp.headers['x-auth-token'] || '';
    if (token) {
      primaryToken = token;
      primaryTokenExpiry = Date.now() + 20 * 60 * 1000;
    }
    return token;
  } catch (e) {
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

module.exports = { proxyFetch, primaryRequest, primaryAuth, primaryGetMarketData, CORS };
