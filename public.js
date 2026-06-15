/*
  Live-only public screen.
  Reads live-only public state from localStorage.
  No mock match data is embedded.
*/

const PUBLIC_KEY = "wc_live_only_public_state";
const API_URL = "/api/live-scores";
const REFRESH_MS = 5000;
const TICKER_PX_PER_SECOND = 82;

let state = {
  source: "not-connected",
  error: null,
  eventName: "",
  notice: "",
  sponsors: [],
  venue: null,
  tracking: { checkins: 0, interactions: 0 },
  matches: []
};

let lastTickerText = "";

const $ = id => document.getElementById(id);

const urlParams = new URLSearchParams(window.location.search);
const queryApi = urlParams.get("api");

async function loadState() {
  const local = readLocal();
  let apiUrl = queryApi || (local && local.apiUrl) || API_URL;

  if (local) {
    state = normaliseState(local);
    render();
    if (!queryApi) return;
  }

  try {
    let payload;
    let fallbackUsed = false;

    try {
      const response = await fetch(apiUrl, { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.ok) {
        payload = await response.json().catch(() => ({}));
      } else if (apiUrl === "/api/live-scores") {
        fallbackUsed = true;
      } else {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || `API returned ${response.status}`);
      }
    } catch (err) {
      if (apiUrl === "/api/live-scores") {
        fallbackUsed = true;
      } else {
        throw err;
      }
    }

    if (fallbackUsed) {
      payload = await fetchDirectEspn();
    }

    state = normaliseState(payload);
  } catch (error) {
    state = {
      source: "not-connected",
      error: error.message,
      eventName: "",
      notice: "",
      sponsors: [],
      venue: null,
      tracking: { checkins: 0, interactions: 0 },
      matches: []
    };
  }

  render();
}

