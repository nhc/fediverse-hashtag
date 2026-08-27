#!/bin/zsh
# Read-only capability probe. One small request set per host, public endpoints only.
UA='fediverse-hashtag-index/0.0 (capability probe; contact: neilcharlton@inspiredpetnutrition.com)'
TAG=cats

probe() {
  host=$1
  printf '\n=== %s ===\n' "$host"

  # nodeinfo -> software name/version, works across ActivityPub implementations
  ni=$(curl -sS -m 12 -A "$UA" -H 'Accept: application/json' "https://$host/.well-known/nodeinfo" 2>/dev/null)
  nihref=$(printf '%s' "$ni" | sed -n 's/.*"href":"\([^"]*2\.[01]\)".*/\1/p' | head -1)
  [ -z "$nihref" ] && nihref=$(printf '%s' "$ni" | sed -n 's/.*"href":"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$nihref" ]; then
    curl -sS -m 12 -A "$UA" "$nihref" 2>/dev/null \
      | sed -n 's/.*"software":{\("name":"[^"]*"\)\(,"version":"[^"]*"\)\{0,1\}.*/software: \1\2/p'
  else
    echo "software: (no nodeinfo)"
  fi

  # hashtag timeline: status + how many statuses came back + rate limit headers
  hdr=$(curl -sS -m 15 -A "$UA" -D - -o /tmp/tl.$$.json -w '' \
        "https://$host/api/v1/timelines/tag/$TAG?limit=3" 2>/dev/null)
  code=$(printf '%s' "$hdr" | awk 'toupper($1) ~ /^HTTP/ {c=$2} END{print c}')
  n=$(grep -o '"uri":' /tmp/tl.$$.json 2>/dev/null | wc -l | tr -d ' ')
  rl=$(printf '%s' "$hdr" | grep -i '^x-ratelimit' | tr -d '\r' | paste -sd' ' -)
  echo "GET /timelines/tag/$TAG -> $code  statuses=$n  $rl"
  [ "$code" != "200" ] && head -c 200 /tmp/tl.$$.json 2>/dev/null | tr -d '\n' && echo

  # tag metadata / 7-day history
  tcode=$(curl -sS -m 15 -A "$UA" -o /tmp/tg.$$.json -w '%{http_code}' \
          "https://$host/api/v1/tags/$TAG" 2>/dev/null)
  hist=$(grep -o '"uses":' /tmp/tg.$$.json 2>/dev/null | wc -l | tr -d ' ')
  echo "GET /tags/$TAG -> $tcode  history_days=$hist"

  # streaming health (does it advertise a stream at all, unauthenticated)
  scode=$(curl -sS -m 12 -A "$UA" -o /dev/null -w '%{http_code}' \
          "https://$host/api/v1/streaming/health" 2>/dev/null)
  echo "GET /streaming/health -> $scode"

  rm -f /tmp/tl.$$.json /tmp/tg.$$.json
}

for h in mastodon.social mastodon.online fosstodon.org hachyderm.io mas.to infosec.exchange mstdn.social techhub.social mastodon.world pixelfed.social; do
  probe "$h"
done
