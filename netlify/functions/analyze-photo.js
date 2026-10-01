// Netlify Function: AI food-photo analysis via OpenRouter (free vision models).
// OpenRouter aggregates providers, works in the EU, and has genuinely free
// vision models. Get a free key at https://openrouter.ai/keys
// Set OPENROUTER_API_KEY in your Netlify environment variables.
// Optionally override the model with OPENROUTER_MODEL (a free vision model).
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method not allowed' };

  const KEY = process.env.OPENROUTER_API_KEY;
  if (!KEY) return {
    statusCode: 500,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'OPENROUTER_API_KEY not set in Netlify environment variables' })
  };
  const MODEL = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct:free';

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode:400, body: JSON.stringify({error:'Invalid JSON'}) }; }

  const { imageBase64, mimeType = 'image/jpeg' } = body;
  if (!imageBase64) return { statusCode:400, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({error:'No image provided'}) };

  try {
    const prompt = `You are a nutrition expert. Analyze this food image and identify all food items visible.
For each food item, estimate the quantity in grams and provide nutrition per 100g.
Respond ONLY with valid JSON in this exact format, no other text:
{
  "items": [
    {
      "name": "food name in Dutch",
      "grams": 150,
      "per100g": { "calories": 120, "protein": 5, "carbs": 20, "fat": 3 }
    }
  ],
  "total": { "calories": 180, "protein": 7, "carbs": 30, "fat": 4 }
}
If you cannot identify food, return: {"items":[],"total":{"calories":0,"protein":0,"carbs":0,"fat":0}}`;

    const resp = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KEY}`,
          'HTTP-Referer': 'https://barantrack.netlify.app',
          'X-Title': 'BaranTrack'
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
            ]
          }],
          temperature: 0.1,
          max_tokens: 1024
        })
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      const raw = data.error?.message || 'OpenRouter API error';
      const isQuota = resp.status === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(raw);
      return {
        statusCode: resp.status || 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: isQuota
            ? 'De AI-fotoanalyse heeft zijn limiet bereikt. Probeer het later opnieuw of voer het eten handmatig in.'
            : raw
        })
      };
    }

    let text = data.choices?.[0]?.message?.content || '';
    // Models sometimes wrap JSON in ```code fences``` or add prose — strip and extract.
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    if (first >= 0 && last > first) text = text.slice(first, last + 1);

    let result;
    try { result = JSON.parse(text); }
    catch(e) { throw new Error('Could not parse AI response as JSON'); }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };

  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