function readLocal() {
  try {
    const raw = localStorage.getItem(PUBLIC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normaliseState(payload) {
  return {
    source: payload.source || "live-api",
    fetchedAt: payload.fetchedAt || null,
    error: payload.error || null,
    eventName: payload.eventName || "",
    notice: payload.notice || "",
    sponsors: Array.isArray(payload.sponsors) ? payload.sponsors : [],
    apiUrl: payload.apiUrl || "/api/live-scores",
    mainMatchId: payload.mainMatchId || null,
    venue: payload.venue || null,
    tracking: payload.tracking || { checkins: 0, interactions: 0 },
    matches: Array.isArray(payload.matches) ? payload.matches.map(normaliseMatch).filter(Boolean) : []
  };
}

function normaliseMatch(match) {
  if (!match || !match.home || !match.away) return null;
  return {
    id: String(match.id),
    group: match.group || match.round || "Live fixture",
    round: match.round || match.group || "Live fixture",
    status: match.status || "upcoming",
    elapsed: Number(match.elapsed || 0),
    kickoff: match.kickoff || new Date().toISOString(),
    venue: match.venue || "Venue TBC",
    city: match.city || "",
    home: {
      name: match.home.name || "Home",
      code: code(match.home.code || match.home.name),
      goals: goal(match.home.goals)
    },
    away: {
      name: match.away.name || "Away",
      code: code(match.away.code || match.away.name),
      goals: goal(match.away.goals)
    },
    events: Array.isArray(match.events) ? match.events : []
  };
}

function render() {
  const match = featuredMatch();

  $("eventName").textContent = state.eventName || "Live Public Viewing";
  $("publicNotice").textContent = state.notice || "Live feed required.";
  $("subNotice").textContent = state.error ? `Realtime feed error: ${state.error}` : "No mock match data is displayed.";
  $("feedLabel").textContent = state.matches.length ? "Realtime" : "No feed";

  if (!match) {
    renderNoData();
    renderVenue();
    renderSponsors();
    renderTicker(null);
    renderClock();
    return;
  }

  $("matchState").textContent = statusText(match);
  $("matchState").className = "state-badge";
  $("matchMeta").textContent = `${match.round} · ${match.venue} · ${match.city || "Live feed"} · ${formatShort(match.kickoff)}`;

  $("publicScore").innerHTML = `
    <article class="public-team">
      <div>
        <div class="public-team-code">${escapeHtml(match.home.code)}</div>
        <h2>${escapeHtml(match.home.name)}</h2>
      </div>
    </article>
    <div class="public-score-number">${score(match.home.goals)} : ${score(match.away.goals)}</div>
    <article class="public-team">
      <div>
        <div class="public-team-code">${escapeHtml(match.away.code)}</div>
        <h2>${escapeHtml(match.away.name)}</h2>
      </div>
    </article>
  `;

  const event = latestEvent(match);
  $("eventMinute").textContent = event.minute || "Live";
  $("eventText").textContent = event.text || "Realtime fixture loaded.";
  $("minuteBox").textContent = match.status === "live" ? `${match.elapsed || 0}'` : match.status === "done" ? "FT" : "KO";

  renderFixtures(match);
  renderVenue();
  renderSponsors();
  renderTicker(match);
  renderClock();
}

function renderNoData() {
  $("matchState").textContent = state.error ? "FEED ERROR" : "NO REALTIME DATA";
  $("matchState").className = `state-badge ${state.error ? "error" : "warn"}`;
  $("matchMeta").textContent = "Connect /api/live-scores to a real provider. No mock match data is available.";
  $("publicScore").innerHTML = `<div class="empty-state" style="grid-column:1/-1">Waiting for realtime match data. This screen will not show fake fixtures.</div>`;
  $("eventMinute").textContent = "Live-only";
  $("eventText").textContent = state.error || "No realtime match records received yet.";
  $("minuteBox").textContent = "--";
  $("fixtureCount").textContent = "0";
  $("fixtureStack").innerHTML = `<div class="empty-state">No realtime fixtures available.</div>`;
}

function renderFixtures(featured) {
  const rows = state.matches.filter(match => match.id !== featured.id).slice(0, 4);
  $("fixtureCount").textContent = rows.length;

  $("fixtureStack").innerHTML = rows.length ? rows.map(match => `
    <article class="fixture">
      <div class="fixture-meta-line"><span>${escapeHtml(match.group || "Fixture")}</span><span>${formatShort(match.kickoff)}</span></div>
      <div class="fixture-score-line">
        <span>${escapeHtml(match.home.code)} ${score(match.home.goals)}</span>
        <strong>v</strong>
        <span>${score(match.away.goals)} ${escapeHtml(match.away.code)}</span>
      </div>
    </article>
  `).join("") : `<div class="empty-state">No additional realtime fixtures.</div>`;
}

function renderVenue() {
  const venue = state.venue;
  $("venueTitle").textContent = venue?.label || "Venue signal";
  $("venueDetail").textContent = venue?.detail || "No operator venue data.";
  const capacity = Math.max(0, Math.min(100, Number(venue?.capacity || 0)));
  $("capacityFill").style.width = `${capacity}%`;
  $("capacityFill").classList.toggle("hot", capacity >= 85);
  $("checkinsLabel").textContent = `${Number(state.tracking?.checkins || 0)} check-ins`;
  $("engagementLabel").textContent = `${Number(state.tracking?.interactions || 0)} interactions`;
}

function renderSponsors() {
  $("sponsorRow").innerHTML = (state.sponsors || []).slice(0, 3).map(sponsor => `
    <div class="sponsor">${escapeHtml(sponsor)}</div>
  `).join("") || `<div class="sponsor">Sponsor slot</div><div class="sponsor">Sponsor slot</div><div class="sponsor">Sponsor slot</div>`;
}

function renderTicker(featured) {
  const parts = [];

  if (featured) {
    parts.push(`REALTIME · FEATURED ${featured.home.code} v ${featured.away.code} · ${statusText(featured)}`);
    parts.push(...state.matches.map(match => `${match.status === "live" ? "● LIVE" : match.status === "done" ? "FT" : "KO"} ${match.home.code} ${score(match.home.goals)}-${score(match.away.goals)} ${match.away.code} · ${match.venue}`));
  } else {
    parts.push(state.error ? `REALTIME FEED ERROR · ${state.error}` : "WAITING FOR REALTIME MATCH DATA · NO MOCK FIXTURES");
  }

  if (state.venue) parts.push(`${state.venue.label} ${state.venue.capacity || 0}% capacity`);
  if (state.notice) parts.push(state.notice);

  const text = parts.join("     ✦     ");
  if (text === lastTickerText) return;
  lastTickerText = text;

  $("tickerA").textContent = text + "     ✦     ";
  $("tickerB").textContent = text + "     ✦     ";
  requestAnimationFrame(updateTickerSpeed);
}

function updateTickerSpeed() {
  const width = $("tickerA").scrollWidth || 1800;
  const duration = Math.max(26, Math.round(width / TICKER_PX_PER_SECOND));
  document.documentElement.style.setProperty("--ticker-duration", `${duration}s`);
  $("tickerTrack").style.animation = "none";
  $("tickerTrack").offsetHeight;
  $("tickerTrack").style.animation = "";
}

function featuredMatch() {
  if (!state.matches.length) return null;
  return state.matches.find(match => match.id === state.mainMatchId) || state.matches.find(match => match.status === "live") || state.matches[0];
}

function latestEvent(match) {
  return match.events?.[match.events.length - 1] || { minute: "Live", text: "Realtime fixture loaded." };
}

function statusText(match) {
  if (match.status === "live") return `LIVE ${match.elapsed || 0}'`;
  if (match.status === "done") return "FULL TIME";
  return "UPCOMING";
}

function renderClock() {
  const now = new Date();
  $("clockTime").textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  $("clockDate").textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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
  return value === null || value === undefined || value === "" ? "–" : value;
}

function formatShort(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso || "";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

window.addEventListener("storage", event => {
  if (event.key === PUBLIC_KEY) loadState();
});

loadState();
setInterval(loadState, REFRESH_MS);
setInterval(renderClock, 1000);

async function fetchDirectEspn() {
  const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Direct ESPN API returned ${response.status}`);
  const payload = await response.json();
  const events = Array.isArray(payload.events) ? payload.events : [];
  const matches = events.map(mapEspnEventToMatch).filter(Boolean);
  return {
    source: "espn-direct",
    fetchedAt: new Date().toISOString(),
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
    events: mapEspnDetails(competition.details || [], home, away, status, elapsed)
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
    text: "Fixture loaded from direct ESPN FIFA World Cup scoreboard."
  }];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
