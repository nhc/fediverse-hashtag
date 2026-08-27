-- The starting registry and tag set.
--
-- Instances are seeded with capability 'unknown' and probed_at NULL on purpose,
-- even though the probe on 27 August 2026 already found out what each of them
-- allows. Nothing is collected from a server until this deployment has asked it
-- directly. One instance is probed per tick, so the index takes about ten
-- minutes to warm up, and that is the correct trade: a seeded assumption would
-- be exactly the shortcut this design exists to avoid.
--
-- Bits are assigned here rather than at runtime so the mask stays stable across
-- redeployments. See docs/design.md.

INSERT INTO instance (host, bit, added_at) VALUES
  ('mastodon.social',   0, unixepoch()),
  ('mastodon.online',   1, unixepoch()),
  ('fosstodon.org',     2, unixepoch()),
  ('hachyderm.io',      3, unixepoch()),
  ('mas.to',            4, unixepoch()),
  ('mstdn.social',      5, unixepoch()),
  ('techhub.social',    6, unixepoch()),
  ('mastodon.world',    7, unixepoch()),
  -- Refused unauthenticated timeline requests when probed, while still serving
  -- daily tag counters. Kept for corroboration rather than dropped, and the
  -- probe will classify it tags_only on its own.
  ('infosec.exchange',  8, unixepoch());

-- A starting tag set, so the index has something to collect before anybody
-- searches. All start cold; tiers are earned by observed volume and by somebody
-- actually looking, and are reassigned every five minutes.
INSERT INTO tag (name, display, tier, first_seen_at) VALUES
  ('fediverse',    'Fediverse',    'cold', unixepoch()),
  ('mastodon',     'Mastodon',     'cold', unixepoch()),
  ('opensource',   'OpenSource',   'cold', unixepoch()),
  ('photography',  'Photography',  'cold', unixepoch()),
  ('books',        'Books',        'cold', unixepoch()),
  ('music',        'Music',        'cold', unixepoch()),
  ('science',      'Science',      'cold', unixepoch()),
  ('art',          'Art',          'cold', unixepoch()),
  ('cats',         'Cats',         'cold', unixepoch()),
  ('gardening',    'Gardening',    'cold', unixepoch()),
  ('cycling',      'Cycling',      'cold', unixepoch()),
  ('linux',        'Linux',        'cold', unixepoch());
