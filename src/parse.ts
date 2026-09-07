// Pure text-extraction heuristics for market metadata. Kept dependency-free and
// side-effect-free so test/parse.test.ts can hammer them.
// ponytail: heuristics, not a parser. Wrong/NULL on odd phrasings is acceptable —
// question text is always stored verbatim for later re-parsing.

const WEATHER_STOP_TAGS = new Set([
  "weather", "climate", "climate-science", "science", "recurring", "hide-from-new",
  "featured", "daily-temperature", "highest-temperature", "lowest-temperature",
  "rain", "precipitation", "snow", "natural-disaster", "natural-disasters",
  "earthquake", "earthquakes", "pandemics", "hurricane", "wildfire", "new",
]);

export function deSlug(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

export function isFahrenheit(question: string): boolean {
  return /°?\s*F\b/.test(question) || /fahrenheit/i.test(question);
}

/** First signed number that sits next to a unit / comparison phrase. */
export function parseThreshold(question: string): number | null {
  const patterns = [
    /between\s+(-?\d+(?:\.\d+)?)\s*[-–]/i, // "between 80-81°F" -> lower bound
    /(-?\d+(?:\.\d+)?)\s*°\s*[CF]/i,
    /(-?\d+(?:\.\d+)?)\s*(?:degrees|inches|inch|in|mm|cm)\b/i,
    /(?:above|below|over|under|least|exceed|greater than|less than|reach)\s+(-?\d+(?:\.\d+)?)/i,
    /(-?\d+(?:\.\d+)?)\s*(?:or (?:above|below|higher|lower))/i,
  ];
  for (const re of patterns) {
    const m = question.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

export function parseWeatherMetric(tagSlugs: string[], question: string): string | null {
  for (const t of ["highest-temperature", "lowest-temperature", "rain", "precipitation", "snow"]) {
    if (tagSlugs.includes(t)) return t;
  }
  const q = question.toLowerCase();
  if (q.includes("highest temperature") || q.includes("high temp")) return "highest-temperature";
  if (q.includes("lowest temperature") || q.includes("low temp")) return "lowest-temperature";
  if (q.includes("rain") || q.includes("precipitation")) return "rain";
  if (q.includes("snow")) return "snow";
  return null;
}

export function parseWeatherLocation(tagSlugs: string[], question: string): string | null {
  const cityTag = tagSlugs.find((t) => !WEATHER_STOP_TAGS.has(t));
  if (cityTag) return deSlug(cityTag);
  const m = question.match(/\bin ([A-Z][A-Za-z.'\- ]+?)(?: on | be | reach | exceed |\?|$)/);
  return m ? m[1].trim() : null;
}
