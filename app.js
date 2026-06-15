/*
  Live-Only Realtime Tracking OS
  Cockpit engine.
  No mock match data. Matches only come from /api/live-scores.
*/

const TRACK_KEY = "wc_live_only_tracking_state";
const PUBLIC_KEY = "wc_live_only_public_state";

const EMPTY_LIVE_STATE = {
  source: "not-connected",
  fetchedAt: null,
  error: null,
  matches: []
};

const EMPTY_TRACKING = {
  eventName: "",
  notice: "",
  sponsors: [],
  apiUrl: "/api/live-scores",
  selectedMatchId: null,
  mainMatchId: null,
  checkins: 0,
  interactions: 0,
  venues: [],
  incidents: []
};

let liveState = { ...EMPTY_LIVE_STATE };
let tracking = loadTracking();

// Allow query parameter override
const urlParams = new URLSearchParams(window.location.search);
const queryApi = urlParams.get("api");
if (queryApi) {
  tracking.apiUrl = queryApi;
}

let selectedMatchId = tracking.selectedMatchId;

const $ = id => document.getElementById(id);

function loadTracking() {
  try {
    const raw = localStorage.getItem(TRACK_KEY);
    if (raw) return { ...structuredCloneSafe(EMPTY_TRACKING), ...JSON.parse(raw) };
  } catch {}
  return structuredCloneSafe(EMPTY_TRACKING);
}

function saveTracking() {
  localStorage.setItem(TRACK_KEY, JSON.stringify(tracking));
  publishPublicState();
  render();
}

function publishPublicState() {
  const match = featuredMatch();
  const avgCapacity = average(tracking.venues.map(zone => zone.capacity));
  const busiest = [...tracking.venues].sort((a, b) => Number(b.capacity || 0) - Number(a.capacity || 0))[0];

  const publicState = {
    source: liveState.source,
    fetchedAt: liveState.fetchedAt,
    error: liveState.error,
    eventName: tracking.eventName,
    notice: tracking.notice,
    sponsors: tracking.sponsors,
    apiUrl: tracking.apiUrl || "/api/live-scores",
    mainMatchId: tracking.mainMatchId,
    selectedMatchId: selectedMatchId,
    venue: busiest ? {
      label: busiest.name,
      detail: `${busiest.status || "Open"} · avg capacity ${avgCapacity}% · ${openIncidents().length} open incident(s)`,
      capacity: avgCapacity
    } : null,
    tracking: {
      checkins: tracking.checkins,
      interactions: tracking.interactions
    },
    matches: liveState.matches
  };

  localStorage.setItem(PUBLIC_KEY, JSON.stringify(publicState));
}

