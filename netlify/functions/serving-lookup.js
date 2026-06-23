// Netlify Function: look up the real weight of "1 serving" via Nutritionix.
// Nutritionix's natural-language endpoint returns serving_weight_grams for
// queries like "1 banana" / "1 slice pizza". It is English/US-centric, so many
// Dutch names won't resolve — the frontend falls back to its own portion table.
// Set NUTRITIONIX_APP_ID and NUTRITIONIX_API_KEY in Netlify env variables.
function json(code, obj) {
  return {
    statusCode: code,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

exports.handler = async function(event) {
  const q = (event.queryStringParameters && event.queryStringParameters.q || '').trim();
  if (!q) return json(400, { error: 'No query', grams: null });

  const APP_ID = process.env.NUTRITIONIX_APP_ID;
  const API_KEY = process.env.NUTRITIONIX_API_KEY;
  if (!APP_ID || !API_KEY) return json(500, { error: 'Nutritionix keys not set', grams: null });

  // Drop brand text in parentheses and keep the first few words so the natural
  // parser has a clean food phrase (e.g. "Pizza Margherita (Dr. Oetker)" -> "pizza margherita").
  const clean = q.replace(/\(.*?\)/g, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
  if (!clean) return json(200, { grams: null });

  try {
    const resp = await fetch('https://trackapi.nutritionix.com/v2/natural/nutrients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-id': APP_ID, 'x-app-key': API_KEY },
      body: JSON.stringify({ query: '1 ' + clean })
    });
    if (!resp.ok) return json(200, { grams: null });
    const data = await resp.json();
    const f = data.foods && data.foods[0];
    if (!f || !f.serving_weight_grams) return json(200, { grams: null });
    return json(200, {
      grams: Math.round(f.serving_weight_grams),
      unit: f.serving_unit || null,
      qty: f.serving_qty || 1
    });
  } catch (e) {
    return json(200, { grams: null });
  }
};
