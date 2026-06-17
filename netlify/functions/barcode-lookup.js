exports.handler = async function(event) {
  const code = event.queryStringParameters?.code || '';
  if (!code.trim()) return { statusCode:400, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({error:'No code'}) };
  try {
    const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`, {
      headers: { 'User-Agent': 'CalorieTracker/1.0' }
    });
    const data = await resp.json();
    if (data.status !== 1 || !data.product) return { statusCode:404, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({error:'Product not found'}) };
    const p = data.product;
    const food = {
      n: p.product_name || p.product_name_nl || 'Onbekend product',
      brand: p.brands?.split(',')[0]?.trim() || '',
      c: Math.round(p.nutriments?.['energy-kcal_100g'] || 0),
      p: Math.round(p.nutriments?.['proteins_100g'] || 0),
      k: Math.round(p.nutriments?.['carbohydrates_100g'] || 0),
      v: Math.round(p.nutriments?.['fat_100g'] || 0),
      img: p.image_small_url || null,
      src: 'barcode'
    };
    return { statusCode:200, headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/json'}, body: JSON.stringify({food}) };
  } catch(e) {
    return { statusCode:500, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({error:e.message}) };
  }
};
