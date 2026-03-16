const { proxyFetch, primaryAuth, primaryGetMarketData, CORS } = require('./helpers');

exports.handler = async () => {
  const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  const now = new Date();
  const dlrSymbols = [];
  for (let m = 0; m < 18; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    dlrSymbols.push(`DLR/${MONTHS[d.getMonth()]}${String(d.getFullYear()).slice(2)}`);
  }

  const map = {};
  let source = '';

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
    }).catch(() => ({}));

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
    } catch (e) {}
  }

  const iolMap = await iolPromise;
  for (const [sym, d] of Object.entries(iolMap)) map[sym] = { ...d, _src: 'iol' };
  for (const [sym, d] of Object.entries(primaryMap)) map[sym] = { ...d, _src: 'primary' };
  const primaryCount = Object.keys(primaryMap).length;
  const iolCount = Object.values(map).filter(d => d._src === 'iol').length;
  if (primaryCount > 0 && iolCount > 0) source = 'primary+iol';
  else if (primaryCount > 0) source = 'primary';
  else source = 'iol';
  for (const d of Object.values(map)) delete d._src;

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ count: Object.keys(map).length, data: map, source }) };
};
