-- Polymarket event slug, for building https://polymarket.com/event/<slug> links.
-- Backfilled on the next discovery cycle for any market still in the discovery set.
ALTER TABLE sports_markets  ADD COLUMN event_slug TEXT;
ALTER TABLE weather_markets ADD COLUMN event_slug TEXT;
