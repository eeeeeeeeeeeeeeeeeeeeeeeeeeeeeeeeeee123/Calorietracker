// Netlify Function: AI food-photo analysis via Groq (Llama 4 vision).
// Groq has a usable free tier in the EU (unlike Gemini's free tier = 0 here).
// Set GROQ_API_KEY in your Netlify environment variables.
exports.handler = async function(event) {
  // TEMP debug: GET ...?debug=1 lists which relevant env var NAMES reach the
  // function (names only, no values) so we can see if GROQ_API_KEY arrives.
  if (event.queryStringParameters && event.queryStringParameters.debug === '1') {
    const keys = Object.keys(process.env).filter(k => /GROQ|GEMINI|API|KEY/i.test(k));
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasGroq: !!process.env.GROQ_API_KEY, matchingEnvKeys: keys })
    };
  }

  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method not allowed' };

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return {
    statusCode: 500,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'GROQ_API_KEY not set in Netlify environment variables' })
  };

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
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
            ]
          }],
          temperature: 0.1,
          max_tokens: 1024,
          response_format: { type: 'json_object' }
        })
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      const raw = data.error?.message || 'Groq API error';
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
    // Strip markdown code fences if the model wrapped the JSON
    text = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();

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
