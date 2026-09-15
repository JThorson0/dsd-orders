// js/search.js — pure quick-add search logic. No DOM, no Firebase.
// Tested with node: `node --test` via ../test/search.test.mjs (see test dir).

// Whole-word abbreviation expansions, applied to BOTH the query and the
// product text so shorthand stays consistent on both sides.
export const EXPANSIONS = {
  wh: "white",
  ch: "cheddar",
  rf: "reduced fat",
  pb: "peanut butter",
  hny: "honey",
  bbq: "barbecue",
  veg: "veggie",
  choc: "chocolate",
  org: "original",
};

export function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function expandAbbreviations(text) {
  return text.replace(/\b([a-z]{2,4})\b/g, (m, w) => EXPANSIONS[w] || m);
}

export function tokenize(s) {
  const t = expandAbbreviations(normalize(s));
  return t ? t.split(" ").filter(Boolean) : [];
}

export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Score one query token against one product token.
// 3 = exact, 2 = prefix, 1 = substring, 0.6 = typo, 0 = no match.
function tokenScore(qt, pt) {
  if (qt === pt) return 3;
  if (pt.startsWith(qt)) return 2;
  if (pt.includes(qt)) return 1;
  if (qt.length >= 3 && pt.length >= 3) {
    const maxDist = qt.length >= 6 ? 2 : 1;
    if (editDistance(qt, pt) <= maxDist) return 0.6;
  }
  return 0;
}

export function productTokens(product) {
  return tokenize(
    `${product.name || ""} ${product.aliases || ""} ${product.itemNumber || ""}`
  );
}

// Split the aliases field into phrases. Commas/semicolons separate
// phrases; spaces inside one alias are kept ("rf wh ch" is one phrase).
export function aliasPhrases(product) {
  return (product.aliases || "")
    .split(/[,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export function scoreProduct(queryTokens, rawQuery, product, useCount) {
  const qFlat = normalize(expandAbbreviations(rawQuery)).replace(/\s+/g, "");

  // OTS item number exact match → top of the world.
  if (product.itemNumber) {
    const numFlat = normalize(product.itemNumber).replace(/\s+/g, "");
    if (qFlat && qFlat === numFlat) return { score: 1000, tier: "exact" };
  }

  // Invisible alias exact match (e.g. "sscp", "rf wh ch") → near-top.
  for (const phrase of aliasPhrases(product)) {
    const pFlat = normalize(expandAbbreviations(phrase)).replace(/\s+/g, "");
    if (qFlat && qFlat === pFlat) return { score: 900, tier: "exact" };
  }

  const ptoks = productTokens(product);
  let total = 0;
  let matched = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const pt of ptoks) {
      const s = tokenScore(qt, pt);
      if (s > best) best = s;
      if (best === 3) break;
    }
    if (best > 0) matched++;
    total += best;
  }
  if (matched === 0) return { score: 0, tier: "none" };

  let score = total * 10;
  if (matched === queryTokens.length) score += 25; // every word hit something
  // Product name starts with the query → strong signal.
  const nameNorm = expandAbbreviations(normalize(product.name || ""));
  const qNorm = expandAbbreviations(normalize(rawQuery));
  if (qNorm && nameNorm.startsWith(qNorm)) score += 15;
  // Frequently ordered products float up.
  score += Math.min(useCount || 0, 20);

  return {
    score,
    tier: matched === queryTokens.length ? "match" : "partial",
  };
}

// Returns { results, didYouMean }. results are strong hits (max 8);
// didYouMean holds up to 3 closest guesses when nothing matched strongly.
export function searchProducts(rawQuery, products, useCounts = {}) {
  const queryTokens = tokenize(rawQuery);
  if (!queryTokens.length) return { results: [], didYouMean: [] };
  const scored = [];
  for (const p of products) {
    if (p.archived) continue;
    const { score, tier } = scoreProduct(
      queryTokens,
      rawQuery,
      p,
      useCounts[p.id] || 0
    );
    if (score > 0) scored.push({ product: p, score, tier });
  }
  scored.sort((a, b) => b.score - a.score);
  const strong = scored.filter(
    (r) => r.tier === "exact" || r.tier === "match"
  );
  if (strong.length) return { results: strong.slice(0, 8), didYouMean: [] };
  return { results: [], didYouMean: scored.slice(0, 3) };
}

// "ccc 4" → { query: "ccc", qty: 4 }. Trailing number = case quantity.
export function parseQuickEntry(text) {
  const t = (text || "").trim();
  const m = t.match(/^(.*?)\s+(\d{1,3})\s*$/);
  if (m && m[1].trim()) {
    return { query: m[1].trim(), qty: Math.max(1, parseInt(m[2], 10)) };
  }
  return { query: t, qty: 1 };
}