async function fetchRealtime() {
  const apiUrl = tracking.apiUrl || "/api/live-scores";
  setConnection("checking", "Connecting to realtime feed…", `Calling ${apiUrl}`, "Checking");

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
        throw new Error(errPayload.error || `Live API returned ${response.status}`);
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

    if (!payload || !Array.isArray(payload.matches)) {
      throw new Error("Live API response missing matches array");
    }

    liveState = {
      source: payload.source || "live-api",
      fetchedAt: payload.fetchedAt || new Date().toISOString(),
      error: payload.error || null,
      eventName: payload.eventName || "",
      notice: payload.notice || "",
      sponsors: Array.isArray(payload.sponsors) ? payload.sponsors : [],
      venue: payload.venue || null,
      matches: payload.matches.map(normaliseMatch).filter(Boolean)
    };

    if (!liveState.matches.length) {
      setConnection("warn", "Realtime feed connected, but no matches returned", "This is not mock data. The API returned an empty match list.", "No matches");
    } else {
      selectedMatchId = selectedMatchId && liveState.matches.some(m => m.id === selectedMatchId) ? selectedMatchId : liveState.matches[0].id;
      tracking.selectedMatchId = selectedMatchId;
      setConnection("ok", "Realtime feed connected", `${liveState.matches.length} live API match record(s) received.`, liveState.source);
    }

    if (!tracking.eventName && liveState.eventName) tracking.eventName = liveState.eventName;
    if (!tracking.notice && liveState.notice) tracking.notice = liveState.notice;
    if (!tracking.sponsors.length && liveState.sponsors?.length) tracking.sponsors = liveState.sponsors.slice(0, 3);
    if (!tracking.venues.length && liveState.venue) {
      tracking.venues = [{
        id: "z-live",
        name: liveState.venue.label || "Live Venue",
        status: "Open",
        capacity: Number(liveState.venue.capacity || 0),
        detail: liveState.venue.detail || "Live venue status"
      }];
    }

    saveTracking();
  } catch (error) {
    liveState = {
      ...EMPTY_LIVE_STATE,
      source: "not-connected",
      error: error.message
    };
    setConnection("error", "Realtime feed not connected", error.message, "Error");
    publishPublicState();
    render();
  }
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
      goals: goal(match.home.goals)
    },
    away: {
      name: match.away.name || "Away",
      code: code(match.away.code || match.away.name),
      goals: goal(match.away.goals)
    },
    events: Array.isArray(match.events) ? match.events.map(event => ({
      minute: event.minute || event.time || "INFO",
      text: event.text || event.detail || event.description || "Live update."
    })) : []
  };
}

function normaliseStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["live", "1h", "2h", "ht", "et", "in_play"].includes(value)) return "live";
  if (["done", "finished", "ft", "aet", "pen"].includes(value)) return "done";
  return "upcoming";
}

function render() {
  renderConnectionCard();
  renderSettings();
  renderKpis();
  renderMatchList();
  renderSelectedMatch();
  renderZones();
  renderPulse();
  renderIncidents();
  renderAnalytics();
}

function setConnection(type, title, detail, pill) {
  $("connectionTitle").textContent = title;
  $("connectionDetail").textContent = detail;
  $("sourcePill").textContent = pill;
  $("sourcePill").className = `status-pill ${type === "error" ? "error" : type === "warn" ? "warn" : ""}`;
}

function renderConnectionCard() {
  if (liveState.error) {
    setConnection("error", "Realtime feed not connected", liveState.error, "Error");
    return;
  }

  if (!liveState.matches.length) {
    setConnection("warn", "Realtime feed required", "No realtime match data currently available.", "No matches");
    return;
  }

  setConnection("ok", "Realtime feed connected", `${liveState.matches.length} match record(s) loaded. Last update: ${formatTime(liveState.fetchedAt)}`, liveState.source || "Live");
}

function renderSettings() {
  $("eventNameInput").value = tracking.eventName || "";
  $("noticeInput").value = tracking.notice || "";
  $("sponsorsInput").value = (tracking.sponsors || []).join(", ");
  $("apiUrlInput").value = tracking.apiUrl || "/api/live-scores";
}

function renderKpis() {
  const matches = liveState.matches || [];
  const live = matches.filter(match => match.status === "live").length;
  const goals = matches.reduce((sum, match) => sum + Number(match.home.goals || 0) + Number(match.away.goals || 0), 0);
  const avgCapacity = average(tracking.venues.map(zone => zone.capacity));
  const incidents = openIncidents().length;
  const featured = matches.find(match => match.id === tracking.mainMatchId);

  const items = [
    [matches.length, "Realtime matches"],
    [live, "Live now"],
    [goals, "API goals"],
    [tracking.checkins, "Check-ins"],
    [`${avgCapacity}%`, "Avg venue capacity"],
    [featured ? `${featured.home.code} v ${featured.away.code}` : "None", "Public match"]
  ];

  $("kpiGrid").innerHTML = items.map(([value, label]) => `<article class="kpi"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></article>`).join("");
  $("matchCountPill").textContent = `${matches.length} matches`;
  $("matchCountPill").className = `pill ${matches.length ? "" : "warn"}`;
}

