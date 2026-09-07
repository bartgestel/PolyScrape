-- Recurring markets (5-min / hourly / daily / weekly crypto & stock up-down)
-- share a timestamp-free stableSlug, e.g. 'btc-hourly-price'. Lets the viewer
-- collapse a series of them and lets you query one series over time.
ALTER TABLE markets ADD COLUMN stable_slug TEXT;
CREATE INDEX markets_stable_slug ON markets (stable_slug) WHERE stable_slug IS NOT NULL;
