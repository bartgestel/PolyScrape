-- Retention / downsampling support.
--
-- The collector runs a periodic decimation sweep (src/collector.ts runRetention,
-- scheduled in src/index.ts). Once a market has been resolved for longer than
-- RETENTION_FULL_DAYS, its snapshots are thinned to one collection cycle per
-- RETENTION_COARSE_MINUTES bucket (the latest cycle in each bucket is kept, the
-- rest deleted). Pending markets and markets resolved within RETENTION_FULL_DAYS
-- keep full-resolution (2-minute) history. RETENTION_DROP_DAYS > 0 additionally
-- hard-deletes all snapshots for markets resolved longer ago than that.
--
-- Practical effect on queries: snapshots for markets resolved more than
-- RETENTION_FULL_DAYS ago are ~RETENTION_COARSE_MINUTES apart, not 2 minutes.
-- getCalibration() is unaffected (its ±3h nearest-snapshot tolerance far exceeds
-- the coarse interval); ad-hoc sub-coarse-interval analysis on old resolved
-- markets will not have the resolution.
--
-- This migration only adds the index the sweep's "resolved long ago" filter needs.

CREATE INDEX IF NOT EXISTS resolutions_resolved_at ON resolutions (resolved_at);
