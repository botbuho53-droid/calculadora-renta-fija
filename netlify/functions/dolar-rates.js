const { proxyFetch, CORS } = require('./helpers');

exports.handler = async () => {
  try {
    const data = await proxyFetch('https://dolarapi.com/v1/dolares');
    return { statusCode: 200, headers: CORS, body: data };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
