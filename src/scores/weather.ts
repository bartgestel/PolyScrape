// Best-effort measured-value backfill via Open-Meteo (keyless).
// Geocoding + historical archive. Returns null when it can't resolve a value
// (unknown location, non-temp/precip metric, or archive data not published yet).

import { getJson } from "../http";
import { logger } from "../logger";

interface GeoResp {
  results?: { latitude: number; longitude: number; name: string }[];
}
interface ArchiveResp {
  daily?: {
    time: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
  };
}

const geoCache = new Map<string, { lat: number; lon: number } | null>();

async function geocode(location: string): Promise<{ lat: number; lon: number } | null> {
  const key = location.toLowerCase().trim();
  if (geoCache.has(key)) return geoCache.get(key)!;
  let hit: { lat: number; lon: number } | null = null;
  try {
    const r = await getJson<GeoResp>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
    );
    const g = r.results?.[0];
    if (g) hit = { lat: g.latitude, lon: g.longitude };
  } catch (err) {
    logger.debug("geocode failed", { location, err });
  }
  geoCache.set(key, hit);
  return hit;
}

/**
 * @param metric  free text; matched on "high"/"low"/"rain"/"precip"
 * @param day     the measurement day
 * @param fahrenheit  request °F (US temperature markets); otherwise °C
 * @returns measured value in the requested temperature unit, or mm for precip
 */
export async function fetchMeasuredValue(
  location: string | null,
  metric: string | null,
  day: Date | null,
  fahrenheit: boolean,
): Promise<number | null> {
  if (!location || !day) return null;
  const m = (metric ?? "").toLowerCase();
  const wantMax = m.includes("high") || m.includes("max") || m.includes("hot");
  const wantMin = m.includes("low") || m.includes("min") || m.includes("cold");
  const wantPrecip = m.includes("rain") || m.includes("precip") || m.includes("snow");
  if (!wantMax && !wantMin && !wantPrecip) return null;

  const geo = await geocode(location);
  if (!geo) return null;

  const d = day.toISOString().slice(0, 10);
  const unit = fahrenheit ? "&temperature_unit=fahrenheit" : "";
  try {
    const r = await getJson<ArchiveResp>(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.lat}&longitude=${geo.lon}` +
        `&start_date=${d}&end_date=${d}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto${unit}`,
    );
    const daily = r.daily;
    if (!daily || !daily.time?.length) return null;
    const arr = wantPrecip ? daily.precipitation_sum : wantMax ? daily.temperature_2m_max : daily.temperature_2m_min;
    const v = arr?.[0];
    return typeof v === "number" ? v : null;
  } catch (err) {
    logger.debug("archive lookup failed", { location, err });
    return null;
  }
}