function renderMatchList() {
  const query = $("matchSearch").value.trim().toLowerCase();
  const filter = $("statusFilter").value;

  const rows = liveState.matches.filter(match => {
    const text = [match.home.name, match.away.name, match.home.code, match.away.code, match.venue, match.city, match.group, match.round].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (filter === "all" || match.status === filter);
  });

  if (!rows.length) {
    $("matchList").innerHTML = `<div class="empty-state">No realtime match records are available. Configure <code>/api/live-scores</code> with a real data provider. No mock fixtures are shown.</div>`;
    return;
  }

  $("matchList").innerHTML = rows.map(match => `
    <article class="match-card ${match.id === selectedMatchId ? "active" : ""}" data-match="${escapeHtml(match.id)}">
      <div class="match-top"><span>${statusText(match)}</span><span>${formatShort(match.kickoff)}</span></div>
      <div class="score-line">
        <span>${escapeHtml(match.home.code)} ${score(match.home.goals)}</span>
        <strong>v</strong>
        <span>${score(match.away.goals)} ${escapeHtml(match.away.code)}</span>
      </div>
      <div class="match-top" style="margin-top:8px"><span>${escapeHtml(match.round)}</span><span>${escapeHtml(match.venue)}</span></div>
    </article>
  `).join("");

  document.querySelectorAll("[data-match]").forEach(card => {
    card.addEventListener("click", () => {
      selectedMatchId = card.dataset.match;
      tracking.selectedMatchId = selectedMatchId;
      saveTracking();
    });
  });
}

function selectedMatch() {
  return liveState.matches.find(match => match.id === selectedMatchId) || liveState.matches[0] || null;
}

function featuredMatch() {
  return liveState.matches.find(match => match.id === tracking.mainMatchId) || selectedMatch() || null;
}

function renderSelectedMatch() {
  const match = selectedMatch();

  if (!match) {
    $("selectedTitle").textContent = "No realtime match selected";
    $("selectedMeta").textContent = "Connect the live feed to select a real match.";
    $("readonlyScore").innerHTML = `<div class="empty-state">Live-only mode is active. Scores cannot be edited manually.</div>`;
    $("timeline").innerHTML = "";
    $("setFeaturedBtn").disabled = true;
    return;
  }

  $("setFeaturedBtn").disabled = false;
  $("selectedTitle").textContent = `${match.home.name} v ${match.away.name}`;
  $("selectedMeta").textContent = `${match.round} · ${match.venue} · ${match.city || "Live feed"} · ${formatShort(match.kickoff)}`;

  $("readonlyScore").innerHTML = `
    <article class="team-read">
      <div class="team-code">${escapeHtml(match.home.code)}</div>
      <h3>${escapeHtml(match.home.name)}</h3>
      <div class="goal">${score(match.home.goals)}</div>
    </article>
    <div class="vs">v</div>
    <article class="team-read">
      <div class="team-code">${escapeHtml(match.away.code)}</div>
      <h3>${escapeHtml(match.away.name)}</h3>
      <div class="goal">${score(match.away.goals)}</div>
    </article>
  `;

  $("timeline").innerHTML = (match.events || []).slice().reverse().map(event => `
    <article class="event">
      <time>${escapeHtml(event.minute)}</time>
      <div><p>${escapeHtml(event.text)}</p><small>${escapeHtml(match.home.code)} v ${escapeHtml(match.away.code)}</small></div>
      <span class="pill">API</span>
    </article>
  `).join("") || `<div class="empty-state">No event timeline returned by the realtime feed.</div>`;
}

