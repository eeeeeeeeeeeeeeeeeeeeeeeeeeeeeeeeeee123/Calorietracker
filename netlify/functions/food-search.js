// Netlify Function: proxies Open Food Facts (Search-a-licious) to bypass browser CORS,
// and translates product names to the app's language (NL/EN) so results aren't shown
// in a foreign language (e.g. French "Salade de riz" -> "Rijstsalade").

// Parse OFF's free-text `quantity` (e.g. "310 g", "1,5 l", "393g") into grams.
function parseGrams(q) {
  if (!q || typeof q !== 'string') return null;
  const m = q.toLowerCase().replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|cl|ml|g|l)\b/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (!(val > 0)) return null;
  const unit = m[2];
  if (unit === 'kg' || unit === 'l') val *= 1000;
  else if (unit === 'cl') val *= 10;
  return Math.round(val);
}

// --- Translation (free, no-key Google endpoint) with graceful fallback ---
// Batch many names into ONE request (newline-joined) to avoid the rate-limiting
// that happens with dozens of separate calls. Falls back to the original name
// whenever anything goes wrong, so search never breaks.
const _trCache = {}; // persists across calls on warm function instances
async function translateChunk(chunk, lang) {
  const joined = chunk.join('\n');
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
    + encodeURIComponent(lang) + '&dt=t&q=' + encodeURIComponent(joined);
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('translate http ' + r.status);
  const j = await r.json();
  const out = (j[0] || []).map(s => s && s[0]).filter(s => s != null).join('');
  const lines = out.split('\n');
  if (lines.length !== chunk.length) throw new Error('line mismatch'); // avoid misalignment
  return lines;
}
async function translateGroup(group, lang, map) {
  try {
    const lines = await translateChunk(group, lang);
    group.forEach((n, idx) => { const t = lines[idx] || n; _trCache[lang + '|' + n] = t; map[n] = t; });
  } catch (e) {
    if (group.length <= 1) { group.forEach(n => { map[n] = n; }); return; } // give up on 1 name
    const mid = Math.ceil(group.length / 2); // split & retry so one bad name doesn't sink the rest
    await translateGroup(group.slice(0, mid), lang, map);
    await translateGroup(group.slice(mid), lang, map);
  }
}
async function translateAll(names, lang) {
  const map = {};
  const todo = [];
  for (const n of new Set(names.filter(Boolean))) {
    const k = lang + '|' + n;
    if (_trCache[k] !== undefined) map[n] = _trCache[k]; else todo.push(n);
  }
  const CHUNK = 20;
  const jobs = [];
  for (let i = 0; i < todo.length; i += CHUNK) {
    jobs.push(translateGroup(todo.slice(i, i + CHUNK), lang, map));
  }
  await Promise.all(jobs);
  return map;
}

