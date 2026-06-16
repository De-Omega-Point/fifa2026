const API_URL = "/api/live-scores";
const STATIC_FEED_URL = "./data/live-scores.json";
const REFRESH_MS = 30000;

const TROPHIES = [
  { title: "FIFA World Cup", winner: "Argentina", detail: "Current holders from Qatar 2022" },
  { title: "Golden Ball", winner: "Lionel Messi", detail: "Best player, Qatar 2022" },
  { title: "Golden Boot", winner: "Kylian Mbappe", detail: "Top scorer, Qatar 2022" },
  { title: "Golden Glove", winner: "Emiliano Martinez", detail: "Best goalkeeper, Qatar 2022" },
  { title: "Young Player", winner: "Enzo Fernandez", detail: "Best young player, Qatar 2022" },
  { title: "FIFA Fair Play", winner: "England", detail: "Fair play award, Qatar 2022" }
];

let state = {
  source: "not-connected",
  fetchedAt: null,
  error: null,
  providers: [],
  warnings: [],
  ticker: [],
  matches: []
};

const $ = id => document.getElementById(id);

async function loadHome() {
  try {
    state = normaliseState(await fetchLivePayload());
  } catch (error) {
    state = normaliseState({
      source: "not-connected",
      error: error.message,
      ticker: [`FREE DATA ERROR · ${error.message}`],
      matches: []
    });
  }

  render();
}

async function fetchLivePayload() {
  try {
    return await fetchJson(API_URL);
  } catch {
    return fetchJson(STATIC_FEED_URL);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `${url} returned ${response.status}`);
  }

  return payload;
}

function normaliseState(payload) {
  return {
    source: payload.source || "free-data",
    fetchedAt: payload.fetchedAt || payload.generatedAt || null,
    generatedAt: payload.generatedAt || null,
    staticSnapshot: Boolean(payload.staticSnapshot),
    error: payload.error || null,
    providers: Array.isArray(payload.providers) ? payload.providers : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    ticker: Array.isArray(payload.ticker) ? payload.ticker : [],
    matches: Array.isArray(payload.matches) ? payload.matches.map(normaliseMatch).filter(Boolean) : []
  };
}

function normaliseMatch(match) {
  if (!match?.home || !match?.away) return null;

  return {
    id: String(match.id || `${match.home.name}-${match.away.name}-${match.kickoff}`),
    group: match.group || match.round || "Fixture",
    round: match.round || match.group || "Fixture",
    status: normaliseStatus(match.status),
    elapsed: Number(match.elapsed || 0),
    kickoff: match.kickoff || new Date().toISOString(),
    venue: match.venue || "Venue TBC",
    city: match.city || "",
    home: normaliseTeam(match.home, "Home"),
    away: normaliseTeam(match.away, "Away"),
    events: Array.isArray(match.events) ? match.events : []
  };
}

function normaliseTeam(team, fallback) {
  return {
    name: team.name || fallback,
    code: code(team.code || team.name || fallback),
    goals: goal(team.goals)
  };
}

function render() {
  const matches = state.matches;
  const liveMatches = matches.filter(match => match.status === "live");

  $("homeSourcePill").textContent = state.staticSnapshot ? "Static free data" : state.source || "Free data";
  $("homeSourcePill").className = `status-pill ${state.error ? "error" : state.staticSnapshot ? "warn" : ""}`;
  $("homeMatchCount").textContent = `${matches.length} match record${matches.length === 1 ? "" : "s"}`;
  $("homeUpdatedAt").textContent = state.fetchedAt ? `Updated ${formatDateTime(state.fetchedAt)}` : "Waiting for feed";
  $("liveCountPill").textContent = `${liveMatches.length} live`;

  renderTicker();
  renderCurrentlyPlaying(liveMatches);
  renderNextTeams();
  renderStandings();
  renderProviders();
  renderTrophies();
  renderInsights();
}

function renderTicker() {
  const items = state.ticker.length
    ? state.ticker
    : state.error
      ? [`FREE DATA ERROR · ${state.error}`]
      : ["WAITING FOR FREE DATA SOURCES"];

  $("homeTickerList").innerHTML = items.slice(0, 10).map(item => `<span>${escapeHtml(item)}</span>`).join("");
}

function renderCurrentlyPlaying(liveMatches) {
  if (!liveMatches.length) {
    const next = nextFixtures()[0];
    $("currentlyPlaying").innerHTML = `
      <article class="home-empty">
        <strong>No matches in play right now</strong>
        <span>${next ? `Next: ${escapeHtml(next.home.name)} v ${escapeHtml(next.away.name)} · ${formatDateTime(next.kickoff)}` : "Waiting for upcoming fixtures from the free feed."}</span>
      </article>
    `;
    return;
  }

  $("currentlyPlaying").innerHTML = liveMatches.map(match => `
    <article class="play-card">
      <div class="play-meta">
        <span>${escapeHtml(match.round)}</span>
        <strong>${match.elapsed || 0}'</strong>
      </div>
      <div class="play-scoreline">
        <span>${escapeHtml(match.home.code)}</span>
        <strong>${score(match.home.goals)} : ${score(match.away.goals)}</strong>
        <span>${escapeHtml(match.away.code)}</span>
      </div>
      <div class="play-names">
        <span>${escapeHtml(match.home.name)}</span>
        <span>${escapeHtml(match.away.name)}</span>
      </div>
      <p>${escapeHtml(match.venue)}${match.city ? ` · ${escapeHtml(match.city)}` : ""}</p>
    </article>
  `).join("");
}

