exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method not allowed' };

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return {
    statusCode: 500,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'GEMINI_API_KEY not set in Netlify environment variables' })
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
        })
      }
    );

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || 'Gemini API error');

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip markdown code blocks if present
    text = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();

    let result;
    try { result = JSON.parse(text); }
    catch(e) { throw new Error('Could not parse Gemini response as JSON'); }

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
