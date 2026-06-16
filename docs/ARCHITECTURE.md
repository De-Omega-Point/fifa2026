# Architecture

## Multi-source live mode

`/api/live-scores` fetches multiple live providers simultaneously with a per-provider timeout:

- ESPN FIFA World Cup JSON scoreboard
- ESPN scoreboard web page scraper
- Optional WorldCup26 community API
- Optional FIFA scores page scraper
- Optional API-Football with API key
- Optional custom JSON feed

## Returned shape

```json
{
  "source": "multi-source-live",
  "fetchedAt": "...",
  "providers": [],
  "warnings": [],
  "ticker": [],
  "scoreboard": [],
  "matches": []
}
```

## No mock data guarantee

There is no embedded match dataset and no static fixture fallback. If providers fail, the app reports the failure.

The browser clients no longer bypass the serverless endpoint with direct provider fallbacks. This keeps provider diagnostics, warnings and merge behavior in one place.

## Why server-side scraping

Browsers block most cross-origin scraping with CORS. The serverless layer fetches sources server-side and returns clean JSON to the UI.

## Conflict handling

Matches are merged by date and teams. Source priority:

1. API-Football
2. ESPN JSON API
3. WorldCup26 community API
4. Scraped data

## Public screen freshness

The public screen may render locally stored event settings while the network request is in flight, but it fetches the configured API on every interval. If the API fails, it shows the error instead of treating stale browser storage as a live score source.

`localStorage` only syncs tabs/windows in the same browser profile and origin. It is not a shared venue database.

## Runtime flags

- `PROVIDER_TIMEOUT_MS`: provider timeout in milliseconds; default `7000`.
- `ENABLE_ESPN_API`: default `true`.
- `ENABLE_ESPN_SCRAPE`: default `true`.
- `ENABLE_WORLDCUP26_FREE`: default `false`.
- `ENABLE_FIFA_SCRAPE`: default `false`.
- `ENABLE_API_FOOTBALL`: default `true` when `APISPORTS_KEY` exists.
- `ENABLE_JSON_FEED`: default `true` when `JSON_FEED_URL` exists.