function renderZones() {
  if (!tracking.venues.length) {
    $("zoneGrid").innerHTML = `<div class="empty-state">No venue zones yet. Add a real zone when operating an event.</div>`;
    return;
  }

  $("zoneGrid").innerHTML = tracking.venues.map(zone => `
    <article class="zone">
      <div class="zone-head">
        <div>
          <h3>${escapeHtml(zone.name)}</h3>
          <small>${escapeHtml(zone.status || "Open")} · ${escapeHtml(zone.detail || "")}</small>
        </div>
        <strong>${Number(zone.capacity || 0)}%</strong>
      </div>
      <div class="capacity-meter"><span class="${zone.capacity >= 85 ? "hot" : ""}" style="width:${clamp(zone.capacity, 0, 100)}%"></span></div>
      <div class="zone-actions">
        <button class="btn" data-zone-cap="${zone.id}:-10">−10%</button>
        <button class="btn" data-zone-cap="${zone.id}:10">+10%</button>
        <button class="btn" data-zone-status="${zone.id}">Toggle status</button>
        <button class="btn danger" data-zone-delete="${zone.id}">Delete</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll("[data-zone-cap]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [id, delta] = btn.dataset.zoneCap.split(":");
      const zone = tracking.venues.find(item => item.id === id);
      zone.capacity = clamp(Number(zone.capacity || 0) + Number(delta), 0, 100);
      tracking.interactions += 1;
      saveTracking();
    });
  });

  document.querySelectorAll("[data-zone-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      const zone = tracking.venues.find(item => item.id === btn.dataset.zoneStatus);
      const statuses = ["Open", "Busy", "Full", "Paused"];
      zone.status = statuses[(statuses.indexOf(zone.status) + 1) % statuses.length] || "Open";
      tracking.interactions += 1;
      saveTracking();
    });
  });

  document.querySelectorAll("[data-zone-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      tracking.venues = tracking.venues.filter(zone => zone.id !== btn.dataset.zoneDelete);
      saveTracking();
    });
  });
}

function renderPulse() {
  const rows = [
    ["checkins", "Check-ins"],
    ["interactions", "Operator interactions"]
  ];

  $("pulseGrid").innerHTML = rows.map(([key, label]) => `
    <article class="pulse-card">
      <b>${Number(tracking[key] || 0)}</b>
      <span>${escapeHtml(label)}</span>
      <div class="pulse-actions">
        <button class="btn" data-counter="${key}:-1">−</button>
        <button class="btn primary" data-counter="${key}:1">+</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll("[data-counter]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [key, delta] = btn.dataset.counter.split(":");
      tracking[key] = Math.max(0, Number(tracking[key] || 0) + Number(delta));
      if (key !== "interactions") tracking.interactions += 1;
      saveTracking();
    });
  });
}

function renderIncidents() {
  if (!tracking.incidents.length) {
    $("incidentList").innerHTML = `<div class="empty-state">No incidents logged.</div>`;
    return;
  }

  $("incidentList").innerHTML = [...tracking.incidents].sort((a, b) => new Date(b.time) - new Date(a.time)).map(item => `
    <article class="incident severity-${escapeHtml(item.severity)}">
      <div>
        <strong>${escapeHtml(item.severity.toUpperCase())}</strong><br>
        <small>${formatTime(item.time)}</small>
      </div>
      <div>
        <p>${escapeHtml(item.note)}</p>
        <small>${escapeHtml(item.zone)} · ${item.resolved ? "Resolved" : "Open"}</small>
      </div>
      <button class="btn ${item.resolved ? "" : "primary"}" data-resolve="${escapeHtml(item.id)}">${item.resolved ? "Reopen" : "Resolve"}</button>
    </article>
  `).join("");

  document.querySelectorAll("[data-resolve]").forEach(btn => {
    btn.addEventListener("click", () => {
      const incident = tracking.incidents.find(item => item.id === btn.dataset.resolve);
      incident.resolved = !incident.resolved;
      tracking.interactions += 1;
      saveTracking();
    });
  });
}

