// Netlify Function: look up the weight of "1 serving" via USDA FoodData Central.
// Free, instant API key (no approval): https://fdc.nal.usda.gov/api-key-signup
// Set USDA_API_KEY in Netlify env vars (falls back to the rate-limited DEMO_KEY).
// US-centric: great for generic/international foods, misses most Dutch brands —
// the frontend then falls back to its own portion table.
function json(code, obj) {
  return {
    statusCode: code,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

exports.handler = async function(event) {
  const q = (event.queryStringParameters && event.queryStringParameters.q || '').trim();
  if (!q) return json(400, { grams: null });

  const KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
  // Clean the name: drop brand-in-parens, strip punctuation, keep a few words.
  const clean = q.replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  if (!clean) return json(200, { grams: null });

  try {
    const url = 'https://api.nal.usda.gov/fdc/v1/foods/search'
      + '?api_key=' + encodeURIComponent(KEY)
      + '&query=' + encodeURIComponent(clean)
      + '&pageSize=5&dataType=Branded,Foundation,SR%20Legacy';
    const resp = await fetch(url);
    if (!resp.ok) return json(200, { grams: null });
    const data = await resp.json();
    const foods = data.foods || [];
    for (const f of foods) {
      const g = f.servingSize;
      const unit = (f.servingSizeUnit || '').toLowerCase();
      if (g && (unit === 'g' || unit === 'ml') && g > 0 && g < 2000) {
        return json(200, { grams: Math.round(g) });
      }
    }
    return json(200, { grams: null });
  } catch (e) {
    return json(200, { grams: null });
  }
};
