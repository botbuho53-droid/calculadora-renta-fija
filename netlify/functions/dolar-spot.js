const { proxyFetch, CORS } = require('./helpers');

exports.handler = async () => {
  try {
    const data = await proxyFetch('https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones');
    const json = JSON.parse(data);
    let mayorista = 0, compra = 0, venta = 0, fecha = '';
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
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ mayorista, compra, venta, fecha }) };
  } catch (e) {
    try {
      const dolarData = await proxyFetch('https://dolarapi.com/v1/dolares/mayorista');
      const dj = JSON.parse(dolarData);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ mayorista: dj.venta || dj.compra || 0, compra: dj.compra || 0, venta: dj.venta || 0, fecha: dj.fechaActualizacion || '', source: 'dolarapi' }) };
    } catch (e2) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ mayorista: 0, compra: 0, venta: 0, fecha: '', error: e2.message }) };
    }
  }
};
