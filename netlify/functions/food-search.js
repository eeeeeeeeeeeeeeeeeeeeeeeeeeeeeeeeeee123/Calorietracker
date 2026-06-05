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
