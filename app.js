/*
  Live-Only Realtime Tracking OS
  Cockpit engine.
  No mock match data. Matches only come from /api/live-scores.
*/

const TRACK_KEY = "wc_live_only_tracking_state";
const PUBLIC_KEY = "wc_live_only_public_state";
const DEFAULT_API_URL = "/api/live-scores";
const REFRESH_MS = 30000;
const CHAT_LIMIT = 80;
const CHAT_RENDER_LIMIT = 60;
const SIMULATION_INTERVAL_MS = 4500;

const EMPTY_LIVE_STATE = {
  source: "not-connected",
  fetchedAt: null,
  error: null,
  ticker: [],
  matches: []
};

const EMPTY_TRACKING = {
  eventName: "",
  notice: "",
  sponsors: [],
  apiUrl: DEFAULT_API_URL,
  selectedMatchId: null,
  mainMatchId: null,
  checkins: 0,
  interactions: 0,
  venues: [],
  incidents: [],
  chatMessages: [],
  sentiment: { home: 50, away: 50 },
  simulationRunning: false
};

let liveState = { ...EMPTY_LIVE_STATE };
let tracking = loadTracking();
let simulationTimer = null;

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
    if (raw) return normaliseTrackingState(JSON.parse(raw));
  } catch {}
  return normaliseTrackingState();
}

function normaliseTrackingState(value = {}) {
  const base = structuredCloneSafe(EMPTY_TRACKING);
  const next = { ...base, ...value };

  next.sponsors = Array.isArray(next.sponsors) ? next.sponsors : [];
  next.venues = Array.isArray(next.venues) ? next.venues : [];
  next.incidents = Array.isArray(next.incidents) ? next.incidents : [];
  next.chatMessages = Array.isArray(next.chatMessages) ? next.chatMessages.slice(-CHAT_LIMIT) : [];
  next.sentiment = {
    home: clamp(next.sentiment?.home ?? base.sentiment.home, 0, 100),
    away: clamp(next.sentiment?.away ?? base.sentiment.away, 0, 100)
  };
  next.simulationRunning = Boolean(next.simulationRunning);

  return next;
}

function saveTracking() {
  localStorage.setItem(TRACK_KEY, JSON.stringify(tracking));
  publishPublicState();
  render();
  syncSimulationTimer();
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
    apiUrl: tracking.apiUrl || DEFAULT_API_URL,
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
    ticker: liveState.ticker,
    matches: liveState.matches
  };

  localStorage.setItem(PUBLIC_KEY, JSON.stringify(publicState));
}

