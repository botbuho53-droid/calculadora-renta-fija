const { proxyFetch, CORS } = require('./helpers');

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const symbol = params.symbol || 'DX-Y.NYB';
    const range = params.range || '3y';
    const interval = params.interval || '1wk';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const data = await proxyFetch(url);
    return { statusCode: 200, headers: CORS, body: data };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
