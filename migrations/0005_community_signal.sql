-- Telling a community apart from a publisher.
--
-- The first night of live running filled the tracked set and a sixth of what got
-- in was not a community. #featurednews was 197 posts from 14 authors on 2
-- servers; #photography was 234 posts from 161 authors on 65. The five-author
-- promotion threshold stops one person posting repeatedly, which is what it was
-- built for, but not fifteen bot accounts on two servers.
--
-- Measured against the live data, the signal that separates them is the number
-- of distinct servers a tag's posts come from. Every problem tag sat at 1 to 3
-- servers and every genuine one at 31 to 69, with no overlap. Author count does
-- not work, and neither does posts per author: #news is legitimate at 6.5 posts
-- per author and #headlines is a farm at 6.3.
--
-- Both columns are nullable because existing rows predate them. The pool is
-- swept at 48 hours, so the old rows age out rather than needing a backfill.

-- Which server each candidate sighting came from. Counting distinct values per
-- tag gives the breadth signal that promotion now gates on. Note this spans the
-- whole network rather than the monitored set: origin comes from the post's own
-- ActivityPub id, so a tag can show 69 servers while the index polls nine.
ALTER TABLE tag_candidate ADD COLUMN origin_host TEXT;

-- How many hashtags the post carried.
--
-- Recorded but not yet gated on. It is the obvious second signal, because a post
-- with fifteen tags is a broadcast and a person tagging usually manages three,
-- and it would catch a farm spread across enough servers to pass the origin
-- floor. That failure mode has not been observed yet, so this is instrumentation
-- rather than policy: measure first, then decide, which is the habit this project
-- has had to learn twice already.
ALTER TABLE tag_candidate ADD COLUMN tags_on_post INTEGER;