async function fetchRealtime() {
  const apiUrl = tracking.apiUrl || DEFAULT_API_URL;
  setConnection("checking", "Connecting to realtime feed…", `Calling ${apiUrl}`, "Checking");

  try {
    const response = await fetch(apiUrl, { cache: "no-store", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Live API returned ${response.status}`);
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
      ticker: Array.isArray(payload.ticker) ? payload.ticker : [],
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
  renderLiveTicker();
  renderSettings();
  renderKpis();
  renderMatchList();
  renderSelectedMatch();
  renderZones();
  renderPulse();
  renderIncidents();
  renderAnalytics();
  renderChat();
  renderSentiment();
}

function renderLiveTicker() {
  const items = liveState.ticker?.length
    ? liveState.ticker
    : liveState.error
      ? [`LIVE DATA ERROR · ${liveState.error}`]
      : ["WAITING FOR LIVE TICKER DATA · NO MOCK FIXTURES"];

  $("liveTickerList").innerHTML = items.slice(0, 8).map(item => `
    <span>${escapeHtml(item)}</span>
  `).join("");
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
  $("apiUrlInput").value = tracking.apiUrl || DEFAULT_API_URL;
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

function renderChat() {
  const messages = tracking.chatMessages || [];

  if (!messages.length) {
    $("chatList").innerHTML = `<div class="empty-state">No fan pulse messages yet.</div>`;
    return;
  }

  $("chatList").innerHTML = messages.slice(-CHAT_RENDER_LIMIT).map(item => {
    const role = item.role === "operator" ? "operator" : item.role === "system" ? "system" : "";
    const senderClass = item.team === "home" ? "home-fan" : item.team === "away" ? "away-fan" : "";
    const badge = item.role === "operator" ? "OP" : item.team === "home" ? "HOME" : item.team === "away" ? "AWAY" : "SYS";
    const badgeClass = item.role === "operator" ? "op-badge" : item.team === "home" || item.team === "away" ? "team-badge" : "";

    return `
      <article class="chat-msg ${role}">
        <div class="chat-header">
          <span class="chat-sender ${senderClass}">${escapeHtml(item.sender || "Pulse")}</span>
          <span class="chat-badge ${badgeClass}">${escapeHtml(badge)}</span>
          <time class="chat-time">${formatTime(item.time)}</time>
        </div>
        <p class="chat-text">${escapeHtml(item.text)}</p>
      </article>
    `;
  }).join("");

  $("chatList").scrollTop = $("chatList").scrollHeight;
}

function renderSentiment() {
  const match = selectedMatch();
  const homeCode = match?.home?.code || "HOME";
  const awayCode = match?.away?.code || "AWAY";
  const home = clamp(tracking.sentiment?.home ?? 50, 0, 100);
  const away = clamp(tracking.sentiment?.away ?? 50, 0, 100);

  $("sentimentHomeLabel").textContent = `${homeCode} pulse`;
  $("sentimentAwayLabel").textContent = `${awayCode} pulse`;
  $("sentimentHomePct").textContent = `${home}%`;
  $("sentimentAwayPct").textContent = `${away}%`;
  $("sentimentHomeFill").style.width = `${home}%`;
  $("sentimentAwayFill").style.width = `${away}%`;
  $("toggleSimulationBtn").textContent = tracking.simulationRunning ? "Stop simulation" : "Start simulation";
}

function sendOfficialMessage() {
  const input = $("chatMessageInput");
  const text = input.value.trim();
  if (!text) return;

  addChatMessage({
    role: "operator",
    team: "operator",
    sender: "Operator",
    text
  });

  input.value = "";
}

function addChatMessage(message, options = {}) {
  tracking.chatMessages.push({
    id: "m" + Date.now() + Math.random().toString(36).slice(2, 6),
    time: new Date().toISOString(),
    role: message.role || "system",
    team: message.team || "system",
    sender: message.sender || "Pulse",
    text: message.text || "Update logged."
  });

  tracking.chatMessages = tracking.chatMessages.slice(-CHAT_LIMIT);
  if (options.countInteraction !== false) tracking.interactions += 1;
  saveTracking();
}

function clearChat() {
  tracking.chatMessages = [];
  tracking.interactions += 1;
  saveTracking();
}

function toggleSimulation() {
  tracking.simulationRunning = !tracking.simulationRunning;
  tracking.interactions += 1;
  addChatMessage({
    role: "system",
    team: "system",
    sender: "Fan Pulse",
    text: tracking.simulationRunning ? "Fan pulse simulation started." : "Fan pulse simulation stopped."
  }, { countInteraction: false });
  syncSimulationTimer();
}

function syncSimulationTimer() {
  if (tracking.simulationRunning && !simulationTimer) {
    simulationTimer = setInterval(simulateFanPulse, SIMULATION_INTERVAL_MS);
  } else if (!tracking.simulationRunning && simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }
}

function simulateFanPulse() {
  const match = selectedMatch();
  if (!match) return;

  const templates = [
    { team: "home", delta: 6, sender: `${match.home.code} fans`, text: `${match.home.name} support is surging.` },
    { team: "away", delta: -6, sender: `${match.away.code} fans`, text: `${match.away.name} chants are picking up.` },
    { team: "home", delta: 3, sender: "Crowd monitor", text: `${match.home.code} section volume increased.` },
    { team: "away", delta: -3, sender: "Crowd monitor", text: `${match.away.code} section volume increased.` },
    { team: "system", delta: Math.random() > 0.5 ? 2 : -2, sender: "Fan Pulse", text: "Neutral crowd reaction spike logged." }
  ];

  const item = templates[Math.floor(Math.random() * templates.length)];
  shiftSentiment(item.delta, false);
  addChatMessage({
    role: "system",
    team: item.team,
    sender: item.sender,
    text: item.text
  }, { countInteraction: false });
}

function triggerPulse(type) {
  const match = selectedMatch();
  if (!match) {
    addChatMessage({
      role: "system",
      team: "system",
      sender: "Fan Pulse",
      text: "Connect a live match before logging fan triggers."
    });
    return;
  }

  if (type === "home") {
    shiftSentiment(10);
    addChatMessage({ role: "system", team: "home", sender: `${match.home.code} pulse`, text: `${match.home.name} cheer spike logged.` });
  } else if (type === "away") {
    shiftSentiment(-10);
    addChatMessage({ role: "system", team: "away", sender: `${match.away.code} pulse`, text: `${match.away.name} cheer spike logged.` });
  } else if (type === "ref") {
    shiftSentiment(Math.random() > 0.5 ? 4 : -4);
    addChatMessage({ role: "system", team: "system", sender: "Crowd monitor", text: "Referee complaint spike logged." });
  } else {
    shiftSentiment(Math.random() > 0.5 ? 5 : -5);
    addChatMessage({ role: "system", team: "system", sender: "Crowd monitor", text: "Chant wave logged across the venue." });
  }
}

function shiftSentiment(deltaHome, shouldRender = true) {
  const home = clamp(Number(tracking.sentiment?.home ?? 50) + Number(deltaHome || 0), 5, 95);
  tracking.sentiment = {
    home,
    away: 100 - home
  };

  if (shouldRender) renderSentiment();
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
  tracking = normaliseTrackingState();
  selectedMatchId = null;
  syncSimulationTimer();
  render();
}

function saveSettings() {
  const oldUrl = tracking.apiUrl;
  tracking.eventName = $("eventNameInput").value.trim();
  tracking.notice = $("noticeInput").value.trim();
  tracking.sponsors = $("sponsorsInput").value.split(",").map(item => item.trim()).filter(Boolean).slice(0, 3);
  tracking.apiUrl = $("apiUrlInput").value.trim() || DEFAULT_API_URL;
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

function on(id, event, handler) {
  $(id).addEventListener(event, handler);
}

on("matchSearch", "input", renderMatchList);
on("statusFilter", "change", renderMatchList);
on("refreshBtn", "click", fetchRealtime);
on("exportBtn", "click", exportJson);
on("downloadCsvBtn", "click", downloadCsv);
on("clearBtn", "click", clearTracking);
on("addZoneBtn", "click", addZone);
on("addIncidentBtn", "click", addIncident);
on("saveSettingsBtn", "click", saveSettings);
on("clearChatBtn", "click", clearChat);
on("sendChatBtn", "click", sendOfficialMessage);
on("chatMessageInput", "keydown", event => {
  if (event.key === "Enter") sendOfficialMessage();
});
on("toggleSimulationBtn", "click", toggleSimulation);
on("simGoalHomeBtn", "click", () => triggerPulse("home"));
on("simGoalAwayBtn", "click", () => triggerPulse("away"));
on("simRefBtn", "click", () => triggerPulse("ref"));
on("simChantBtn", "click", () => triggerPulse("chant"));
on("setFeaturedBtn", "click", () => {
  const match = selectedMatch();
  if (!match) return;
  tracking.mainMatchId = match.id;
  tracking.interactions += 1;
  saveTracking();
});

publishPublicState();
render();
syncSimulationTimer();
fetchRealtime();
setInterval(fetchRealtime, REFRESH_MS);
