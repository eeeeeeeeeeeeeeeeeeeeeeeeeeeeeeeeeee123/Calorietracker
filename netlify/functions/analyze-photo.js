// Netlify Function: AI food-photo analysis.
// Provider-flexible — uses whichever FREE key(s) you set in Netlify:
//   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN  (dash.cloudflare.com — free, no card, EU)
//   GROQ_API_KEY         (console.groq.com)
//   OPENROUTER_API_KEY   (openrouter.ai)
//   GEMINI_API_KEY       (aistudio.google.com)
// First one found wins. No code changes needed to switch.
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { imageBase64, mimeType = 'image/jpeg' } = body;
  if (!imageBase64) return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No image provided' }) };

  const prompt = `You are a nutrition expert. Analyze this food image and identify all food items visible.
For each food item, estimate the quantity in grams and provide nutrition per 100g.
Respond ONLY with valid JSON in this exact format, no other text:
{
  "items": [
    { "name": "food name in Dutch", "grams": 150, "per100g": { "calories": 120, "protein": 5, "carbs": 20, "fat": 3 } }
  ],
  "total": { "calories": 180, "protein": 7, "carbs": 30, "fat": 4 }
}
If you cannot identify food, return: {"items":[],"total":{"calories":0,"protein":0,"carbs":0,"fat":0}}`;

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const env = process.env;

  let url, headers, payload, extract, provider;
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    provider = 'Cloudflare';
    const model = env.CF_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct';
    url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
    payload = { messages: [{ role: 'user', content: prompt }], image: Array.from(Buffer.from(imageBase64, 'base64')), max_tokens: 1024, temperature: 0.2 };
    extract = d => (d && d.result && (d.result.response || d.result.description)) || '';
  } else if (env.GROQ_API_KEY) {
    provider = 'Groq';
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` };
    payload = { model: env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], temperature: 0.1, max_tokens: 1024 };
    extract = d => d.choices?.[0]?.message?.content;
  } else if (env.OPENROUTER_API_KEY) {
    provider = 'OpenRouter';
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`, 'HTTP-Referer': 'https://barantrack.netlify.app', 'X-Title': 'BaranTrack' };
    payload = { model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct:free', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], temperature: 0.1, max_tokens: 1024 };
    extract = d => d.choices?.[0]?.message?.content;
  } else if (env.GEMINI_API_KEY) {
    provider = 'Gemini';
    url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent?key=${env.GEMINI_API_KEY}`;
    headers = { 'Content-Type': 'application/json' };
    payload = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 1024 } };
    extract = d => d.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Geen AI-sleutel ingesteld. Zet CLOUDFLARE_ACCOUNT_ID+CLOUDFLARE_API_TOKEN, GROQ_API_KEY, OPENROUTER_API_KEY of GEMINI_API_KEY in je Netlify-variabelen.' }) };
  }

  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(45000) });
    const data = await resp.json();
    if (!resp.ok || data.success === false) {
      const raw = data.error?.message || data.errors?.[0]?.message || (provider + ' API error');
      const isQuota = resp.status === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(raw);
      return {
        statusCode: resp.status || 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: isQuota ? 'De AI-fotoanalyse heeft zijn limiet bereikt. Probeer het later opnieuw of voer het eten handmatig in.' : (provider + ': ' + raw) })
      };
    }

    let text = extract(data) || '';
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    if (first >= 0 && last > first) text = text.slice(first, last + 1);

    let result;
    try { result = JSON.parse(text); }
    catch (e) { throw new Error('Could not parse AI response as JSON'); }

    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(result) };

  } catch (e) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: e.message }) };
  }
};
