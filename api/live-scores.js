/*
  /api/live-scores.js
  Multi-source live data provider.
  No mock fixtures are returned.

  Default behaviour:
  - Fetch ESPN no-key JSON scoreboard
  - Fetch optional WorldCup26 community API
  - Fetch optional API-Football if a key is present
  - Scrape an ESPN/FIFA-compatible public scoreboard page server-side
  - Merge all sources into one live scoreboard and live ticker

  This is a serverless JavaScript function because browser-only scraping is blocked
  by CORS and because API keys must never be exposed in public frontend code.
*/

import * as cheerio from "cheerio";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "s-maxage=12, stale-while-revalidate=24"
};

const DEFAULT_ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const DEFAULT_ESPN_SCRAPE_URL = "https://www.espn.com/soccer/scoreboard/_/league/fifa.world";
const DEFAULT_FIFA_SCRAPE_URL = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures";
const DEFAULT_WORLDCUP26_GAMES_URL = "https://worldcup26.ir/get/games";
const DEFAULT_WORLDCUP26_GROUPS_URL = "https://worldcup26.ir/get/groups";
const DEFAULT_WORLDCUP26_TEAMS_URL = "https://worldcup26.ir/get/teams";
const DEFAULT_PROVIDER_TIMEOUT_MS = 7000;

export default async function handler(req, res) {
  Object.entries(HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const payload = await fetchMultiSourceLiveData();

    const status = payload.matches.length ? 200 : 503;
    return res.status(status).json(payload);
  } catch (error) {
    return res.status(503).json({
      source: "not-connected",
      fetchedAt: new Date().toISOString(),
      error: error.message,
      warnings: [error.message],
      providers: [],
      ticker: [`LIVE DATA ERROR · ${error.message}`],
      scoreboard: [],
      matches: []
    });
  }
}

async function fetchMultiSourceLiveData() {
  const providers = [];

  providers.push({
    name: "espn-fifa-world-api",
    kind: "free-json-api",
    enabled: flag("ENABLE_ESPN_API", true),
    run: signal => fetchEspnFifaWorld(signal)
  });

  providers.push({
    name: "espn-scoreboard-scrape",
    kind: "web-scrape",
    enabled: flag("ENABLE_ESPN_SCRAPE", true),
    run: signal => fetchWebScrape("espn-scoreboard-scrape", process.env.ESPN_SCRAPE_URL || DEFAULT_ESPN_SCRAPE_URL, signal)
  });

  providers.push({
    name: "fifa-scores-fixtures-scrape",
    kind: "web-scrape",
    enabled: flag("ENABLE_FIFA_SCRAPE", false),
    run: signal => fetchWebScrape("fifa-scores-fixtures-scrape", process.env.FIFA_SCRAPE_URL || DEFAULT_FIFA_SCRAPE_URL, signal)
  });

  providers.push({
    name: "worldcup26-community-api",
    kind: "free-json-api",
    enabled: flag("ENABLE_WORLDCUP26_FREE", false),
    run: signal => fetchWorldCup26Free(signal)
  });

  providers.push({
    name: "api-football",
    kind: "api-key",
    enabled: Boolean(process.env.APISPORTS_KEY) && flag("ENABLE_API_FOOTBALL", true),
    run: signal => fetchApiFootball(signal)
  });

  providers.push({
    name: "custom-json-feed",
    kind: "custom-json",
    enabled: Boolean(process.env.JSON_FEED_URL) && flag("ENABLE_JSON_FEED", true),
    run: signal => fetchJsonFeed(signal)
  });

  const enabledProviders = providers.filter(provider => provider.enabled);

  const settled = await Promise.allSettled(enabledProviders.map(runProvider));

  const reports = [];
  const warnings = [];
  const allMatches = [];

  settled.forEach((result, index) => {
    const provider = enabledProviders[index];

    if (result.status === "fulfilled") {
      const data = result.value || {};
      const matches = Array.isArray(data.matches) ? data.matches.map(match => ({
        ...normaliseMatch(match),
        sources: unique([provider.name, ...(match.sources || []), data.source].filter(Boolean))
      })).filter(Boolean) : [];

      reports.push({
        name: provider.name,
        kind: provider.kind,
        ok: true,
        count: matches.length,
        message: matches.length ? "Loaded" : "Loaded but returned zero matches"
      });

      allMatches.push(...matches);

      if (Array.isArray(data.warnings)) warnings.push(...data.warnings);
    } else {
      const message = result.reason?.message || String(result.reason || "Unknown error");

      reports.push({
        name: provider.name,
        kind: provider.kind,
        ok: false,
        count: 0,
        message
      });

      warnings.push(`${provider.name}: ${message}`);
    }
  });

  const matches = mergeMatches(allMatches);
  const scoreboard = buildScoreboard(matches);
  const ticker = buildTicker(matches, reports, warnings);

  if (!matches.length) {
    warnings.push("No live match records available from API or scraping providers. No mock data was generated.");
  }

  return {
    source: "multi-source-live",
    fetchedAt: new Date().toISOString(),
    eventName: process.env.EVENT_NAME || "",
    notice: process.env.PUBLIC_NOTICE || "",
    sponsors: envList("SPONSORS", []),
    venue: process.env.VENUE_LABEL ? {
      label: process.env.VENUE_LABEL,
      detail: process.env.VENUE_DETAIL || "",
      capacity: Number(process.env.VENUE_CAPACITY || 0)
    } : null,
    providers: reports,
    warnings: unique(warnings),
    ticker,
    scoreboard,
    matches
  };
}

