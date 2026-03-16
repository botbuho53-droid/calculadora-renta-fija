const { proxyFetch, CORS } = require('./helpers');

exports.handler = async () => {
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
        if (symbol.includes(' ')) continue;
        const lastMatch = tr.match(/data-field="UltimoPrecio"[^>]*>\s*([\d.,]+)/);
        const prevMatch = tr.match(/data-field="UltimoCierre"[^>]*>\s*([\d.,]+)/);
        map[symbol] = {
          last: parseAR(lastMatch?.[1]),
          prevClose: parseAR(prevMatch?.[1]),
        };
      }
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ count: Object.keys(map).length, data: map }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
