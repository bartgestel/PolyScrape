-- Speeds up the calibration query's per-group price normalization.
CREATE INDEX IF NOT EXISTS markets_group_slug ON markets (group_slug) WHERE group_slug IS NOT NULL;
