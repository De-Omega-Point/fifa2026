# Architecture

## Multi-source live mode

`/api/live-scores` fetches multiple live providers simultaneously:

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

## Why server-side scraping

Browsers block most cross-origin scraping with CORS. The serverless layer fetches sources server-side and returns clean JSON to the UI.

## Conflict handling

Matches are merged by date and teams. Source priority:

1. API-Football
2. ESPN JSON API
3. WorldCup26 community API
4. Scraped data
