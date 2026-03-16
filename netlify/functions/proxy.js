const { proxyFetch, CORS } = require('./helpers');

exports.handler = async (event) => {
  try {
    const target = event.queryStringParameters?.url;
    if (!target) return { statusCode: 400, headers: CORS, body: 'Missing url param' };
    const data = await proxyFetch(target);
    return { statusCode: 200, headers: CORS, body: data };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
