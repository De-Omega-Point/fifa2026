# World Cup Multi-Source Live Ticker + Scoreboard OS

Author: Sammie Lee  
Organisation: De-Omega-Point  
Version: 10.0 Multi-Source Live Ticker + Scoreboard  
Publication Date: 2026-06-14  
Publication Time: 17:45 UTC  
Classification: Public MVP Artifact  
Focus: Human-Value Technology  
Region: Australia / South Australia-ready  
Review Cycle: Weekly during tournament  

## Core read

This version adds a simultaneous free-API + server-side web-scraping combo.

The endpoint:

`/api/live-scores`

now runs multiple sources at the same time, merges results, and returns:

- `matches`
- `scoreboard`
- `ticker`
- `providers`
- `warnings`

## Default sources

### Free JSON API

`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard`

### Web scraping

`https://www.espn.com/soccer/scoreboard/_/league/fifa.world`

### Optional community API

`https://worldcup26.ir/get/games`

### Optional official FIFA page scrape

`https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures`

Disabled by default because modern FIFA pages can be heavily client-rendered and may not expose clean HTML.

## No mock data rule

Still preserved:

- No demo teams
- No fake scores
- No fallback fixtures
- No static match JSON
- No manually editable scores

If all providers fail, the UI shows an error/warning instead of inventing fixtures.

## How the combo works

1. All enabled providers are fetched simultaneously using `Promise.allSettled`.
2. Successful providers return normalised matches.
3. Failed providers are recorded in `providers` and `warnings`.
4. Matches are merged by date + teams.
5. Higher-confidence sources win score conflicts:
   - API-Football
   - ESPN JSON API
   - WorldCup26 community API
   - Web scrape
6. A live ticker is generated from the merged data.
7. A live scoreboard array is generated from the merged data.

## Deploy

Use Vercel because the scraping layer must run server-side.

```bash
npm install
npm run dev
```

Then open:

- `index.html` for cockpit
- `public.html` for public display

## Required dependency

This version adds:

```json
"cheerio": "^1.0.0"
```

Cheerio is used only inside the serverless scraping function.

## Important source note

ESPN's endpoint is a public site JSON endpoint, not an official FIFA API. The WorldCup26 project is community/open-source, not official FIFA. Use official sources for official fixtures, results, public viewing rights and broadcast requirements.
