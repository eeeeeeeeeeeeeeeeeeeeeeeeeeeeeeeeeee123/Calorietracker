// Netlify Function: proxies Open Food Facts (Search-a-licious) to bypass browser CORS
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
    // NOTE: The legacy world.openfoodfacts.org/cgi/search.pl endpoint was
    // deprecated by Open Food Facts (now returns HTTP 503). Full-text search
    // now lives on their new Search-a-licious service.
    const url =
      `https://search.openfoodfacts.org/search` +
      `?q=${encodeURIComponent(query)}` +
      `&langs=nl&page_size=40&page=${page}` +
      `&fields=product_name,brands,nutriments,countries_tags`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CalorieTracker/1.0 (contact@example.com)' }
    });

    if (!resp.ok) throw new Error(`OFF returned ${resp.status}`);
    const data = await resp.json();

    // Search-a-licious returns results under "hits"
    const rawProducts = data.hits || data.products || [];

    // Clean & filter products
    const products = rawProducts
      .filter(p =>
        p.product_name &&
        p.nutriments &&
        p.nutriments['energy-kcal_100g'] > 0
      )
      .map(p => {
        // Search-a-licious returns `brands` as an array; the legacy API used a
        // comma-separated string. Handle both so we don't crash on .split().
        const brand = Array.isArray(p.brands)
          ? p.brands[0]
          : (typeof p.brands === 'string' ? p.brands.split(',')[0] : '');
        return {
        n: p.product_name + (brand ? ` (${brand.trim()})` : ''),
        c: Math.round(p.nutriments['energy-kcal_100g'] || 0),
        p: Math.round(p.nutriments['proteins_100g']       || 0),
        k: Math.round(p.nutriments['carbohydrates_100g']  || 0),
        v: Math.round(p.nutriments['fat_100g']            || 0),
        src: 'off'  // mark as Open Food Facts result
      };});

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