/*
  ESPN FIFA World Cup scoreboard adapter.
*/
async function runProvider(provider) {
  const controller = new AbortController();
  const timeoutMs = providerTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await provider.run(controller.signal);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEspnFifaWorld(signal) {
  const baseUrl = process.env.ESPN_SCOREBOARD_URL || DEFAULT_ESPN_SCOREBOARD_URL;
  const dates = process.env.ESPN_DATES;
  const url = dates ? appendQuery(baseUrl, { dates }) : baseUrl;

  const payload = await fetchJson(url, signal);
  const events = Array.isArray(payload.events) ? payload.events : [];
  const matches = events.map(mapEspnEventToMatch).filter(Boolean);

  return {
    source: "espn-fifa-world-api",
    fetchedAt: new Date().toISOString(),
    meta: {
      sourceUrl: url,
      league: payload.leagues?.[0]?.name || "FIFA World Cup",
      day: payload.day?.date || null,
      eventCount: events.length
    },
    matches
  };
}

function mapEspnEventToMatch(event) {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const competitors = competition.competitors || [];
  const home = competitors.find(item => item.homeAway === "home") || competitors[0];
  const away = competitors.find(item => item.homeAway === "away") || competitors[1];

  if (!home || !away) return null;

  const status = mapEspnStatus(competition.status);
  const elapsed = extractEspnElapsed(competition.status);

  return {
    id: String(event.id || competition.id || `${Date.now()}-${Math.random()}`),
    group: competition.altGameNote || event.season?.slug || "FIFA World Cup",
    round: competition.altGameNote || event.season?.slug || "FIFA World Cup",
    status,
    elapsed,
    kickoff: competition.date || event.date || new Date().toISOString(),
    venue: competition.venue?.fullName || "Venue TBC",
    city: competition.venue?.address?.city || "",
    home: {
      name: home.team?.displayName || home.team?.name || "Home",
      code: code(home.team?.abbreviation || home.team?.shortDisplayName || home.team?.displayName || "HOM"),
      goals: numberOrNull(home.score)
    },
    away: {
      name: away.team?.displayName || away.team?.name || "Away",
      code: code(away.team?.abbreviation || away.team?.shortDisplayName || away.team?.displayName || "AWY"),
      goals: numberOrNull(away.score)
    },
    events: mapEspnDetails(competition.details || [], home, away, status, elapsed),
    sources: ["espn-fifa-world-api"]
  };
}

function mapEspnStatus(statusObject) {
  const state = String(statusObject?.type?.state || "").toLowerCase();
  const name = String(statusObject?.type?.name || "").toLowerCase();
  const detail = String(statusObject?.type?.detail || statusObject?.type?.shortDetail || statusObject?.displayClock || "").toLowerCase();

  if (state === "in" || name.includes("in_progress") || detail.includes("'")) return "live";
  if (state === "post" || statusObject?.type?.completed || name.includes("full_time") || detail === "ft") return "done";

  return "upcoming";
}

function extractEspnElapsed(statusObject) {
  const displayClock = String(statusObject?.displayClock || statusObject?.type?.detail || "");
  const match = displayClock.match(/(\d{1,3})/);
  if (match) return Number(match[1]);

  const clockSeconds = Number(statusObject?.clock);
  if (Number.isFinite(clockSeconds) && clockSeconds > 0) {
    return Math.min(130, Math.max(0, Math.round(clockSeconds / 60)));
  }

  return 0;
}

function mapEspnDetails(details, home, away, status, elapsed) {
  if (Array.isArray(details) && details.length) {
    return details.map(detail => {
      const minute = detail.clock?.displayValue || "INFO";
      const teamId = detail.team?.id;
      const teamCode =
        teamId && home?.team?.id === teamId ? code(home.team?.abbreviation || home.team?.displayName) :
        teamId && away?.team?.id === teamId ? code(away.team?.abbreviation || away.team?.displayName) :
        "";

      const athlete = detail.athletesInvolved?.[0]?.displayName || "";
      const type = detail.type?.text || detail.text || "Match event";
      const text = [type, athlete, teamCode].filter(Boolean).join(" · ");

      return { minute, text };
    });
  }

  return [{
    minute: status === "live" ? `${elapsed || 0}'` : status === "done" ? "FT" : "KO",
    text: "Fixture loaded from ESPN FIFA World Cup scoreboard."
  }];
}

/*
  Web scraping adapter.
  Tries three approaches:
  1. Parse JSON-LD scripts
  2. Parse embedded JSON blobs in script tags
  3. Parse visible scoreboard-like text blocks
*/
async function fetchWebScrape(providerName, url, signal) {
  const html = await fetchText(url, signal);
  const $ = cheerio.load(html);

  const matches = [
    ...extractMatchesFromJsonLd($, providerName),
    ...extractMatchesFromEmbeddedJson($, providerName),
    ...extractMatchesFromVisibleText($, providerName)
  ];

  return {
    source: providerName,
    fetchedAt: new Date().toISOString(),
    meta: {
      sourceUrl: url,
      rawMatchCandidates: matches.length
    },
    warnings: matches.length ? [] : [`${providerName}: scrape source loaded but no match candidates were found`],
    matches
  };
}

async function fetchText(url, signal) {
  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; De-Omega-Point-LiveTickerScoreboard/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return response.text();
}

function extractMatchesFromJsonLd($, providerName) {
  const matches = [];

  $('script[type="application/ld+json"]').each((index, node) => {
    const raw = $(node).contents().text();

    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (!isLikelySportsEvent(item)) continue;

        const homeName = item.homeTeam?.name || item.competitor?.[0]?.name;
        const awayName = item.awayTeam?.name || item.competitor?.[1]?.name;

        if (!homeName || !awayName) continue;

        matches.push({
          id: `${providerName}-jsonld-${index}-${matches.length}`,
          group: "Scraped fixture",
          round: item.name || "Scraped fixture",
          status: mapStatus(item.eventStatus || item.status),
          elapsed: 0,
          kickoff: item.startDate || new Date().toISOString(),
          venue: item.location?.name || "Venue TBC",
          city: item.location?.address?.addressLocality || "",
          home: { name: homeName, code: code(homeName), goals: null },
          away: { name: awayName, code: code(awayName), goals: null },
          events: [{ minute: "SCRAPE", text: `Scraped from ${providerName} JSON-LD.` }],
          sources: [providerName]
        });
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  return matches;
}

function extractMatchesFromEmbeddedJson($, providerName) {
  const matches = [];
  const scripts = $("script").toArray();

  for (let index = 0; index < scripts.length; index += 1) {
    const raw = $(scripts[index]).contents().text();
    if (!raw || !raw.includes("competitions") || !raw.includes("competitors")) continue;

    const objects = extractJsonObjectsFromText(raw);

    for (const object of objects) {
      const events = Array.isArray(object.events) ? object.events : [];
      for (const event of events) {
        const mapped = mapEspnEventToMatch(event);
        if (mapped) {
          mapped.id = `${providerName}-embedded-${mapped.id}`;
          mapped.sources = unique([providerName, ...(mapped.sources || [])]);
          matches.push(mapped);
        }
      }
    }
  }

  return matches;
}

function extractJsonObjectsFromText(text) {
  const candidates = [];

  const nextDataMatch = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try { candidates.push(JSON.parse(nextDataMatch[1])); } catch {}
  }

  const directJsonStart = text.indexOf('{"');
  if (directJsonStart >= 0) {
    const directText = text.slice(directJsonStart);
    try { candidates.push(JSON.parse(directText)); } catch {}
  }

  return candidates;
}

function extractMatchesFromVisibleText($, providerName) {
  const matches = [];
  const containers = [
    ".Scoreboard",
    ".ScoreCell",
    "[class*=Scoreboard]",
    "[class*=scoreboard]",
    "[class*=ScoreCell]",
    "section",
    "article"
  ];

  const seen = new Set();

  for (const selector of containers) {
    $(selector).each((index, node) => {
      const text = $(node).text().replace(/\s+/g, " ").trim();
      if (!text || text.length < 8 || text.length > 500) return;
      if (seen.has(text)) return;
      seen.add(text);

      const parsed = parseLooseScoreText(text, providerName, index);
      if (parsed) matches.push(parsed);
    });
  }

  return matches;
}

function parseLooseScoreText(text, providerName, index) {
  const scoreMatch = text.match(/(.{2,40}?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})\s+(.{2,40})/);
  if (!scoreMatch) return null;

  const homeName = cleanTeamName(scoreMatch[1]);
  const awayName = cleanTeamName(scoreMatch[4]);

  if (!homeName || !awayName || homeName.length < 2 || awayName.length < 2) return null;

  return {
    id: `${providerName}-text-${index}`,
    group: "Scraped scoreboard",
    round: "Scraped scoreboard",
    status: mapStatus(text),
    elapsed: extractElapsedFromText(text),
    kickoff: new Date().toISOString(),
    venue: "Venue TBC",
    city: "",
    home: {
      name: homeName,
      code: code(homeName),
      goals: numberOrNull(scoreMatch[2])
    },
    away: {
      name: awayName,
      code: code(awayName),
      goals: numberOrNull(scoreMatch[3])
    },
    events: [{ minute: "SCRAPE", text: `Scraped visible scoreboard text from ${providerName}.` }],
    sources: [providerName]
  };
}

function isLikelySportsEvent(item) {
  const type = item?.["@type"];
  if (Array.isArray(type)) return type.some(value => String(value).toLowerCase().includes("sport"));
  return String(type || "").toLowerCase().includes("sport") || String(type || "").toLowerCase().includes("event");
}

function cleanTeamName(value) {
  return String(value || "")
    .replace(/\b(LIVE|FT|KO|HT|Final|Full Time|Today|Tomorrow)\b/gi, "")
    .replace(/[^\p{L}\p{N}\s.'&-]/gu, "")
    .trim()
    .slice(0, 40);
}

/*
  Community/open-source World Cup 2026 adapter.
*/
async function fetchWorldCup26Free(signal) {
  const gamesUrl = process.env.WORLDCUP26_GAMES_URL || DEFAULT_WORLDCUP26_GAMES_URL;
  const groupsUrl = process.env.WORLDCUP26_GROUPS_URL || DEFAULT_WORLDCUP26_GROUPS_URL;
  const teamsUrl = process.env.WORLDCUP26_TEAMS_URL || DEFAULT_WORLDCUP26_TEAMS_URL;

  const [gamesPayload, groupsPayload, teamsPayload] = await Promise.allSettled([
    fetchJson(gamesUrl, signal),
    fetchJson(groupsUrl, signal),
    fetchJson(teamsUrl, signal)
  ]);

  if (gamesPayload.status !== "fulfilled") {
    throw new Error(`Free World Cup API failed: ${gamesPayload.reason.message}`);
  }

  const games = extractArray(gamesPayload.value, ["games", "matches", "data", "response", "results"]);

  if (!games.length) {
    throw new Error("Free World Cup API returned no games. No mock matches were generated.");
  }

  const teams = teamsPayload.status === "fulfilled"
    ? extractArray(teamsPayload.value, ["teams", "data", "response", "results"])
    : [];

  const groups = groupsPayload.status === "fulfilled"
    ? extractArray(groupsPayload.value, ["groups", "data", "response", "results"])
    : [];

  const teamLookup = buildTeamLookup(teams);
  const matches = games.map((game, index) => mapWorldCup26Game(game, index, teamLookup)).filter(Boolean);

  return {
    source: "worldcup26-community-api",
    fetchedAt: new Date().toISOString(),
    meta: {
      sourceUrl: gamesUrl,
      groupsLoaded: groups.length,
      teamsLoaded: teams.length
    },
    matches
  };
}

/*
  Alternative JSON feed adapter.
*/
async function fetchJsonFeed(signal) {
  const url = process.env.JSON_FEED_URL;
  if (!url) throw new Error("JSON_FEED_URL is missing");

  const payload = await fetchJson(url, signal);
  if (!Array.isArray(payload.matches)) throw new Error("JSON feed must include a matches array");

  return {
    source: "realtime-json",
    fetchedAt: new Date().toISOString(),
    ...payload,
    matches: payload.matches
  };
}

/*
  Optional API-Football adapter.
*/
async function fetchApiFootball(signal) {
  const key = process.env.APISPORTS_KEY;
  if (!key) throw new Error("APISPORTS_KEY is missing. Configure the live API key. No mock data returned.");

  const league = process.env.APISPORTS_LEAGUE || "1";
  const season = process.env.APISPORTS_SEASON || "2026";
  const today = new Date().toISOString().slice(0, 10);

  let data = await callApiSports(`https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}&live=all`, key, signal);

  if (!data.response || !data.response.length) {
    data = await callApiSports(`https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}&date=${today}`, key, signal);
  }

  return {
    source: "api-football",
    fetchedAt: new Date().toISOString(),
    matches: (data.response || []).map(apiFootballFixtureToMatch)
  };
}

/*
  Merge, scoreboard, and ticker.
*/
function mergeMatches(matches) {
  const buckets = new Map();

  for (const match of matches.map(normaliseMatch).filter(Boolean)) {
    const key = matchKey(match);
    const current = buckets.get(key);

    if (!current) {
      buckets.set(key, match);
      continue;
    }

    buckets.set(key, mergeMatchRecords(current, match));
  }

  return [...buckets.values()].sort(sortMatches);
}

function mergeMatchRecords(a, b) {
  const preferred = sourceRank(b.sources) >= sourceRank(a.sources) ? b : a;
  const secondary = preferred === b ? a : b;

  return {
    ...secondary,
    ...preferred,
    home: {
      ...secondary.home,
      ...preferred.home,
      goals: preferred.home.goals ?? secondary.home.goals
    },
    away: {
      ...secondary.away,
      ...preferred.away,
      goals: preferred.away.goals ?? secondary.away.goals
    },
    events: mergeEvents(preferred.events, secondary.events),
    sources: unique([...(a.sources || []), ...(b.sources || [])])
  };
}

function sourceRank(sources = []) {
  const text = sources.join(" ");
  if (text.includes("api-football")) return 5;
  if (text.includes("espn-fifa-world-api")) return 4;
  if (text.includes("worldcup26")) return 3;
  if (text.includes("scrape")) return 2;
  return 1;
}

function mergeEvents(primary = [], secondary = []) {
  const seen = new Set();
  const events = [];

  for (const event of [...primary, ...secondary]) {
    const key = `${event.minute}|${event.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }

  return events.slice(-10);
}

function buildScoreboard(matches) {
  return matches.map(match => ({
    id: match.id,
    status: match.status,
    elapsed: match.elapsed,
    kickoff: match.kickoff,
    label: `${match.home.code} ${score(match.home.goals)}-${score(match.away.goals)} ${match.away.code}`,
    home: match.home,
    away: match.away,
    venue: match.venue,
    sources: match.sources || []
  }));
}

function buildTicker(matches, providerReports, warnings) {
  const providerText = providerReports
    .map(provider => `${provider.ok ? "✓" : "!"} ${provider.name}: ${provider.count}`)
    .join(" · ");

  const matchText = matches.length
    ? matches.map(match => `${match.status === "live" ? "● LIVE" : match.status === "done" ? "FT" : "KO"} ${match.home.code} ${score(match.home.goals)}-${score(match.away.goals)} ${match.away.code} · ${match.venue}`).slice(0, 12)
    : ["NO LIVE MATCH DATA · APIs and scraping returned no usable fixtures"];

  const warningText = warnings.length ? [`WARNINGS · ${warnings.slice(0, 2).join(" · ")}`] : [];

  return [`MULTI-SOURCE LIVE · ${providerText}`, ...matchText, ...warningText];
}

/*
  Shared helpers.
*/
async function fetchJson(url, signal) {
  const text = await fetchText(url, signal);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return valid JSON`);
  }
}

async function callApiSports(url, key, signal) {
  const response = await fetch(url, { signal, headers: { "x-apisports-key": key } });
  if (!response.ok) throw new Error(`API-SPORTS returned ${response.status}`);
  return response.json();
}

function appendQuery(url, params) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function apiFootballFixtureToMatch(item) {
  const status = mapStatus(item.fixture?.status?.short || item.fixture?.status?.long);

  return {
    id: String(item.fixture?.id || `${Date.now()}-${Math.random()}`),
    group: item.league?.round || "World Cup",
    round: item.league?.round || "Fixture",
    status,
    elapsed: Number(item.fixture?.status?.elapsed || (status === "done" ? 90 : 0)),
    kickoff: item.fixture?.date || new Date().toISOString(),
    venue: item.fixture?.venue?.name || "Venue TBC",
    city: item.fixture?.venue?.city || "",
    home: {
      name: item.teams?.home?.name || "Home",
      code: code(item.teams?.home?.name || "HOM"),
      goals: numberOrNull(item.goals?.home)
    },
    away: {
      name: item.teams?.away?.name || "Away",
      code: code(item.teams?.away?.name || "AWY"),
      goals: numberOrNull(item.goals?.away)
    },
    events: [{
      minute: status === "live" ? `${item.fixture?.status?.elapsed || 0}'` : status === "done" ? "FT" : "KO",
      text: item.fixture?.status?.long || "Fixture loaded from live feed."
    }],
    sources: ["api-football"]
  };
}

function mapWorldCup26Game(game, index, teamLookup) {
  const homeRaw =
    game.home || game.homeTeam || game.home_team || game.team1 || game.teamA ||
    game.home_country || game.country1 || game.first_team || game.team_1;

  const awayRaw =
    game.away || game.awayTeam || game.away_team || game.team2 || game.teamB ||
    game.away_country || game.country2 || game.second_team || game.team_2;

  const home = resolveTeam(homeRaw, teamLookup, "Home");
  const away = resolveTeam(awayRaw, teamLookup, "Away");

  if (!home.name || !away.name || home.name === "Home" || away.name === "Away") return null;

  const scoreObject = game.score || game.result || game.goals || {};

  return {
    id: String(game.id || game._id || game.game_id || game.match_id || `worldcup26-${index}`),
    group: stringValue(game.group, game.group_name, game.round, "World Cup 2026"),
    round: stringValue(game.round, game.stage, game.phase, game.group, game.matchday, "World Cup 2026"),
    status: mapStatus(game.status || game.match_status || game.state || game.phase || game.status_short || game.statusShort || game.time),
    elapsed: firstNumber(game.elapsed, game.minute, game.match_minute, game.currentMinute, game.time_elapsed, game.status?.elapsed) || 0,
    kickoff: game.date || game.datetime || game.kickoff || game.kick_off || game.start_time || game.startTime || game.match_date || new Date().toISOString(),
    venue: stringValue(game.venue, game.stadium, game.stadium_name, game.location, game.city, "Venue TBC"),
    city: stringValue(game.city, game.host_city, game.venue_city, ""),
    home: {
      name: home.name,
      code: home.code,
      goals: firstNumber(game.home_score, game.homeScore, game.home_goals, game.homeGoals, scoreObject.home, scoreObject.team1, game.team1_score)
    },
    away: {
      name: away.name,
      code: away.code,
      goals: firstNumber(game.away_score, game.awayScore, game.away_goals, game.awayGoals, scoreObject.away, scoreObject.team2, game.team2_score)
    },
    events: normaliseEvents(game),
    sources: ["worldcup26-community-api"]
  };
}

function resolveTeam(raw, lookup, fallback) {
  if (!raw) return { name: fallback, code: code(fallback) };

  if (typeof raw === "object") {
    const name = stringValue(raw.name_en, raw.en_name, raw.name, raw.country, raw.title, raw.label, fallback);
    return { name, code: code(raw.fifa_code || raw.code || raw.abbr || name) };
  }

  const key = String(raw).toLowerCase();
  const found = lookup.get(key);

  if (found) {
    const name = stringValue(found.name_en, found.en_name, found.name, found.country, found.title, String(raw));
    return { name, code: code(found.fifa_code || found.code || found.abbr || name) };
  }

  return { name: String(raw), code: code(raw) };
}

function normaliseEvents(game) {
  const rawEvents = game.events || game.timeline || game.incidents || game.match_events || [];

  if (Array.isArray(rawEvents) && rawEvents.length) {
    return rawEvents.map(event => ({
      minute: stringValue(event.minute, event.time, event.elapsed, "INFO"),
      text: stringValue(event.text, event.detail, event.description, event.type, "Live event")
    }));
  }

  return [{
    minute: "INFO",
    text: stringValue(game.status, game.match_status, game.state, "Fixture loaded from realtime source.")
  }];
}

function normaliseMatch(match) {
  if (!match || !match.home || !match.away) return null;

  return {
    id: String(match.id || `${Date.now()}-${Math.random()}`),
    group: match.group || match.round || "Live fixture",
    round: match.round || match.group || "Live fixture",
    status: normaliseStatus(match.status),
    elapsed: Number(match.elapsed || 0),
    kickoff: match.kickoff || new Date().toISOString(),
    venue: match.venue || "Venue TBC",
    city: match.city || "",
    home: {
      name: match.home.name || "Home",
      code: code(match.home.code || match.home.name),
      goals: numberOrNull(match.home.goals)
    },
    away: {
      name: match.away.name || "Away",
      code: code(match.away.code || match.away.name),
      goals: numberOrNull(match.away.goals)
    },
    events: Array.isArray(match.events) ? match.events.map(event => ({
      minute: event.minute || event.time || "INFO",
      text: event.text || event.detail || event.description || "Live update."
    })) : [],
    sources: unique(match.sources || [])
  };
}

function normaliseStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["live", "1h", "2h", "ht", "et", "in_play"].includes(value)) return "live";
  if (["done", "finished", "ft", "aet", "pen"].includes(value)) return "done";
  return "upcoming";
}

