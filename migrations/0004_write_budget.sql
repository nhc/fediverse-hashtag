-- Cutting the write budget roughly in half.
--
-- Measured on the live index: about 700,000 to 800,000 rows written a day, which
-- is 7 to 8 times the D1 free tier and 45% of the Workers Paid allowance. Nearly
-- half of it was index maintenance on indexes that were barely earning their
-- keep, because every index costs a written row on each insert and each delete.
--
-- The rule applied here: an index that serves only an hourly sweep is not worth
-- a write on every row twice over. A full scan of a few tens of thousands of
-- rows once an hour is cheaper than that, and D1's read allowance is 25 billion
-- a month against a write allowance of 50 million.

-- Served only the retention sweep's DELETE ... WHERE created_at < ?, which runs
-- once an hour. observation_window (tag_id, created_at) still serves every
-- windowed query, which is the one that has to be fast.
-- Saves roughly 59,000 writes a day.
DROP INDEX IF EXISTS observation_expiry;

-- Served loadCandidates and the sweep, both infrequent, against a table holding
-- around fifteen thousand rows. Scanning that is nothing; writing an index entry
-- for every candidate row twice over is not.
-- Saves roughly 85,000 writes a day.
DROP INDEX IF EXISTS tag_candidate_seen;

-- Two indexes replaced by one. poll_log_at served range queries on at, and
-- poll_log_host (host, at) served the per-host health join. A single (at, host)
-- index serves both: the range scan on at comes first, and host is available
-- within it for the join to filter on.
-- Saves roughly 80,000 writes a day.
DROP INDEX IF EXISTS poll_log_at;
DROP INDEX IF EXISTS poll_log_host;
CREATE INDEX poll_log_at_host ON poll_log (at, host);