function renderNextTeams() {
  const teams = [];
  const seen = new Set();

  for (const match of nextFixtures()) {
    for (const side of ["home", "away"]) {
      const team = match[side];
      if (seen.has(team.code)) continue;
      seen.add(team.code);
      teams.push({ team, match, opponent: side === "home" ? match.away : match.home });
      if (teams.length === 4) break;
    }
    if (teams.length === 4) break;
  }

  $("nextTeams").innerHTML = teams.length ? teams.map(item => `
    <article class="next-team-card">
      <strong>${escapeHtml(item.team.code)}</strong>
      <span>${escapeHtml(item.team.name)}</span>
      <small>v ${escapeHtml(item.opponent.code)} · ${formatDateTime(item.match.kickoff)}</small>
    </article>
  `).join("") : `<article class="home-empty"><strong>No next teams available</strong><span>The free feed has not returned upcoming fixtures yet.</span></article>`;
}

function renderStandings() {
  const rows = buildStandings();
  $("standingCountPill").textContent = `${rows.length} teams`;

  $("standingsTable").innerHTML = rows.length ? `
    <div class="standings-row standings-head">
      <span>#</span><span>Team</span><span>P</span><span>GD</span><span>Pts</span>
    </div>
    ${rows.slice(0, 16).map((team, index) => `
      <div class="standings-row">
        <span>${index + 1}</span>
        <strong>${escapeHtml(team.code)} · ${escapeHtml(team.name)}</strong>
        <span>${team.played}</span>
        <span>${team.goalDiff > 0 ? "+" : ""}${team.goalDiff}</span>
        <span>${team.points}</span>
      </div>
    `).join("")}
  ` : `<article class="home-empty"><strong>No standings yet</strong><span>Rankings appear when the free feed returns teams.</span></article>`;
}

function renderProviders() {
  $("providerList").innerHTML = state.providers.length ? state.providers.map(provider => `
    <article class="provider-card">
      <div>
        <strong>${escapeHtml(provider.name)}</strong>
        <span>${escapeHtml(provider.kind || "source")}</span>
      </div>
      <span class="pill ${provider.ok ? "" : "error"}">${provider.ok ? `${provider.count || 0} records` : "Issue"}</span>
    </article>
  `).join("") : `<article class="home-empty"><strong>Static snapshot</strong><span>Provider details are unavailable until the free feed responds.</span></article>`;
}

function renderTrophies() {
  $("trophyGrid").innerHTML = TROPHIES.map(item => `
    <article class="trophy-card">
      <span>${escapeHtml(item.title)}</span>
      <strong>${escapeHtml(item.winner)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </article>
  `).join("");
}

function renderInsights() {
  const matches = state.matches;
  const live = matches.filter(match => match.status === "live").length;
  const done = matches.filter(match => match.status === "done").length;
  const goals = matches.reduce((total, match) => total + Number(match.home.goals || 0) + Number(match.away.goals || 0), 0);
  const next = nextFixtures()[0];

  const insights = [
    ["Live now", live],
    ["Finished", done],
    ["Goals in feed", goals],
    ["Next kickoff", next ? formatDateTime(next.kickoff) : "TBC"],
    ["Feed mode", state.staticSnapshot ? "Static snapshot" : "Live API"],
    ["Warnings", state.warnings.length]
  ];

  $("insightGrid").innerHTML = insights.map(([label, value]) => `
    <article class="insight-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `).join("");
}

function buildStandings() {
  const teams = new Map();

  for (const match of state.matches) {
    ensureTeam(teams, match.home);
    ensureTeam(teams, match.away);

    if (match.home.goals === null || match.away.goals === null) continue;
    if (!["live", "done"].includes(match.status)) continue;

    const home = teams.get(match.home.code);
    const away = teams.get(match.away.code);
    const hg = Number(match.home.goals);
    const ag = Number(match.away.goals);

    home.played += 1;
    away.played += 1;
    home.goalsFor += hg;
    home.goalsAgainst += ag;
    away.goalsFor += ag;
    away.goalsAgainst += hg;

    if (hg > ag) {
      home.points += 3;
      home.won += 1;
      away.lost += 1;
    } else if (ag > hg) {
      away.points += 3;
      away.won += 1;
      home.lost += 1;
    } else {
      home.points += 1;
      away.points += 1;
      home.drawn += 1;
      away.drawn += 1;
    }
  }

  return [...teams.values()]
    .map(team => ({ ...team, goalDiff: team.goalsFor - team.goalsAgainst }))
    .sort((a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name)
    );
}

function ensureTeam(teams, team) {
  if (teams.has(team.code)) return;
  teams.set(team.code, {
    code: team.code,
    name: team.name,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0
  });
}

function nextFixtures() {
  const now = Date.now();
  return state.matches
    .filter(match => match.status === "upcoming" || new Date(match.kickoff).getTime() >= now)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

function normaliseStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["live", "1h", "2h", "ht", "et", "in_play"].includes(value)) return "live";
  if (["done", "finished", "ft", "aet", "pen"].includes(value)) return "done";
  return "upcoming";
}

function code(value) {
  return String(value || "TBC").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TBC";
}

function goal(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function score(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function formatDateTime(iso) {
  if (!iso) return "TBC";
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

loadHome();
setInterval(loadHome, REFRESH_MS);