exports.handler = async function(event) {
  const query = event.queryStringParameters?.q || '';
  const page  = event.queryStringParameters?.page || '1';
  const lang  = (event.queryStringParameters?.lang === 'en') ? 'en' : 'nl';

  if (!query.trim()) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'No query' }) };
  }

  const STOP = new Set(['met','de','het','een','en','van','voor','op','of','the','with','and','a','an','for']);
  async function fetchOff(q) {
    const url = `https://search.openfoodfacts.org/search`
      + `?q=${encodeURIComponent(q)}&langs=${lang}&page_size=25&page=${page}`
      + `&fields=product_name,brands,quantity,nutriments,countries_tags`;
    const r = await fetch(url, { headers: { 'User-Agent': 'CalorieTracker/1.0 (contact@example.com)' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`OFF returned ${r.status}`);
    const d = await r.json();
    return d.hits || d.products || [];
  }
  const keyOf = p => (p.product_name || '') + '|' + (Array.isArray(p.brands) ? p.brands[0] : (p.brands || ''));

  // USDA FoodData Central: free (instant key), and unlike OFF it has real
  // restaurant/fast-food items (Big Mac, Whopper, McChicken...) with clean
  // per-100g values. Used to complement OFF.
  function usdaMacro(fn, names, unit) {
    for (const x of (fn || [])) {
      if (names.includes(x.nutrientName) && (!unit || String(x.unitName || '').toUpperCase() === unit)) return x.value;
    }
    return null;
  }
  async function fetchUsda(q) {
    const KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
    const url = 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=' + encodeURIComponent(KEY)
      + '&pageSize=8&query=' + encodeURIComponent(q);
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('USDA ' + r.status);
    const d = await r.json();
    const out = [];
    for (const f of (d.foods || [])) {
      const fn = f.foodNutrients;
      let kcal = usdaMacro(fn, ['Energy'], 'KCAL');
      if (kcal == null) { const kj = usdaMacro(fn, ['Energy'], 'KJ'); if (kj != null) kcal = kj / 4.184; }
      if (!(kcal > 0 && kcal <= 900)) continue; // skip missing / per-serving-error values
      let base = String(f.description || '').trim();
      if (base.length < 2) continue;
      if (base === base.toUpperCase()) base = base.toLowerCase().replace(/(^|[\s,(/])\p{L}/gu, c => c.toUpperCase()); // de-shout ALL CAPS
      const su = String(f.servingSizeUnit || '').toLowerCase();
      const sv = (f.servingSize > 0 && f.servingSize < 2000 && (su === 'g' || su === 'ml')) ? Math.round(f.servingSize) : null;
      out.push({
        base,
        brand: '',
        c: Math.round(kcal),
        pr: Math.round(usdaMacro(fn, ['Protein']) || 0),
        k: Math.round(usdaMacro(fn, ['Carbohydrate, by difference']) || 0),
        v: Math.round(usdaMacro(fn, ['Total lipid (fat)']) || 0),
        pg: sv,        // real serving weight when USDA provides one
        src: 'usda'
      });
    }
    return out;
  }

  try {
    // Fire OFF and USDA at the same time instead of one-after-the-other.
    const [offMain, usdaItems] = await Promise.all([
      fetchOff(query).catch(() => []),
      fetchUsda(query).catch(() => [])
    ]);
    let rawProducts = offMain;

    // If the user added a brand (e.g. "kippenvleugels albert heijn") that OFF
    // doesn't stock, results collapse to brand-only matches and the actual
    // product vanishes. Detect the most specific word and, if it's barely
    // present, also search on that word alone and merge the real products in.
    const qTokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t));
    const mainTerm = qTokens.slice().sort((a, b) => b.length - a.length)[0];
    if (mainTerm && qTokens.length >= 2) {
      const withMain = rawProducts.filter(p => String(p.product_name || '').toLowerCase().includes(mainTerm)).length;
      if (withMain < 6) {
        try {
          const extra = await fetchOff(mainTerm);
          const seen = new Set(rawProducts.map(keyOf));
          for (const p of extra) { const k = keyOf(p); if (!seen.has(k)) { seen.add(k); rawProducts.push(p); } }
        } catch (e) {}
      }
    }

    // Clean an OFF name: repair double-encoded UTF-8 (mojibake like "CafÃ©"),
    // and reject junk entries ("Loading…", bare numbers, empty).
    function cleanName(s) {
      let n = String(s || '').trim();
      if (/[ÃÂ]./.test(n)) { // looks double-encoded -> repair latin1->utf8
        try { const fixed = Buffer.from(n, 'latin1').toString('utf8'); if (!/�/.test(fixed)) n = fixed; } catch (e) {}
      }
      n = n.replace(/\s+/g, ' ').trim();
      if (n.length < 2) return null;
      if (/^(loading|laden)[.…\s]*$/i.test(n)) return null;   // placeholder junk in OFF
      if (/^[\d\s.,-]+$/.test(n)) return null;             // just numbers
      return n;
    }

    // Build with the base name and brand kept separate (brand is NOT translated).
    const mapped = rawProducts
      .filter(p => p.product_name && p.nutriments && p.nutriments['energy-kcal_100g'] > 0)
      .map(p => {
        const brand = Array.isArray(p.brands)
          ? p.brands[0]
          : (typeof p.brands === 'string' ? p.brands.split(',')[0] : '');
        return {
          base: cleanName(p.product_name),
          brand: brand ? String(brand).trim() : '',
          c: Math.round(p.nutriments['energy-kcal_100g'] || 0),
          pr: Math.round(p.nutriments['proteins_100g']      || 0),
          k: Math.round(p.nutriments['carbohydrates_100g']  || 0),
          v: Math.round(p.nutriments['fat_100g']            || 0),
          pg: parseGrams(p.quantity),
          src: 'off'
        };
      })
      .filter(m => m.base); // drop entries whose name was junk

    // Complement with USDA (restaurant/fast-food items OFF lacks) — already
    // fetched in parallel above. Never fatal.
    {
      const have = new Set(mapped.map(m => (m.base || '').toLowerCase()));
      for (const u of (usdaItems || [])) { if (!have.has(u.base.toLowerCase())) { have.add(u.base.toLowerCase()); mapped.push(u); } }
    }

    // Translate the base names to the active language.
    const transMap = await translateAll(mapped.map(m => m.base), lang);

    const products = mapped.map(m => {
      let name = (transMap[m.base] || m.base).replace(/\s+/g, ' ').trim();
      name = name.charAt(0).toUpperCase() + name.slice(1); // tidy capitalization
      return {
        n: name + (m.brand ? ` (${m.brand})` : ''),
        c: m.c, p: m.pr, k: m.k, v: m.v, pg: m.pg, src: m.src || 'off'
      };
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({ products, count: products.length })
    };

  } catch (err) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message, products: [] }) };
  }
};