function extractArray(payload, candidateKeys) {
  if (Array.isArray(payload)) return payload;

  for (const key of candidateKeys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  for (const value of Object.values(payload || {})) {
    if (Array.isArray(value)) return value;
  }

  return [];
}

function buildTeamLookup(teams) {
  const lookup = new Map();

  for (const team of teams) {
    const keys = [
      team.id,
      team._id,
      team.team_id,
      team.fifa_code,
      team.code,
      team.name,
      team.name_en,
      team.en_name,
      team.country
    ].filter(Boolean);

    for (const key of keys) lookup.set(String(key).toLowerCase(), team);
  }

  return lookup;
}

function mapStatus(value) {
  const text = String(value || "").toLowerCase();

  if (["live", "1h", "2h", "ht", "et", "in_play"].some(token => text.includes(token))) return "live";
  if (["done", "finished", "ft", "full", "aet", "pen"].some(token => text.includes(token))) return "done";

  return "upcoming";
}

function extractElapsedFromText(value) {
  const match = String(value || "").match(/(\d{1,3})\s*'?/);
  return match ? Number(match[1]) : 0;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringValue(...values) {
  const fallback = values[values.length - 1];

  for (const value of values.slice(0, -1)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }

  return String(fallback || "");
}

function code(value) {
  return String(value || "TBC").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TBC";
}

function score(value) {
  return value === null || value === undefined || value === "" ? "–" : value;
}

function matchKey(match) {
  const home = String(match.home?.name || match.home?.code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const away = String(match.away?.name || match.away?.code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const date = String(match.kickoff || "").slice(0, 10);
  return [date, home, away].join("|");
}

function sortMatches(a, b) {
  const liveRank = { live: 0, upcoming: 1, done: 2 };
  const byStatus = (liveRank[a.status] ?? 9) - (liveRank[b.status] ?? 9);
  if (byStatus !== 0) return byStatus;
  return new Date(a.kickoff) - new Date(b.kickoff);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function flag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}

function envList(key, fallback) {
  const raw = process.env[key];
  return raw ? raw.split(",").map(x => x.trim()).filter(Boolean).slice(0, 3) : fallback;
}

function providerTimeoutMs() {
  const value = Number(process.env.PROVIDER_TIMEOUT_MS || DEFAULT_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 ? value : DEFAULT_PROVIDER_TIMEOUT_MS;
}
