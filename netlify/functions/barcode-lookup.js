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
food
// Netlify Function: proxies Open Food Facts to bypass browser CORS
exports.handler = async function(event) {
  const query = event.queryStringParameters?.q || '';
  const page  = event.queryStringParameters?.page || '1';

  if (!query.trim()) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'No query' })
    };
  }

  try {
    const url =
      `https://world.openfoodfacts.org/cgi/search.pl` +
      `?search_terms=${encodeURIComponent(query)}` +
      `&search_simple=1&action=process&json=1` +
      `&page_size=40&page=${page}` +
      `&fields=product_name,brands,nutriments,countries_tags` +
      `&lc=nl`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CalorieTracker/1.0 (contact@example.com)' }
    });

    if (!resp.ok) throw new Error(`OFF returned ${resp.status}`);
    const data = await resp.json();

    // Clean & filter products
    const products = (data.products || [])
      .filter(p =>
        p.product_name &&
        p.nutriments &&
        p.nutriments['energy-kcal_100g'] > 0
      )
      .map(p => ({
        n: p.product_name + (p.brands ? ` (${p.brands.split(',')[0].trim()})` : ''),
        c: Math.round(p.nutriments['energy-kcal_100g'] || 0),
        p: Math.round(p.nutriments['proteins_100g']       || 0),
        k: Math.round(p.nutriments['carbohydrates_100g']  || 0),
        v: Math.round(p.nutriments['fat_100g']            || 0),
        src: 'off'  // mark as Open Food Facts result
      }));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({ products, count: products.length })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, products: [] })
    };
  }
};