function renderAnalytics() {
  const avgCapacity = average(tracking.venues.map(zone => zone.capacity));
  const metrics = [
    ["Realtime match records", liveState.matches.length, Math.min(100, liveState.matches.length * 10)],
    ["Open incidents", openIncidents().length, Math.min(100, openIncidents().length * 20)],
    ["Avg venue capacity", `${avgCapacity}%`, avgCapacity],
    ["Check-ins", tracking.checkins, Math.min(100, tracking.checkins)]
  ];

  $("analytics").innerHTML = metrics.map(([label, value, pct]) => `
    <article class="metric-card">
      <b>${escapeHtml(value)}</b>
      <span>${escapeHtml(label)}</span>
      <div class="bar" style="margin-top:10px"><span class="${pct >= 85 ? "hot" : ""}" style="width:${pct}%"></span></div>
    </article>
  `).join("");
}

function addZone() {
  const name = prompt("Zone name:");
  if (!name) return;

  tracking.venues.push({
    id: "z" + Date.now(),
    name,
    status: "Open",
    capacity: 0,
    detail: "Real event zone"
  });

  saveTracking();
}

function addIncident() {
  const severity = $("incidentSeverity").value;
  const zone = $("incidentZone").value.trim() || "General";
  const note = $("incidentNote").value.trim();
  if (!note) return;

  tracking.incidents.push({
    id: "i" + Date.now(),
    time: new Date().toISOString(),
    severity,
    zone,
    note,
    resolved: false
  });

  $("incidentNote").value = "";
  tracking.interactions += 1;
  saveTracking();
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    liveState,
    tracking
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "live-only-tracking-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv() {
  const rows = [
    ["metric", "value"],
    ["source", liveState.source],
    ["matches", liveState.matches.length],
    ["checkins", tracking.checkins],
    ["interactions", tracking.interactions],
    ["openIncidents", openIncidents().length],
    ["averageCapacity", average(tracking.venues.map(zone => zone.capacity))]
  ];

  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "live-only-tracking-metrics.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function clearTracking() {
  localStorage.removeItem(TRACK_KEY);
  localStorage.removeItem(PUBLIC_KEY);
  tracking = structuredCloneSafe(EMPTY_TRACKING);
  selectedMatchId = null;
  render();
}

function saveSettings() {
  const oldUrl = tracking.apiUrl;
  tracking.eventName = $("eventNameInput").value.trim();
  tracking.notice = $("noticeInput").value.trim();
  tracking.sponsors = $("sponsorsInput").value.split(",").map(item => item.trim()).filter(Boolean).slice(0, 3);
  tracking.apiUrl = $("apiUrlInput").value.trim() || "/api/live-scores";
  tracking.interactions += 1;
  saveTracking();
  if (oldUrl !== tracking.apiUrl) {
    fetchRealtime();
  }
}

function openIncidents() {
  return tracking.incidents.filter(item => !item.resolved);
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
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

function statusText(match) {
  if (match.status === "live") return `LIVE ${match.elapsed || 0}'`;
  if (match.status === "done") return "FT";
  return "KO";
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function formatShort(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso || "";
  }
}

function formatTime(iso) {
  if (!iso) return "Never";
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
  } catch {
    return iso || "";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

$("matchSearch").addEventListener("input", renderMatchList);
$("statusFilter").addEventListener("change", renderMatchList);
$("refreshBtn").addEventListener("click", fetchRealtime);
$("exportBtn").addEventListener("click", exportJson);
$("downloadCsvBtn").addEventListener("click", downloadCsv);
$("clearBtn").addEventListener("click", clearTracking);
$("addZoneBtn").addEventListener("click", addZone);
$("addIncidentBtn").addEventListener("click", addIncident);
$("saveSettingsBtn").addEventListener("click", saveSettings);
$("setFeaturedBtn").addEventListener("click", () => {
  const match = selectedMatch();
  if (!match) return;
  tracking.mainMatchId = match.id;
  tracking.interactions += 1;
  saveTracking();
});

publishPublicState();
render();
fetchRealtime();
setInterval(fetchRealtime, 30000);

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
