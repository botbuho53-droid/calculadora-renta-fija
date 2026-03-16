const { proxyFetch, CORS } = require('./helpers');

exports.handler = async (event) => {
  try {
    const symbols = (event.queryStringParameters?.symbols || '').split(',').filter(Boolean);
    if (!symbols.length) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No symbols' }) };
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
    return { statusCode: 200, headers: CORS, body: JSON.stringify(results) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
