// Orb page: folders, chat (Claude-app style), voice in/out over one WebSocket.
"use strict";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- token + theme
(function takeToken() {
  const m = location.hash.match(/t=([\w-]+)/);
  if (m) { store.set("vd-token", m[1]); history.replaceState(null, "", location.pathname); }
})();
const TOKEN = store.get("vd-token", "");

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  setTimeout(() => window.__orb?.refreshPalette(), 0);
  $("#hljs-dark").disabled = t === "light";
  $("#hljs-light").disabled = t !== "light";
}
applyTheme(store.get("vd-theme", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
// Skin: "studio" (default), "kos" or "classic". kos.css and studio.css are scoped to their data-skin.
function applySkin(k) {
  document.documentElement.dataset.skin = k;
  window.__orb?.refreshPalette();
}
applySkin(store.get("vd-skin", "studio"));

// ---------------------------------------------------------------- state
const S = {
  ws: null, folders: [], folder: null, busy: false, serverState: "idle",
  muted: store.get("vd-muted", "0") === "1",
  bargeMode: store.get("vd-barge", "auto"), // auto | on | off
  headphones: false, micOn: false, hearing: false, utteranceOk: true,
  answer: null, tools: null, blocks: new Map(), toolRows: new Map(), perms: new Map(), replaying: false,
};

// ---------------------------------------------------------------- socket
let backoff = 500;
function connect() {
  if (!TOKEN) { notice("Open the link the server printed (it carries the access token).", "error"); return; }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(TOKEN)}`);
  S.ws = ws;
  ws.onopen = () => { backoff = 500; S.localLabel = null; refreshState(); send({ type: "mute", value: S.muted }); setSysline(true); };
  ws.onmessage = (m) => onEvent(JSON.parse(m.data));
  ws.onclose = (e) => {
    if (e.code === 4403) { // stale token (a new install or state folder makes a new one) or a foreign page
      setState("offline"); setSysline(false);
      notice("This page's access token is out of date. Open the link Orb printed in the terminal (it ends in #t=…).", "error");
      return;
    }
    setState("offline"); setSysline(false);
    setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 8000);
  };
}
const send = (obj) => {
  if (obj.type === "user_text") S.sentAt = performance.now();
  if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(obj));
};

// ---------------------------------------------------------------- events
function onEvent(ev) {
  if (ev.session && S.session && ev.session !== S.session && !["folders", "rate_limit", "bg_notice", "opened"].includes(ev.type)) return;
  switch (ev.type) {
    case "hello":
      if (ev.build && ev.build !== document.querySelector('meta[name="build"]').content) { location.reload(); return; }
      renderServices(ev.services); S.folders = ev.folders; applyFeatures(ev); renderSidebar(); if (ev.rate_limit) renderUsage(ev.rate_limit);
      if (!ev.onboarded) { Onb.open(0); break; }
      { const last = store.get("vd-folder", ""); if (last && S.folders.some((f) => f.path === last)) openFolder(last, store.get("vd-session", "") || undefined); else if (!S.folder) openPicker("new"); }
      break;
    case "folders": S.folders = ev.items; renderSidebar(); break;
    case "routines": S.routines = ev; renderRoutinesBadge(); if (S.view === "routines") renderRoutines(); break;
    case "settings": renderSettings(ev); break;
    case "setup_status": Onb.update(ev); break;
    case "browse": Onb.dir = ev; if (Onb.isOpen) Onb.render(false); break;
    case "picked": Onb.picking = false; if (ev.path) send({ type: "set_settings", values: { roots: [...(Onb.ev?.roots || []).map((x) => x.path), ev.path] } });
      else if (ev.error) notice(ev.error, "error"); if (Onb.isOpen) Onb.render(false); break;
    case "features": { const was = S.features?.onboarded; applyFeatures(ev); renderSidebar();
      if (!ev.onboarded && !Onb.isOpen) Onb.open(0); else if (ev.onboarded && !was && Onb.isOpen) Onb.finish(); else if (Onb.isOpen) $("#onb-close").hidden = !ev.onboarded; break; }
    case "voice_sample": Player.stop(); Player.reset(Player.gen); Player.enqueue({ ...ev, gen: Player.gen }); break;
    case "opened": onOpened(ev); break;
    case "history":
      clearChat(); S.replaying = true; for (const e of ev.events) onEvent(e); S.replaying = false;
      for (const t of S.openTasks || []) if (t.status === "running") taskChip(t);
      finishAnswer(false); scrollToEnd(true); break;
    case "cleared": clearChat(); break;
    case "session_info": renderMeta(ev); break;
    case "rate_limit": renderUsage(ev); break;
    case "context": S.ctx = ev; renderCtx(); break;
    case "mcp": if (ev.open) $("#mcp-panel").hidden = false; renderMcpPanel(ev.servers); break;
    case "commands": Slash.set(ev.items); break;
    case "user": S.partial = null; S.lastUserId = ev.id; addUser(ev); startClock(ev); break;
    case "undo_available": undoAvailable(ev); break;
    case "undo_confirm": undoCard(ev); break;
    case "undo_done": undoDone(ev); break;
    case "text_start": textBlock(ev.block); break;
    case "text": { const b = textBlock(ev.block); b.text += ev.delta; scheduleRender(b); break; }
    case "said": { const b = textBlock(ev.block); b.said += ev.delta; saidLine(b); break; }
    case "held": heldNote(ev.text); break;
    case "tool_start": toolRow(ev.id, ev.name); break;
    case "tool_input": { const r = toolRow(ev.id, ev.name); r.name = ev.name; r.input = ev.input; r.call.textContent = ev.summary; updateToolSummary(r.group); break; }
    case "tool_result": toolResult(ev); break;
    case "permission": permissionCard(ev); break;
    case "permission_done": permissionDone(ev); break;
    case "result": onResult(ev); break;
    case "timing": renderTiming(ev); break;
    case "task": taskChip(ev); break;
    case "state": S.busy = !!ev.busy; S.serverState = ev.value; refreshState(); break;
    case "audio": if (!S.replaying) Player.enqueue(ev); break;
    case "speech_reset": Player.reset(ev.gen); break;
    case "heard_nothing": flashState("Didn't catch that"); break;
    case "partial": S.partial = ev.text; refreshState(); break;
    case "notice": notice(ev.text, ev.level); break;
    case "bg_notice": Player.notice(ev); flashState(ev.text.replace(/\.$/, "")); break;
    case "error": notice(ev.text, "error"); if (S.serverState === "transcribing") { S.serverState = "idle"; refreshState(); } break;
  }
}

// "● system online · Warsaw 20:32" in the top bar (k.os skin)
const TZ_CITY = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").split("/").pop().replace(/_/g, " ");
function setSysline(on) {
  $("#sysline").classList.toggle("off", !on);
  $("#sys-text").textContent = on ? "system online" : "reconnecting";
}
function tickClock() { $("#sys-clock").textContent = `${TZ_CITY} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`; }
tickClock(); setInterval(tickClock, 15000);

// ---------------------------------------------------------------- folders
function rel(ts) {
  if (!ts) return "";
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "now"; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
// ---- Sidebar: search, New, Brain, Activity, Settings, pinned Repos, Recents (Claude desktop style)
const STATUS_TEXT = { approval: "needs approval", working: "working", done: "done since you looked", idle: "" };
const statusText = (x) => (x.opus && x.status === "working" ? "Opus working" : STATUS_TEXT[x.status]);
const dotClass = (status, live) => "dot" + ({ approval: " approval", working: " busy", done: " done" }[status] || (live ? " live" : " has"));
const folderName = (f) => f.label.split("/").pop();
function allSessions() {
  const out = [];
  // Sessions never used (opened, nothing sent) stay out of the lists, except the one on screen.
  for (const f of S.folders) for (const x of f.sessions || []) if (!x.empty || x.key === S.session) out.push({ ...x, folder: f });
  return out.sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
}
function sessionRow(x, { showFolder } = {}) {
  const b = el("button", "session" + (x.key === S.session ? " active" : "") + (x.status === "done" ? " unseen" : ""));
  b.append(el("span", dotClass(x.status, x.live)), el("span", "slabel", x.label || "New session"));
  if (showFolder) b.append(el("span", "sfolder", folderName(x.folder)));
  else b.append(el("span", "when", rel(x.last_used)));
  b.title = `${x.label || "New session"} · ${x.folder.label}${STATUS_TEXT[x.status] ? " · " + STATUS_TEXT[x.status] : ""}`;
  b.onclick = () => { openFolder(x.folder.path, x.key); closeDrawer(); };
  return b;
}
const expanded = new Set(JSON.parse(store.get("vd-expanded", "[]")));
function renderFolders() { renderSidebar(); }
function renderSidebar() {
  // Repos: only pinned folders, each expandable to its sessions.
  const proj = $("#projects"); proj.replaceChildren();
  const pinned = S.folders.filter((f) => f.pinned).sort((a, b) => folderName(a).localeCompare(folderName(b)));
  if (!pinned.length) proj.append(el("div", "side-hint", "Pin the repos you use with +"));
  for (const f of pinned) {
    const open = expanded.has(f.path);
    const head = el("button", "project" + (f.path === S.folder ? " active" : "") + (f.status === "done" ? " unseen" : ""));
    head.append(el("span", "chev" + (open ? " open" : ""), "›"), el("span", "pname", folderName(f)),
      el("span", dotClass(f.status, f.live) + (f.status === "idle" ? " quiet" : "")));
    head.title = `${f.label} · ${f.rel}${f.mcp_failed ? ` · ${f.mcp_failed} MCP server(s) failed` : ""}`;
    head.dataset.path = f.path;
    head.onclick = () => {
      // Click opens the project (its latest session) and expands it; clicking the open one folds it.
      if (f.path === S.folder && expanded.has(f.path)) expanded.delete(f.path);
      else { expanded.add(f.path); if (f.path !== S.folder) { openFolder(f.path); closeDrawer(); } }
      store.set("vd-expanded", JSON.stringify([...expanded])); renderSidebar();
    };
    proj.append(head);
    if (open) {
      const list = el("div", "sessions");
      for (const x of (f.sessions || []).filter((x) => !x.empty || x.key === S.session).slice(0, 8)) list.append(sessionRow({ ...x, folder: f }));
      const nb = el("button", "session new", "+ New session");
      nb.onclick = () => { Player.stop(); send({ type: "start_session", path: f.path }); closeDrawer(); };
      const unpin = el("button", "session new", "Unpin repo");
      unpin.onclick = () => send({ type: "pin_folder", path: f.path, pinned: false });
      const row = el("div", "proj-actions"); row.append(nb, unpin); list.append(row);
      proj.append(list);
    }
  }
  // Recents: sessions across all folders.
  const rec = $("#recents"); rec.replaceChildren();
  const recent = allSessions().slice(0, 14);
  if (!recent.length) rec.append(el("div", "side-hint", "Your conversations show up here."));
  for (const x of recent) rec.append(sessionRow(x, { showFolder: true }));
  // Activity badge: what needs you or ran in the background.
  const busy = allSessions().filter((x) => x.status !== "idle");
  const waiting = busy.filter((x) => x.status === "approval").length;
  const badge = $("#activity-badge");
  badge.hidden = !busy.length;
  badge.textContent = waiting ? `${waiting} waiting` : String(busy.length);
  badge.className = "nav-badge" + (waiting ? " approval" : busy.some((x) => x.status === "working") ? " busy" : " done");
  $("#nav-brain").classList.toggle("active", S.folder === S.vault && S.view === "chat");
  if (S.view === "activity") renderActivity();
  renderSearch();
}

// Search: session titles (first request), folder and repo names.
function renderSearch() {
  const q = $("#search").value.trim().toLowerCase(), box = $("#search-results");
  if (!q) { box.hidden = true; return; }
  box.hidden = false; box.replaceChildren();
  const sess = allSessions().filter((x) => (x.label || "").toLowerCase().includes(q) || x.folder.label.toLowerCase().includes(q)).slice(0, 8);
  const folders = S.folders.filter((f) => f.label.toLowerCase().includes(q) || f.rel.toLowerCase().includes(q)).slice(0, 8);
  if (sess.length) { box.append(el("div", "res-head", "Sessions")); sess.forEach((x) => box.append(sessionRow(x, { showFolder: true }))); }
  if (folders.length) {
    box.append(el("div", "res-head", "Folders"));
    for (const f of folders) {
      const b = el("button", "session");
      b.append(el("span", dotClass(f.status, f.live)), el("span", "slabel", f.label), el("span", "sfolder", f.rel));
      b.onclick = () => { openFolder(f.path); $("#search").value = ""; renderSearch(); closeDrawer(); };
      box.append(b);
    }
  }
  if (!sess.length && !folders.length) box.append(el("div", "side-hint", "Nothing found."));
}

// Picker: the only other place with every repo. mode "new" starts a session, "pin" pins a repo.
let pickerMode = "new";
function openPicker(mode) {
  pickerMode = mode;
  $("#picker-title").textContent = mode === "pin" ? "Pin a repo" : S.folder ? "New session" : "Pick a repo to talk about";
  $("#picker-search").value = ""; renderPicker(); $("#picker").hidden = false;
  setTimeout(() => $("#picker-search").focus(), 0);
}
function closePicker() { $("#picker").hidden = true; }
function renderPicker() {
  const q = $("#picker-search").value.trim().toLowerCase(), list = $("#picker-list");
  list.replaceChildren();
  const items = S.folders.filter((f) => !q || f.label.toLowerCase().includes(q) || f.rel.toLowerCase().includes(q))
    .sort((a, b) => (b.last_used || 0) - (a.last_used || 0) || a.label.localeCompare(b.label));
  for (const f of items) {
    const b = el("button", "pick");
    b.append(el("span", "pick-name", f.label), el("span", "pick-rel", f.rel + (f.branch ? ` · ${f.branch}` : "")),
      el("span", "pick-when", f.pinned ? "pinned" : rel(f.last_used)));
    b.onclick = () => choose(f.path);
    list.append(b);
  }
  if (!items.length) list.append(el("div", "side-hint", "No repo matches. Paste a folder path below."));
}
function choose(path) {
  closePicker(); closeDrawer();
  if (pickerMode === "pin") { send({ type: "pin_folder", path, pinned: true }); expanded.add(path); store.set("vd-expanded", JSON.stringify([...expanded])); }
  else { Player.stop(); send({ type: "start_session", path }); }
}

// Views in the main area: chat, Activity, Settings.
function showView(v) {
  S.view = v;
  $("#chat").hidden = v !== "chat"; $(".dock").hidden = v !== "chat";
  $("#activity-view").hidden = v !== "activity"; $("#settings-view").hidden = v !== "settings";
  $("#routines-view").hidden = v !== "routines";
  $("#nav-activity").classList.toggle("active", v === "activity");
  $("#nav-routines").classList.toggle("active", v === "routines");
  $("#nav-settings").classList.toggle("active", v === "settings");
  $("#brain-bar").hidden = !(v === "chat" && S.folder && S.folder === S.vault);
  if (v === "activity") renderActivity();
  if (v === "routines") openRoutines();
  if (v === "settings") send({ type: "get_settings" });
  renderSidebar();
}
function renderActivity() {
  const list = $("#activity-list"); list.replaceChildren();
  const rows = allSessions().filter((x) => x.status !== "idle" || x.live).slice(0, 40);
  if (!rows.length) { list.append(el("div", "side-hint", "Nothing running. Sessions that work in the background, wait for an approval or finish while you're elsewhere show up here.")); return; }
  const order = { approval: 0, working: 1, done: 2, idle: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (b.last_used || 0) - (a.last_used || 0));
  for (const x of rows) {
    const r = el("button", "act-row " + x.status);
    r.append(el("span", "act-time mono", x.last_used ? new Date(x.last_used * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "--:--"),
      el("span", dotClass(x.status, x.live)), el("span", "act-folder", folderName(x.folder)),
      el("span", "act-label", x.label || "New session"), el("span", "act-status mono", statusText(x) || "open"));
    r.onclick = () => openFolder(x.folder.path, x.key);
    list.append(r);
  }
}

// Routines: scheduled cloud agents (claude.ai). The server checks every 30 min; a failed, stuck
// or missed one gets a badge and a spoken notice. All text comes from the runs: plain text only.
const ROUTINE_TEXT = { ok: "ok", failed: "failed", waiting: "waiting for you", stuck: "stuck", running: "running" };
const NEEDS_TEXT = { failed: "failed", waiting: "waiting for you", stuck: "looks stuck", missed: "missed its run" };
const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayTime = (ts) => {
  const d = new Date(ts * 1000), today = new Date(), tom = new Date(Date.now() + 86400000);
  const day = d.toDateString() === today.toDateString() ? "today" : d.toDateString() === tom.toDateString() ? "tomorrow"
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day} ${hhmm(ts)}`;
};
function renderRoutinesBadge() {
  const r = S.routines, badge = $("#routines-badge");
  if (!r) return;
  badge.hidden = !r.needs && !r.new;
  badge.textContent = r.needs ? `${r.needs} waiting` : String(r.new);
  badge.className = "nav-badge" + (r.needs ? " approval" : " done");
}
function openRoutines() {
  // "New" dots stay for this visit; the server forgets them right away.
  S.routineNew = new Set((S.routines?.items || []).filter((x) => x.new).map((x) => x.id));
  send({ type: "routines" });
  if (S.routineNew.size) send({ type: "routines_seen" });
  renderRoutines();
}
function renderRoutines() {
  const r = S.routines, list = $("#routines-list"); list.replaceChildren();
  $("#routines-sub").textContent = !r ? "scheduled cloud agents" : r.checking ? "checking…"
    : r.error ? `last check failed: ${r.error}` : r.checked_at ? `checked ${rel(r.checked_at)} ago · every 30 min` : "not checked yet";
  $("#routines-refresh").disabled = !!r?.checking;
  if (!r || !r.items.length) { list.append(el("div", "side-hint", r?.checking ? "Checking your routines…" : "No routines found.")); return; }
  for (const x of r.items) {
    const l = x.last, state = x.needs || (!x.enabled ? "off" : l?.outcome || "none");
    const row = el("div", "rt-row " + state + (S.routineNew?.has(x.id) ? " new" : ""));
    const dot = el("span", "dot" + ({ failed: " approval", waiting: " approval", stuck: " approval", missed: " approval", running: " busy", ok: " done" }[state] || " has"));
    const head = el("div", "rt-head");
    head.append(dot, el("span", "rt-name", x.name),
      el("span", "rt-status mono", x.needs ? NEEDS_TEXT[x.needs] : !x.enabled ? "off" : ROUTINE_TEXT[l?.outcome] || "no runs yet"));
    const meta = el("div", "rt-meta mono");
    meta.textContent = [l?.at ? `last ${dayTime(l.at)}` : null, x.enabled && x.next_run_at ? `next ${dayTime(x.next_run_at)}` : null]
      .filter(Boolean).join(" · ");
    if (l?.url) {
      const a = el("a", "rt-link", "open run ↗"); a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      meta.append(" · ", a);
    }
    row.append(head, meta);
    if (l?.summary) row.append(el("div", "rt-summary", l.summary));
    list.append(row);
  }
}
$("#routines-refresh").onclick = () => send({ type: "routines", refresh: true });

// Settings: options that used to live around the page, plus voice, vocabulary and access.
function renderSettings(ev) {
  const body = $("#settings-body"); body.replaceChildren();
  body.append(el("div", "view-head"), el("div"));
  body.firstChild.append(el("h2", null, "Settings"), el("span", "mono view-sub", "saved on this Mac; browser choices stay in this browser"));
  const section = (title, hint) => { const sct = el("section", "set"); sct.append(el("h3", null, title)); if (hint) sct.append(el("p", "set-hint", hint)); body.append(sct); return sct; };
  const seg = (name, options, value, onPick) => {
    const g = el("div", "seg"); g.setAttribute("role", "radiogroup"); g.setAttribute("aria-label", name);
    for (const [v, label] of options) {
      const b = el("button", "seg-btn" + (v === value ? " on" : ""), label);
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(v === value));
      b.onclick = () => { onPick(v); g.querySelectorAll(".seg-btn").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); }); };
      g.append(b);
    }
    return g;
  };
  // Voice
  const v = section("Voice", "Kokoro voice for spoken answers (English only). \"chatterbox\" speaks Polish and English but takes ~7 s per sentence on this Mac (try-out; its server runs in tmux chatterbox).");
  const sel = el("select", "set-select");
  const voices = (ev.voices || []).filter((x) => /^[ab][fm]_|^chatterbox$/.test(x));
  for (const name of voices.length ? voices : [ev.values.voice]) { const o = el("option", null, name); o.value = name; o.selected = name === ev.values.voice; sel.append(o); }
  sel.onchange = () => send({ type: "set_settings", values: { voice: sel.value } });
  const hear = el("button", "chip-btn", "Hear it"); hear.onclick = () => { Player.unlock(); send({ type: "voice_sample", voice: sel.value }); };
  const vr = el("div", "set-row"); vr.append(sel, hear); v.append(vr);
  // Barge-in
  const bi = section("Talking over her (barge-in)", "Auto stops her when you speak only with headphones; on speakers her own voice could interrupt her, so Esc or ■ stops her.");
  bi.append(seg("Barge-in", [["auto", "Auto (headphones)"], ["on", "Always"], ["off", "Off"]], S.bargeMode, (m) => { S.bargeMode = m; store.set("vd-barge", m); refreshState(); }));
  // Approvals default
  const ap = section("Approvals for new folders", "Default asks for every tool that needs permission; Auto lets Claude Code decide; Plan only reads and plans. Each folder can still be switched in the top bar.");
  ap.append(seg("Approvals", [["default", "Default"], ["auto", "Auto"], ["plan", "Plan"]], ev.values.default_mode, (m) => send({ type: "set_settings", values: { default_mode: m } })));
  // Front model default
  const fm = section("Model for new folders", "Sonnet answers fast and hands hard coding to Opus in the background; Opus answers everything itself. Each folder can still be switched in the top bar, or by saying \"switch to Opus\".");
  fm.append(seg("Model", [["sonnet", "Sonnet + Opus for coding"], ["opus", "Opus"]], ev.values.default_model, (m) => send({ type: "set_settings", values: { default_model: m } })));
  // Speech recognition
  const sr = section("Speech recognition", "Parakeet hears you in about 0.1 s and asks Whisper when a word may be one of your names; Whisper alone takes about 0.5 s. The stt time under each answer shows which one heard you.");
  sr.append(seg("Speech recognition", [["parakeet", "Parakeet (fast)"], ["whisper", "Whisper"]], ev.values.stt, (m) => send({ type: "set_settings", values: { stt: m } })));
  // Vocabulary
  const vc = section("Whisper vocabulary", "Names Whisper should hear correctly. Built in: " + ev.vocab_seed.join(", ") + ", plus your repo names. Add your own, one per line.");
  const ta = el("textarea", "set-text"); ta.rows = 5; ta.value = ev.vocabulary; ta.placeholder = "Kimai\nHetzner\n…";
  const save = el("button", "chip-btn", "Save vocabulary"); save.onclick = () => { send({ type: "set_settings", vocabulary: ta.value }); save.textContent = "Saved"; setTimeout(() => (save.textContent = "Save vocabulary"), 1500); };
  const vrow = el("div", "set-row"); vrow.append(save); vc.append(ta, vrow);
  const det = el("details", "set-details"); det.append(el("summary", null, "Prompt sent to Whisper"), el("pre", null, ev.whisper_prompt)); vc.append(det);
  // Theme
  const th = section("Look", "k.os is the default look; classic is the earlier violet one.");
  th.append(seg("Skin", [["studio", "Studio"], ["kos", "k.os"], ["classic", "Classic"]], document.documentElement.dataset.skin, (k) => { store.set("vd-skin", k); applySkin(k); }));
  th.append(el("div", "set-row"));
  th.lastChild.append(seg("Theme", [["dark", "Dark"], ["light", "Light"]], document.documentElement.dataset.theme, (t) => { store.set("vd-theme", t); applyTheme(t); }));
  // Setup
  const su = section("Setup", "Folders Orb may open, sign-in and speech engines.");
  const again = el("button", "chip-btn", "Open setup"); again.onclick = () => Onb.open(2); su.append(again);
  // Access
  const ac = section("Access", "The page only listens on this Mac. The link carries its access token; keep it private.");
  const link = `http://${ev.host}:${ev.port}/#t=${TOKEN}`;
  const lr = el("div", "set-row"); const code = el("code", "set-code", `http://${ev.host}:${ev.port}/#t=••••••${TOKEN.slice(-4)}`);
  const copy = el("button", "chip-btn", "Copy link"); copy.onclick = () => copyText(link, copy);
  lr.append(code, copy); ac.append(lr);
}
// ---------------------------------------------------------------- features + onboarding
// What this install has turned on (notes vault, Brain, routines) and how it's signed in.
function applyFeatures(f) {
  S.features = f; S.vault = f.vault || null;
  $("#nav-brain").hidden = !f.vault; $("#nav-routines").hidden = !f.routines;
  $("#who-name").textContent = "Claude"; $("#who-plan").textContent = f.plan ? `· ${f.plan[0].toUpperCase()}${f.plan.slice(1)}` : "";
  $("#who-avatar").textContent = "C";
  if (typeof Rec !== "undefined" && S.micOn) { if (browserSTT()) Rec.run(); else Rec.halt(); } // engine switched while listening
}
const BROWSER_STT = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const BROWSER_TTS = "speechSynthesis" in window;
// First run (and Settings → Setup): a full-screen setup assistant around the orb. Five screens:
// welcome, then four steps on the rail (sign in, folders, voice, control). Orb never sees the
// Claude login itself: the user signs in with Claude Code's own command; this only shows the result.
const Onb = {
  step: 0, ev: null, orb: null, mic: null, analyser: null, wave: new Float32Array(1024),
  dir: null, browsing: false, picking: false, // folder step: the in-card browser and the system dialog
  RAIL: ["Sign in", "Folders", "Voice", "Control"],
  get isOpen() { return !$("#onboarding").hidden; },
  open(step) {
    $("#onboarding").hidden = false; document.body.classList.add("onb-open");
    if (!this.orb) { this.orb = new Orb($("#onb-orb")); this.orb.source = () => this.level(); }
    this.orb.refreshPalette();
    if (step !== undefined) this.step = step;
    $("#onb-close").hidden = !S.features?.onboarded;
    this.render(true);
    send({ type: "setup_status" });
  },
  close() { this.stopMic(); $("#onboarding").hidden = true; document.body.classList.remove("onb-open"); },
  update(ev) { this.ev = ev; if (this.isOpen) this.render(false); },
  go(n) { this.stopMic(); this.step = Math.max(0, Math.min(4, n)); this.render(true); },
  signed() { const a = this.ev?.auth; return !!(a && a.loggedIn && a.subscriptionLogin); },
  hasRepos() { return (this.ev?.roots || []).some((r) => r.repos.length); },
  ok(n) { return n === 1 ? this.signed() : n === 2 ? this.hasRepos() : n === 4 ? this.signed() && this.hasRepos() : true; },
  level() {
    if (!this.analyser) return { level: 0, wave: null };
    this.analyser.getFloatTimeDomainData(this.wave);
    let s = 0; for (const x of this.wave) s += x * x;
    return { level: Math.sqrt(s / this.wave.length), wave: this.wave };
  },
  async testMic(btn) {
    try {
      const ctx = Player.unlock();
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048;
      ctx.createMediaStreamSource(this.mic).connect(this.analyser);
      this.orb.setState("listening"); btn.textContent = "Listening… say something"; btn.classList.add("on");
      setTimeout(() => { this.stopMic(); btn.textContent = "✓ Microphone works"; btn.classList.remove("on"); }, 4000);
    } catch (err) { btn.textContent = `Microphone blocked (${err.name})`; }
  },
  stopMic() { this.mic?.getTracks().forEach((t) => t.stop()); this.mic = null; this.analyser = null; this.orb?.setState("idle"); },
  say(text) {
    if (this.ev?.values?.tts === "browser") { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
    else { Player.unlock(); send({ type: "voice_sample" }); }
    this.orb.setState("speaking"); setTimeout(() => this.orb.setState("idle"), 1800);
  },
  key(e) {
    const typing = e.target.closest?.("textarea, input");
    if (e.key === "Escape" && S.features?.onboarded) { e.preventDefault(); this.close(); }
    else if (e.key === "Enter" && !typing && !e.target.closest?.("button") && this.ok(this.step)) { e.preventDefault(); this.next(); }
  },
  next() {
    if (this.step < 4) { this.go(this.step + 1); return; }
    if (S.features?.onboarded) { this.close(); return; } // reopened from Settings
    send({ type: "set_settings", values: { onboarded: true } }); // the server answers with "features" → finish()
  },
  browser(roots, add, btn) { // folders under the home folder; click to go in, "Use this folder" to add it
    const d = this.dir, box = el("div", "onb-browser");
    if (!d) { box.append(el("p", "onb-text small", "Loading…")); return box; }
    const crumbs = el("div", "onb-crumbs mono");
    const rel = d.path === d.home ? "" : d.path.startsWith(d.home + "/") ? d.path.slice(d.home.length + 1) : d.path;
    const parts = rel ? rel.split("/") : [];
    const home = btn("~", () => send({ type: "browse", path: d.home }), "onb-crumb"); crumbs.append(home);
    parts.forEach((part, i) => {
      crumbs.append(el("span", "onb-crumb-sep", "/"));
      const target = d.path.startsWith(d.home + "/") ? d.home + "/" + parts.slice(0, i + 1).join("/") : "/" + parts.slice(0, i + 1).join("/");
      crumbs.append(btn(part, () => send({ type: "browse", path: target }), "onb-crumb" + (i === parts.length - 1 ? " on" : "")));
    });
    box.append(crumbs);
    const list = el("div", "onb-dirs");
    if (d.parent) list.append(btn("↑  ..", () => send({ type: "browse", path: d.parent }), "onb-dir up"));
    for (const e of d.entries) {
      const b = btn("", () => send({ type: "browse", path: e.path }), "onb-dir");
      b.append(el("span", "onb-dir-ic", e.repo ? "◆" : "▸"), el("span", "onb-dir-name", e.name));
      if (e.repo) b.append(el("span", "mono onb-dir-tag", "repo"));
      list.append(b);
    }
    if (!d.entries.length) list.append(el("p", "onb-text small", "No folders here."));
    box.append(list);
    const chosen = roots.some((r) => r.path === d.path);
    const use = btn(chosen ? "✓ Added" : `Use ${d.path === d.home ? "~" : "this folder"}`, () => {
      if (d.path === d.home && !confirm("Give Orb your whole home folder? It would list every repo in it.")) return;
      add(d.path); }, "onb-btn primary small");
    use.disabled = chosen;
    const foot = el("div", "onb-row"); foot.append(el("code", "onb-browser-path", d.path.replace(d.home, "~")), el("span", "onb-spacer"), use);
    box.append(foot);
    return box;
  },
  placeRings() { // centre the ring layer on the orb, wherever the layout put it
    requestAnimationFrame(() => {
      const r = $("#onb-orb").getBoundingClientRect(), o = $("#onboarding");
      o.style.setProperty("--cx", `${r.left + r.width / 2}px`); o.style.setProperty("--cy", `${r.top + r.height / 2}px`);
    });
  },
  finish() { this.close(); showView("chat"); if (!S.folder) openPicker("new"); },

  render(animate) {
    const ev = this.ev || {}, n = this.step;
    // rail + meter
    const rail = $("#onb-rail"); rail.replaceChildren();
    this.RAIL.forEach((name, i) => {
      const k = i + 1, done = k < n || (k !== n && this.ok(k) && k < 4 && ev.auth);
      const b = el("button", "onb-rail-item" + (k === n ? " on" : "") + (done && k !== n ? " done" : ""));
      b.append(el("span", "mono onb-rail-n", String(k).padStart(2, "0")), el("span", null, name));
      b.onclick = () => this.go(k); b.setAttribute("aria-current", k === n ? "step" : "false");
      rail.append(b);
    });
    $("#onb-stage").textContent = n ? `STEP ${String(n).padStart(2, "0")} / 04` : "WELCOME";
    $("#onb-bar").style.width = `${(n / 4) * 100}%`;
    $("#onb-plan").textContent = ev.auth?.subscription ? `CLAUDE · ${ev.auth.subscription.toUpperCase()}` : "";

    this.placeRings();
    const card = $("#onb-card"); card.replaceChildren();
    if (animate) { card.classList.remove("enter"); void card.offsetWidth; card.classList.add("enter"); }
    const head = (kicker, title, text) => {
      card.append(el("p", "mono onb-kicker", kicker));
      const h = el("h2", "onb-title", title); h.id = "onb-title"; card.append(h);
      if (text) card.append(el("p", "onb-text", text));
    };
    const row = (...kids) => { const r = el("div", "onb-row"); r.append(...kids); return r; };
    const btn = (label, fn, cls = "onb-btn") => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; return b; };
    const status = (good, text) => { const s = el("p", "onb-status" + (good ? " good" : "")); s.append(el("span", "onb-dot"), text); return s; };
    const foot = (label, enabled, hint) => {
      const f = el("div", "onb-foot");
      if (n > 0) f.append(btn("Back", () => this.go(n - 1), "onb-btn ghost"));
      const go = btn(label, () => this.next(), "onb-btn primary"); go.disabled = !enabled; if (!enabled && hint) go.title = hint;
      f.append(el("span", "onb-spacer"), go);
      card.append(f);
      if (animate) requestAnimationFrame(() => (enabled ? go : card.querySelector("input, .onb-btn:not(.ghost)") || go).focus());
    };

    if (n === 0) {
      head("ORB · POWERED BY CLAUDE", "Talk to your code.",
        "Orb lets you talk to Claude about the repos on this Mac: ask, plan and change code by voice, and approve every change. Setup takes about a minute.");
      card.append(el("ul", "onb-points"));
      for (const t of ["Runs on your own Claude Pro or Max plan", "Only the folders you choose", "Every change asks you first"]) card.lastChild.append(el("li", null, t));
      foot("Get started", true);
    } else if (n === 1) {
      const a = ev.auth || {};
      head("STEP 01", "Sign in to Claude",
        "Orb runs Claude Code with your own subscription. You sign in in Anthropic's own window; Orb never sees your login.");
      if (!ev.auth) card.append(status(false, "Checking Claude Code…"));
      else if (this.signed()) card.append(status(true, `Signed in · Claude ${a.subscription ? a.subscription[0].toUpperCase() + a.subscription.slice(1) : ""} plan`));
      else {
        card.append(status(false, !a.installed ? "Claude Code wasn't found." : a.loggedIn ? "Signed in with a Console account or API key. Orb needs a Claude Pro or Max account." : "Not signed in yet."));
        const cmd = ev.login_cmd || "claude auth login";
        card.append(el("p", "onb-text small", "Open Terminal, run this, sign in in the browser window it opens, then come back:"));
        card.append(row(el("code", "onb-code", cmd), btn("Copy", (e) => copyText(cmd, e.currentTarget)), btn("Check again", () => send({ type: "setup_status" }))));
      }
      foot("Continue", this.signed(), "Sign in first");
    } else if (n === 2) {
      const roots = ev.roots || [];
      head("STEP 02", "Choose your code folders",
        "Orb lists the git repos inside these folders. A conversation stays in its own repo; touching another needs your OK.");
      const list = el("div", "onb-list");
      for (const r of roots) {
        const item = el("div", "onb-item on");
        const txt = el("div", "onb-item-txt");
        txt.append(el("code", null, r.path.replace(ev.home, "~")), el("span", null, r.exists ? `${r.repos.length} repo${r.repos.length === 1 ? "" : "s"}` : "missing"));
        item.append(el("span", "onb-check", "✓"), txt, btn("Remove", () => send({ type: "set_settings", values: { roots: roots.map((x) => x.path).filter((p) => p !== r.path) } }), "onb-btn ghost small"));
        list.append(item);
      }
      const add = (p) => send({ type: "set_settings", values: { roots: [...roots.map((x) => x.path), p] } });
      for (const sug of ev.suggested || []) {
        const item = el("button", "onb-item"); item.type = "button";
        const txt = el("div", "onb-item-txt"); txt.append(el("code", null, sug.path.replace(ev.home, "~")), el("span", null, `${sug.repos} repos · add`));
        item.append(el("span", "onb-check", "+"), txt); item.onclick = () => add(sug.path);
        list.append(item);
      }
      card.append(list);
      // Pick a real folder: the system dialog (macOS) or a browser inside the card.
      const finder = btn(this.picking ? "Waiting for Finder…" : "Choose in Finder…", () => { this.picking = true; send({ type: "pick_folder" }); this.render(false); });
      finder.disabled = this.picking;
      const browseBtn = btn(this.browsing ? "Hide browser" : "Browse folders", () => {
        this.browsing = !this.browsing; if (this.browsing && !this.dir) send({ type: "browse" }); this.render(false); });
      card.append(row(finder, browseBtn));
      if (this.browsing) card.append(this.browser(roots, add, btn));
      const input = el("input", "onb-input"); input.placeholder = "Another folder, e.g. ~/code"; input.setAttribute("aria-label", "Folder path");
      const addTyped = () => { const v = input.value.trim().replace(/^~(?=\/|$)/, ev.home); if (!v) return;
        if (v === ev.home && !confirm("Give Orb your whole home folder? It would list every repo in it.")) return; add(v); };
      input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } };
      card.append(row(input, btn("Add", addTyped)));
      card.append(el("p", "onb-text small", "Always blocked: secrets/ folders, .env files, keys and credentials, ~/.ssh and ~/.aws."));
      foot("Continue", this.hasRepos(), "Add a folder with at least one repo");
    } else if (n === 3) {
      const v = ev.values || {}, sp = ev.speech || {};
      head("STEP 03", "Her voice, and yours",
        "Browser speech works right away (Chrome transcribes through Google; Safari can on this Mac). Local engines keep everything on this Mac.");
      const seg = (label, options, value, key) => {
        const g = el("div", "onb-seg"); g.setAttribute("role", "radiogroup"); g.setAttribute("aria-label", label);
        for (const [val, text, okay] of options) {
          const b = el("button", "onb-seg-btn" + (val === value ? " on" : ""), text); b.type = "button"; b.disabled = !okay;
          b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(val === value)); if (!okay) b.title = "Not installed on this Mac";
          b.onclick = () => send({ type: "set_settings", values: { [key]: val } });
          g.append(b);
        }
        const r = el("div", "onb-field"); r.append(el("span", "mono onb-label", label), g); return r;
      };
      card.append(seg("HEARING YOU", [["browser", "Browser", BROWSER_STT], ["parakeet", "Parakeet", sp.parakeet], ["whisper", "Whisper", sp.whisper]], v.stt, "stt"));
      card.append(seg("HER VOICE", [["browser", "Browser", BROWSER_TTS], ["kokoro", "Kokoro", sp.kokoro]], v.tts, "tts"));
      card.append(row(btn("Test microphone", (e) => this.testMic(e.currentTarget)), btn("Hear her", () => this.say("Hi, I'm Orb. Pick a repo and just talk."))));
      foot("Continue", true);
    } else {
      head("STEP 04", "You stay in control", null);
      const points = [["Every change asks first", "A card with Allow / Deny, which you can also answer by voice (on headphones)."],
        ["One repo per conversation", "Other repos need your OK; secrets are never readable."],
        ["Your subscription, no API keys", "Orb refuses API keys and runs on your Claude plan."],
        ["Only on this Mac", "The page listens on 127.0.0.1 and needs its private link."]];
      const grid = el("div", "onb-grid");
      for (const [t, d] of points) { const c = el("div", "onb-tile"); c.append(el("strong", null, t), el("span", null, d)); grid.append(c); }
      card.append(grid);
      foot(S.features?.onboarded ? "Done" : "Start using Orb", this.ok(4), "Sign in and add a folder with a repo first");
    }
  },
};

function closeDrawer() { $("#app").classList.remove("side-open"); }

function openFolder(path, session) { Player.stop(); send({ type: "open_folder", path, session }); }
function onOpened(ev) {
  S.folder = ev.folder; store.set("vd-folder", ev.folder);
  S.session = ev.session; store.set("vd-session", ev.session);
  S.busy = ev.busy;
  S.permMode = ev.mode; S.model = ev.info?.model; S.front = ev.model;
  S.ctx = ev.info?.context || null; renderCtx();
  S.mcpFailed = ev.info?.mcp_failed; S.mcpTotal = ev.info?.mcp_total; renderMcpChip(); $("#mcp-panel").hidden = true;
  Player.reset(ev.speech_gen ?? 0);
  $("#where-name").textContent = ev.label.split("/").pop(); // "voicemode": the owner prefix hid the part that differs
  $("#where-name").title = `${ev.label} · ${ev.rel}`;
  renderMeta({ ...ev.info, branch: ev.branch, rel: ev.rel, session_id: ev.session_id });
  S.openTasks = ev.tasks || []; // shown after the history replay, which clears the chat
  showView("chat"); refreshState();
}
function renderMeta(m) {
  if (m.branch !== undefined) S.meta = { branch: m.branch, rel: m.rel };
  if (m.session_id !== undefined) S.sessionId = m.session_id;
  if (m.model) S.model = m.model;
  if (m.permissionMode) S.permMode = m.permissionMode;
  if (m.front) S.front = m.front;
  if (m.mcp_total !== undefined) { S.mcpFailed = m.mcp_failed; S.mcpTotal = m.mcp_total; renderMcpChip(); }
  const parts = [];
  if (S.meta?.branch) parts.push(`branch ${S.meta.branch}`);
  parts.push(S.sessionId ? `session ${S.sessionId.slice(0, 8)}` : "new session");
  if (S.model) parts.push(S.model.replace(/^claude-/, ""));
  $("#where-meta").textContent = parts.join("  ·  ");
  const chip = $("#model");
  chip.hidden = !S.folder;
  chip.textContent = `model: ${S.front || "sonnet"}`;
  chip.classList.toggle("opus", S.front === "opus");
  chip.title = S.front === "opus"
    ? "Opus answers everything here (best for a heavy-coding repo). Click for Sonnet."
    : "Sonnet answers fast and hands hard coding to Opus in the background. Click for Opus.";
  const mode = $("#mode");
  mode.hidden = !S.folder;
  const pm = S.permMode || "default";
  mode.textContent = `approvals: ${pm}`;
  mode.classList.toggle("auto", pm === "auto");
  mode.classList.toggle("plan", pm === "plan");
  mode.title = { auto: "Auto: Claude Code decides what is safe; cards only for what it escalates. Click for plan.",
    plan: "Plan: Claude only reads and plans; it asks you to approve the plan before changing anything. Click for default.",
    default: "Default: a card for every tool that needs permission. Click for auto (like your terminal)." }[pm] || pm;
}
// Context window of the open session: tokens of the last main-thread call / the model's window.
function renderCtx() {
  const box = $("#ctx"), c = S.ctx;
  if (!c || !c.window) { box.hidden = true; return; }
  const pct = c.used / c.window;
  box.hidden = false;
  box.className = "ctx mono" + (pct > 0.9 ? " low" : pct > 0.75 ? " warn" : "");
  box.replaceChildren(el("div", "u-top"), el("div", "u-sub", "this session"));
  box.firstChild.append("Context ", el("b", null, `${Math.max(1, Math.round(pct * 100))}%`), " full");
  box.title = `${c.used.toLocaleString("en-GB")} of ${c.window.toLocaleString("en-GB")} tokens in the last call (updates with each answer). Claude Code compacts the conversation when it gets full.`;
}
function renderMcpChip() {
  const b = $("#mcp");
  if (!S.folder || S.mcpTotal == null) { b.hidden = true; return; }
  b.hidden = false;
  b.classList.toggle("bad", S.mcpFailed > 0);
  b.textContent = S.mcpFailed > 0 ? `MCP ● ${S.mcpFailed} failed` : "MCP ●";
  b.title = S.mcpFailed > 0 ? `${S.mcpFailed} of ${S.mcpTotal} MCP servers failed. Click for details and reconnect.` : `${S.mcpTotal} MCP servers; none failed. Click for details.`;
}
function renderMcpPanel(servers) {
  const p = $("#mcp-panel");
  S.mcpFailed = servers.filter((x) => x.status === "failed").length; S.mcpTotal = servers.length; renderMcpChip();
  const order = { failed: 0, "needs-auth": 1, pending: 2, connected: 3, disabled: 4 };
  p.replaceChildren(el("div", "mcp-head mono", "MCP servers in this session"));
  for (const x of servers.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.name.localeCompare(b.name))) {
    const row = el("div", "mcp-row");
    row.append(el("span", "mcp-dot " + x.status), el("span", "mcp-name", x.name.replace(/^claude\.ai /, "")),
      el("span", "mcp-st mono", x.status + (x.tools ? ` · ${x.tools} tools` : "")));
    if (x.status === "failed") {
      const r = el("button", "chip-btn", "Reconnect");
      r.onclick = () => { r.textContent = "…"; send({ type: "mcp_reconnect", name: x.name }); };
      row.append(r);
    }
    if (x.error) row.title = x.error;
    p.append(row);
  }
}

// Max plan usage as what is LEFT. Data: rate_limit events (unifiedWindows), sent with each answer.
function renderUsage(ev) {
  const w = ev.windows || {}, box = $("#usage");
  if (!w.five_hour && !w.seven_day) { box.hidden = true; return; }
  box.hidden = false;
  const now = new Date();
  const left = (x) => (x && x.utilization != null ? Math.max(0, 1 - x.utilization) : null);
  const level = (l) => (l == null ? "" : l < 0.10 ? "low" : l < 0.25 ? "warn" : "");
  const clock = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (d) => d.toLocaleDateString("en-GB", { weekday: "short" });
  const resets = (x, preferDay) => {
    if (!x?.resetsAt) return "";
    const d = new Date(x.resetsAt * 1000);
    const sameDay = d.toDateString() === now.toDateString();
    return preferDay && !sameDay ? day(d) : sameDay ? clock(d) : `${day(d)} ${clock(d)}`;
  };
  const part = (name, x, preferDay) => {
    const l = left(x), span = el("span", "u-part " + level(l));
    span.append(`${name} `, el("b", null, l == null ? "–" : `${Math.round(l * 100)}%`), " left");
    const r = resets(x, preferDay);
    return { span, resets: r ? `${name.toLowerCase()} resets ${r}` : "" };
  };
  const a = part("Session", w.five_hour, false), b = part("Week", w.seven_day, true);
  const top = el("div", "u-top"); top.append(a.span, el("span", "u-sep", "·"), b.span);
  const sub = el("div", "u-sub", [a.resets, b.resets].filter(Boolean).join(" · ") + ` · updated ${clock(now)} with each answer`);
  box.replaceChildren(top, sub);
  const exact = (name, x) => {
    if (!x || x.utilization == null) return `${name}: no data`;
    const d = x.resetsAt ? new Date(x.resetsAt * 1000) : null;
    return `${name}: ${(x.utilization * 100).toFixed(1)}% used, ${((1 - x.utilization) * 100).toFixed(1)}% left` +
      (d ? `, resets ${d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}` : "");
  };
  box.title = [exact("Session (5-hour window)", w.five_hour), exact("Week (7-day window)", w.seven_day),
    ev.overage ? "Overage in use" : "No overage (no pay-as-you-go)",
    `Updates with each answer; last update ${clock(now)}.`].join("\n");
}
function renderServices(s) {
  const foot = $("#services"); foot.replaceChildren();
  for (const [k, up] of Object.entries(s || {})) { const d = el("span", "svc" + (up ? " up" : "")); d.title = `${k}: ${up ? "running" : "not running"}`; foot.append(d); }
}
setInterval(async () => { try { renderServices((await (await fetch("/api/health")).json()).services); } catch { /* offline */ } }, 60000);

// ---------------------------------------------------------------- chat
const chat = $("#chat"), column = $("#column");
let stick = true;
chat.addEventListener("scroll", () => {
  stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  $("#to-bottom").hidden = stick || !column.children.length;
});
$("#to-bottom").onclick = () => scrollToEnd(true);
function scrollToEnd(force) { if (force || stick) { chat.scrollTop = chat.scrollHeight; stick = true; $("#to-bottom").hidden = true; } }
function clearChat() {
  column.replaceChildren(); S.answer = null; S.tools = null; S.blocks.clear(); S.toolRows.clear(); S.perms.clear(); S.taskChips?.clear();
  $("#app").classList.remove("has-chat"); placeOrb();
}
function markHasChat() { if (!$("#app").classList.contains("has-chat")) { $("#app").classList.add("has-chat"); placeOrb(); } }

function addUser(ev) {
  finishAnswer(false);
  markHasChat();
  const row = el("div", "msg-user");
  if (ev.source === "voice") row.append(el("span", "via", "voice"));
  row.append(el("div", "bubble", ev.text));
  column.append(row);
  S.answer = null; S.tools = null;
  scrollToEnd(true);
}
function ensureAnswer() {
  if (!S.answer) {
    markHasChat();
    S.answer = el("div", "answer"); S.answer.blocks = []; S.answer.userId = S.lastUserId;
    column.querySelectorAll(".answer.last").forEach((a) => a.classList.remove("last"));
    column.append(S.answer);
  }
  return S.answer;
}
function textBlock(id) {
  let b = S.blocks.get(id);
  if (!b) {
    const a = ensureAnswer();
    S.tools = null;
    b = { id, text: "", said: "", el: el("div", "md") };
    a.append(b.el); a.blocks.push(b); S.blocks.set(id, b);
  }
  return b;
}

// The <spoken> summary: a small muted "said aloud" line above the written answer.
function saidLine(b) {
  if (!b.saidEl) {
    b.saidEl = el("div", "said");
    b.saidEl.append(el("span", "said-label", "said aloud"), el("span", "said-text"));
    b.el.before(b.saidEl);
  }
  b.saidEl.lastChild.textContent = b.said.trim();
  scrollToEnd();
}
function heldNote(text) {
  ensureAnswer().append(el("div", "notice held", `Held until the approval card is answered: “${text}”`));
  scrollToEnd(true);
}

// Markdown: marked + DOMPurify, code blocks get highlight + a copy button.
marked.setOptions({ gfm: true, breaks: false });
const pendingRender = new Set();
let renderQueued = false;
function scheduleRender(b) {
  pendingRender.add(b);
  if (S.replaying) { renderMd(b); pendingRender.delete(b); return; }
  if (!renderQueued) { renderQueued = true; setTimeout(() => { renderQueued = false; for (const x of pendingRender) renderMd(x); pendingRender.clear(); scrollToEnd(); }, 50); }
}
const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3Zm2 0h4a2 2 0 0 1 2 2v4h3V5h-9v3Zm-5 2v9h9v-9H5Z"/></svg>';
function renderMd(b) {
  b.el.innerHTML = DOMPurify.sanitize(marked.parse(b.text));
  b.el.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const wrap = el("div", "code");
    pre.replaceWith(wrap); wrap.append(pre);
    const lang = (code?.className.match(/language-(\S+)/) || [])[1];
    if (code) { try { hljs.highlightElement(code); } catch { /* unknown language */ } }
    if (lang) wrap.append(el("span", "lang", lang));
    const btn = el("button", "copy"); btn.innerHTML = COPY_ICON; btn.title = "Copy"; btn.setAttribute("aria-label", "Copy code");
    btn.onclick = () => copyText(code ? code.textContent : pre.textContent, btn);
    wrap.append(btn);
  });
  b.el.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = el("textarea"); ta.value = text; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (btn) { btn.classList.add("done"); setTimeout(() => btn.classList.remove("done"), 1200); }
}

// Tool calls: a run of them collapses into one grey line that expands.
const base = (p) => String(p || "").split("/").filter(Boolean).pop() || p;
function phrase(name, inp = {}) {
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  if (name === "Bash") return inp.description ? lower(inp.description) : "ran a command";
  if (name === "Read") return `read ${base(inp.file_path)}`;
  if (["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(name)) return `edited ${base(inp.file_path || inp.notebook_path)}`;
  if (name === "Grep") return `searched for “${String(inp.pattern || "").slice(0, 28)}”`;
  if (name === "Glob") return "listed files";
  if (name === "WebFetch") { try { return `fetched ${new URL(inp.url).hostname}`; } catch { return "fetched a page"; } }
  if (name === "WebSearch") return "searched the web";
  if (name === "Task" || name === "Agent") return inp.description ? lower(inp.description) : "ran an agent";
  if (name === "TodoWrite") return "updated the plan";
  if (name === "Skill") return `used the ${inp.skill || inp.command || ""} skill`;
  if (name?.startsWith("mcp__")) return `used ${name.split("__").pop().replace(/[_-]/g, " ")}`;
  return name ? lower(name) : "a tool";
}
function updateToolSummary(g) {
  if (!g) return;
  const ps = [...new Set(g.rows.map((r) => phrase(r.name, r.input)))];
  let s = ps.slice(0, 2).join(", ");
  if (ps.length > 2) s += ` and ${ps.length - 2} more`;
  g.label.textContent = s.charAt(0).toUpperCase() + s.slice(1);
}
function toolRow(id, name) {
  let r = S.toolRows.get(id);
  if (r) return r;
  const a = ensureAnswer();
  if (!S.tools) {
    const d = el("details", "tools" + (S.replaying ? "" : " running"));
    const sum = el("summary"); const label = el("span", "label", "Working");
    sum.append(label); d.append(sum);
    const rows = el("div", "tool-rows"); d.append(rows);
    S.tools = { el: d, label, rowsEl: rows, rows: [] };
    a.append(d);
  }
  const g = S.tools;
  const row = el("div", "tool-row pending");
  const call = el("div", "call", name || "tool");
  const out = el("div", "out"); out.hidden = true;
  call.onclick = () => { if (out.textContent) out.hidden = !out.hidden; };
  row.append(call, out); g.rowsEl.append(row);
  r = { id, name, input: {}, row, call, out, group: g };
  g.rows.push(r); S.toolRows.set(id, r);
  updateToolSummary(g); scrollToEnd();
  return r;
}
function toolResult(ev) {
  const r = S.toolRows.get(ev.tool_use_id);
  if (!r) return;
  r.row.classList.remove("pending");
  if (ev.is_error) r.row.classList.add("error");
  r.out.textContent = (ev.content || "(no output)") + (ev.truncated ? "\n… (truncated)" : "");
}

// Approval cards: the button is the real answer.
function permissionCard(ev) {
  if (S.perms.has(ev.id)) return;
  const a = ensureAnswer(); S.tools = null;
  const card = el("div", "perm");
  card.append(el("div", "tile-bar", ev.tool === "AskUserQuestion" ? "question.form" : ev.tool === "ExitPlanMode" ? "plan.md" : `approval.req · ${ev.tool.replace(/^mcp__/, "").replace(/__/g, ".")}`));
  const ask = ev.tool === "AskUserQuestion";
  if (ask) card.classList.add("ask");
  card.append(el("div", "ptitle", ask ? "Claude asks · click or say an option" : "Approval needed"));
  if (ask) {
    const answers = {};
    for (const q of ev.input.questions || []) {
      card.append(el("div", "q", q.question));
      const btns = el("div", "pbtns");
      for (const o of q.options || []) {
        const b = el("button", null, o.label); b.title = o.description || "";
        b.onclick = () => { answers[q.question] = o.label; btns.querySelectorAll("button").forEach((x) => x.classList.toggle("allow", x === b));
          if (Object.keys(answers).length === (ev.input.questions || []).length) send({ type: "permission", id: ev.id, allow: true, answers }); };
        btns.append(b);
      }
      card.append(btns);
    }
    const skip = el("button", null, "Skip"); skip.onclick = () => send({ type: "permission", id: ev.id, allow: false });
    const pb = el("div", "pbtns"); pb.append(skip); card.append(pb);
  } else if (ev.tool === "ExitPlanMode") {
    card.classList.add("plan-card");
    card.querySelector(".ptitle").textContent = "Plan ready";
    const md = el("div", "md"); md.innerHTML = DOMPurify.sanitize(marked.parse(ev.input?.plan || ""));
    card.append(md);
    const btns = el("div", "pbtns");
    const allow = el("button", "allow", "Approve plan"); allow.onclick = () => send({ type: "permission", id: ev.id, allow: true });
    const deny = el("button", null, "Keep planning"); deny.onclick = () => send({ type: "permission", id: ev.id, allow: false });
    btns.append(allow, deny); card.append(btns);
  } else {
    card.append(el("div", "pwhat", ev.title || `Claude wants to use ${ev.tool}`));
    if (ev.description) card.append(el("div", "where-meta", ev.description));
    const detail = ev.input?.command || ev.input?.file_path || ev.input?.url || JSON.stringify(ev.input, null, 2);
    card.append(el("pre", null, detail));
    if (ev.tool === "Edit" && ev.input?.new_string != null) card.append(el("pre", null, ev.input.new_string.slice(0, 2000)));
    const btns = el("div", "pbtns");
    const allow = el("button", "allow", "Allow"); allow.onclick = () => send({ type: "permission", id: ev.id, allow: true });
    const deny = el("button", null, "Deny"); deny.onclick = () => send({ type: "permission", id: ev.id, allow: false });
    btns.append(allow, deny); card.append(btns);
  }
  // The tool row for this call already exists: put the card above its group, so the order reads
  // "approval needed" -> what ran.
  const row = ev.tool_use_id && S.toolRows.get(ev.tool_use_id);
  if (row && row.group.el.parentElement === a) row.group.el.before(card); else a.append(card);
  S.perms.set(ev.id, card);
  scrollToEnd(true);
}
function permissionDone(ev) {
  const card = S.perms.get(ev.id);
  if (!card || card.classList.contains("done")) return;
  card.classList.add("done");
  const how = ev.heard ? ` by voice: “${ev.heard}”` : "";
  const picked = ev.answers && Object.values(ev.answers).flat().join(", ");
  card.append(el("div", "verdict", picked ? `Answered: ${picked}${how}` : (ev.allow ? "Allowed" : ev.answers === null && card.classList.contains("ask") ? "Skipped" : "Denied") + how));
  card.querySelectorAll(".pbtns button.allow").forEach((b) => b.classList.add("chosen"));
}

function onResult(ev) {
  finishAnswer(true);
  if (ev.is_error || (ev.subtype && ev.subtype !== "success")) {
    const why = ev.subtype === "error_during_execution" ? "Stopped." : `Ended: ${ev.subtype}`;
    column.append(el("div", "turn-end", why));
  }
  scrollToEnd();
}
// ---- background tasks: "Opus working" while the opus-coder subagent runs, then its outcome
function taskChip(ev) {
  S.taskChips ??= new Map();
  let c = S.taskChips.get(ev.task_id);
  if (!c) {
    if (S.replaying) return;
    c = el("div", "task-chip mono"); S.taskChips.set(ev.task_id, c);
    const row = ev.tool_use_id && S.toolRows.get(ev.tool_use_id);
    if (row) row.group.el.after(c); else ensureAnswer().append(c);
  }
  const who = ev.coder ? "Opus" : "Background task";
  const what = ev.description ? `: ${ev.description}` : "";
  c.className = `task-chip mono ${ev.status}`;
  c.textContent = ev.status === "running" ? `${who} working${what}` : `${who} ${ev.status === "completed" ? "done" : ev.status}${what}`;
  if (ev.summary) c.title = ev.summary;
  scrollToEnd();
}
// ---- turn timing: a mono line under each answer, e.g. "sonnet-5-5 · stt 0.6 · hold 1.0 · ttft 2.3"
// The server measures its hops; the page adds the VAD hangover and speech end (or Send) -> first audio playing.
const VAD_MS = 1100; // VAD redemptionMs: silence it waits for before ending an utterance
const HOPS = ["vad", "stt", "hold", "conn", "ttft", "say", "tts", "net", "total", "turn"];
const HOP_TITLE = "vad: silence before the utterance ends · stt: Whisper · hold: wait for more speech · conn: start Claude Code · " +
  "ttft: first token · say: first spoken sentence · tts: Kokoro · net: transfer + decode · total: you stop talking -> she starts · turn: whole answer";
function startClock(ev) {
  if (S.replaying || !ev.id) return;
  const voice = ev.source === "voice";
  S.clock = { id: ev.id, voice, start: (voice ? S.speechEndAt : S.sentAt) ?? performance.now(), played: false };
}
function clockPlaying() {
  const c = S.clock;
  if (!c || c.played) return;
  c.played = true;
  send({ type: "playback", turn: c.id, vad_ms: c.voice ? VAD_MS : 0, play_ms: Math.round(performance.now() - c.start) });
}
function renderTiming(ev) {
  const a = [...column.querySelectorAll(".answer")].reverse().find((x) => x.userId === ev.turn);
  if (!a) return;
  const line = a.querySelector(":scope > .timing") || el("div", "timing mono");
  const h = ev.hops || {};
  line.textContent = [ev.model?.replace(/^claude-/, ""), ...HOPS.filter((k) => h[k] !== undefined).map((k) => `${k} ${(h[k] / 1000).toFixed(1)}`)]
    .filter(Boolean).join(" · ");
  line.title = HOP_TITLE;
  a.append(line); // stays last, below the answer tools
}
function finishAnswer(isLast) {
  column.querySelectorAll(".tools.running").forEach((d) => d.classList.remove("running"));
  column.querySelectorAll(".tool-row.pending").forEach((r) => r.classList.remove("pending"));
  const a = S.answer;
  // An answer that is only a <spoken> part is shown as a normal paragraph.
  for (const b of a?.blocks || []) {
    if (!b.text.trim() && b.said.trim()) { b.text = b.said.trim(); b.said = ""; b.saidEl?.remove(); b.saidEl = null; renderMd(b); }
  }
  if (!a || a.querySelector(".answer-tools") || !a.blocks?.length) return;
  const tools = el("div", "answer-tools");
  const whole = () => a.blocks.map((b) => [b.said.trim(), b.text.trim()].filter(Boolean).join("\n\n")).join("\n\n");
  const copy = el("button", null, "Copy"); copy.onclick = () => copyText(whole(), copy);
  const read = el("button", null, "Read all"); read.title = "Read the whole answer aloud";
  read.onclick = () => { Player.unlock(); send({ type: "read_all", text: whole() }); };
  tools.append(copy, read); a.append(tools);
  if (a.undoFiles) addUndoButton(a);
  if (isLast) a.classList.add("last");
}
// Undo: rewind a turn's file edits to its checkpoint, always through a confirm card.
const answerFor = (userId) => [...column.querySelectorAll(".answer")].find((a) => a.userId === userId);
function addUndoButton(a) {
  const tools = a.querySelector(".answer-tools");
  if (!tools || tools.querySelector(".undo")) return;
  const b = el("button", "undo", `Undo (${a.undoFiles.length} file${a.undoFiles.length === 1 ? "" : "s"})`);
  b.title = a.undoFiles.join("\n");
  b.onclick = () => send({ type: "undo_request", user_id: a.userId });
  tools.append(b);
}
function undoAvailable(ev) {
  const a = answerFor(ev.user_id);
  if (!a) return;
  a.undoFiles = ev.files;
  addUndoButton(a);
}
function undoCard(ev) {
  const card = el("div", "perm undo-card");
  card.dataset.id = ev.id;
  card.append(el("div", "tile-bar", "undo.patch"), el("div", "ptitle", "Undo file changes"),
    el("div", "pwhat", `Restore ${ev.files.length} file${ev.files.length === 1 ? "" : "s"} to how they were before that request:`));
  const list = el("pre"); list.textContent = ev.files.join("\n"); card.append(list);
  card.append(el("div", "where-meta", ev.note));
  const btns = el("div", "pbtns");
  const ok = el("button", "allow", `Restore ${ev.files.length} file${ev.files.length === 1 ? "" : "s"}`);
  ok.onclick = () => send({ type: "undo_confirm", id: ev.id, ok: true });
  const no = el("button", null, "Cancel"); no.onclick = () => send({ type: "undo_confirm", id: ev.id, ok: false });
  btns.append(ok, no); card.append(btns);
  ensureAnswer().append(card); S.tools = null;
  scrollToEnd(true);
}
function undoDone(ev) {
  const card = column.querySelector(`.undo-card[data-id="${ev.id}"]`);
  if (card && !card.classList.contains("done")) {
    card.classList.add("done");
    const how = ev.heard ? ` by voice: “${ev.heard}”` : "";
    card.append(el("div", "verdict", ev.ok ? `Restored${how}` : ev.error ? `Failed: ${ev.error}` : `Cancelled${how}`));
  }
  if (ev.ok) {
    const b = answerFor(ev.user_id)?.querySelector(".undo");
    if (b) { b.textContent = "Undone"; b.disabled = true; }
  }
}

function notice(text, level) {
  markHasChat();
  column.append(el("div", "notice" + (level === "error" ? " error" : ""), text));
  scrollToEnd();
}

// ---------------------------------------------------------------- audio out
const Player = {
  ctx: null, analyser: null, wave: new Float32Array(1024), queue: [], src: null, gen: 0, floor: 0, chain: Promise.resolve(),
  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  notices: [], lastAudio: 0, noticeTimer: null,
  get playing() { return !!this.src || this.queue.length > 0; },
  ack() { // one short soft tone when an utterance is accepted (not while she is speaking)
    if (S.muted || !this.ctx || this.playing) return;
    const rate = this.ctx.sampleRate, n = Math.floor(rate * 0.09), buf = this.ctx.createBuffer(1, n, rate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { const t = i / rate; d[i] = 0.06 * Math.min(1, t / 0.008) * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 660 * t); }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.ctx.destination); src.start();
  },
  chime() { // two soft rising tones
    const rate = this.ctx.sampleRate, n = Math.floor(rate * 0.32), buf = this.ctx.createBuffer(1, n, rate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / rate, f = t < 0.14 ? 784 : 1175, local = t < 0.14 ? t : t - 0.16;
      const env = local < 0 ? 0 : Math.min(1, local / 0.01) * Math.exp(-local * 18);
      d[i] = 0.18 * env * Math.sin(2 * Math.PI * f * t);
    }
    return buf;
  },
  notice(ev) { // background folder news: queued after her current answer, never cutting into it
    if (S.muted) return;
    this.unlock();
    const bytes = ev.data ? Uint8Array.from(atob(ev.data), (c) => c.charCodeAt(0)) : null;
    this.chain = this.chain.then(async () => {
      try {
        this.notices.push(this.chime());
        if (bytes) this.notices.push(await this.ctx.decodeAudioData(bytes.buffer));
        else if (S.features?.tts === "browser" && BROWSER_TTS) this.notices.push({ speak: ev.text });
      } catch (e) { console.warn("notice", e); }
      if (!this.src) this.next();
    });
  },
  enqueue(ev) {
    if (S.muted || ev.gen < this.floor) return;
    this.unlock();
    this.lastAudio = Date.now();
    if (ev.speak) { // browser speech: the server sent only the sentence
      if (!BROWSER_TTS) return;
      this.chain = this.chain.then(() => { if (ev.gen >= this.floor) { this.queue.push({ speak: ev.text }); if (!this.src) this.next(); } });
      return;
    }
    const bytes = Uint8Array.from(atob(ev.data), (c) => c.charCodeAt(0));
    this.chain = this.chain.then(async () => {
      try {
        const buf = await this.ctx.decodeAudioData(bytes.buffer);
        if (ev.gen < this.floor) return;
        this.queue.push(buf); if (!this.src) this.next();
      } catch (e) { console.warn("decode", e); }
    });
  },
  next() {
    let buf = this.queue.shift();
    const answer = !!buf;
    if (!buf && this.notices.length) {
      // Between two sentences of an answer the queue can be empty for a moment: wait until the
      // answer is really over (turn done, or no new audio for a while).
      const quiet = Date.now() - this.lastAudio;
      if ((S.busy && quiet < 2500) || quiet < 700) {
        this.src = null; refreshState();
        clearTimeout(this.noticeTimer); this.noticeTimer = setTimeout(() => { if (!this.src) this.next(); }, 300);
        return;
      }
      buf = this.notices.shift();
    }
    if (!buf) { this.src = null; refreshState(); return; }
    if (buf.speak !== undefined) { // read out by the browser's own voice; stop() cancels it like a clip
      const u = new SpeechSynthesisUtterance(buf.speak);
      const src = { stop: () => speechSynthesis.cancel(), speech: true };
      u.onend = u.onerror = () => { if (this.src === src) this.next(); };
      this.src = src; speechSynthesis.speak(u); refreshState();
      if (answer) clockPlaying();
      return;
    }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.analyser);
    src.onended = () => { if (this.src === src) this.next(); };
    this.src = src; src.start(); refreshState();
    if (answer) clockPlaying();
  },
  stop() { // local, immediate: barge-in, Stop, folder switch. Drop audio until the server's next speech_reset.
    this.floor = Infinity;
    this.queue = [];
    if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { /* already stopped */ } }
    refreshState();
  },
  reset(gen) { this.gen = gen; this.floor = gen; this.queue = []; if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { /**/ } } refreshState(); },
  level() {
    if (!this.src) return 0;
    if (this.src.speech) return 0.04 + 0.03 * Math.abs(Math.sin(performance.now() / 120)); // no samples to measure: a gentle pulse
    this.analyser.getFloatTimeDomainData(this.wave);
    let s = 0; for (const x of this.wave) s += x * x;
    return Math.sqrt(s / this.wave.length);
  },
};

// ---------------------------------------------------------------- voice in (browser VAD -> 16 kHz WAV)
const Mic = {
  vad: null, analyser: null, wave: new Float32Array(1024), stream: null,
  async start() {
    const ctx = Player.unlock();
    if (!this.vad) {
      setState("starting mic");
      this.vad = await vad.MicVAD.new({
        model: "v5",
        audioContext: ctx,
        baseAssetPath: location.origin + "/static/vendor/", // self-hosted, hash-checked (vendor.py); absolute, or ORT resolves it against the CDN
        onnxWASMBasePath: location.origin + "/static/vendor/",
        getStream: async () => {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          const src = ctx.createMediaStreamSource(this.stream);
          this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; src.connect(this.analyser);
          detectHeadphones();
          return this.stream;
        },
        resumeStream: async () => this.vad.options.getStream(),
        positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35,
        preSpeechPadMs: 500, redemptionMs: VAD_MS, minSpeechMs: 300,
        onSpeechStart: onSpeechStart,
        onSpeechRealStart: onSpeechRealStart,
        onSpeechEnd: onSpeechEnd,
        onVADMisfire: () => { if (S.hearing) send({ type: "speech_cancelled" }); S.hearing = false; S.utteranceOk = true; refreshState(); },
      });
    }
    await this.vad.start();
    if (browserSTT()) Rec.run();
    S.micOn = true; S.localLabel = null; refreshState();
  },
  async stop() { Rec.halt(); if (this.vad) await this.vad.pause(); S.micOn = false; S.hearing = false; refreshState(); },
  level() {
    if (!S.micOn || !this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.wave);
    let s = 0; for (const x of this.wave) s += x * x;
    return Math.sqrt(s / this.wave.length);
  },
};

// Browser speech recognition (Settings → stt "browser"): runs next to the VAD, which still drives
// "is she being talked over" and the hold; the recognizer only supplies the words.
const browserSTT = () => S.features?.stt === "browser" && BROWSER_STT;
const Rec = {
  r: null, on: false,
  make() {
    const C = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new C(); r.continuous = true; r.interimResults = false; r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], text = res.isFinal ? res[0].transcript.trim() : "";
        if (!text || !S.utteranceOk) continue; // her own voice on speakers, or nothing
        // On speakers the recognizer may have heard her: such words never answer an approval card.
        send({ type: "voice_text", text, echo_risk: !S.headphones || Player.playing }); Player.ack(); S.serverState = "transcribing"; refreshState();
      }
    };
    r.onend = () => { if (this.on) try { r.start(); } catch { /* already running */ } }; // Chrome stops after a silence
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.on = false; notice("The browser blocked speech recognition. Allow the microphone, or pick a local engine in Settings.", "error"); } };
    return r;
  },
  run() { if (!this.r) this.r = this.make(); this.on = true; try { this.r.start(); } catch { /* already running */ } },
  halt() { this.on = false; try { this.r?.stop(); } catch { /* not running */ } },
};
function bargeAllowed() {
  if (S.bargeMode === "on") return true;
  if (S.bargeMode === "off") return false;
  return S.headphones;
}
async function detectHeadphones() {
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    const def = outs.find((d) => d.deviceId === "default") || outs[0];
    S.headphones = !!def && /airpods|headphone|headset|buds|beats|earpods|earphone/i.test(def.label);
  } catch { S.headphones = false; }
  refreshState();
}
navigator.mediaDevices?.addEventListener?.("devicechange", detectHeadphones);

function onSpeechStart() { // first speech frame: tell the server to hold a pending request
  if (Player.playing && !bargeAllowed()) { S.utteranceOk = false; return; } // her own voice on speakers: ignore
  S.utteranceOk = true; S.hearing = true; refreshState();
  // Speech that starts while she plays on speakers may be her own voice: it may not answer a card.
  send({ type: "speech_start", echo_risk: Player.playing && !S.headphones });
}
function onSpeechRealStart() { // 300 ms of real speech: talking over her stops her
  if (S.utteranceOk && Player.playing && bargeAllowed()) { Player.stop(); send({ type: "barge_in" }); }
}
function onSpeechEnd(samples) {
  S.hearing = false; S.speechEndAt = performance.now();
  if (!S.utteranceOk) { S.utteranceOk = true; refreshState(); return; }
  if (browserSTT()) { refreshState(); return; } // the browser's recognizer sends the words (Rec)
  send({ type: "utterance", wav: wavBase64(samples, 16000) });
  Player.ack(); // heard you: a soft tick right away, so the wait feels shorter
  S.serverState = "transcribing"; refreshState();
}
function wavBase64(f32, rate) {
  const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + f32.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  let bin = ""; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------------------------------------------------------- state line + orb
const orb = new Orb($("#orb-canvas"));
window.__orb = orb;
orb.source = () => {
  if (Player.src) return { level: Player.level(), wave: Player.wave };
  if (S.micOn) return { level: Mic.level(), wave: Mic.wave };
  return { level: 0, wave: null };
};
let flash = null;
function setState(label) { S.localLabel = label; refreshState(); }
function flashState(text) { flash = text; refreshState(); setTimeout(() => { flash = null; refreshState(); }, 1800); }
function refreshState() {
  let st;
  if (S.serverState === "waiting") st = "waiting";
  else if (Player.playing) st = "speaking";
  else if (S.hearing) st = "hearing";
  else if (S.serverState === "transcribing") st = "transcribing";
  else if (S.busy) st = S.serverState === "thinking" ? "thinking" : "working";
  else if (S.micOn) st = "listening";
  else st = "idle";
  if (S.localLabel === "offline") st = "offline";
  const labels = { waiting: "Waiting for your approval", speaking: "Speaking", hearing: "Hearing you", transcribing: "Transcribing",
    thinking: "Thinking", working: "Working", listening: "Listening", idle: S.folder ? "Idle · tap the orb or type" : "Pick a folder", offline: "Reconnecting…" };
  const partial = S.partial && (st === "hearing" || st === "transcribing" || st === "listening") ? ` · “${S.partial.slice(-80)}”` : "";
  $("#state-label").textContent = flash || (S.localLabel === "starting mic" ? "Starting mic…" : labels[st] + partial);
  $("#state-dot").className = "state-dot " + (st === "hearing" ? "listening" : st);
  orb.setState(st);
  $("#orb").dataset.state = st;
  $("#vp-label").textContent = { idle: S.folder ? "Talk" : "Pick a repo", listening: "Listening", hearing: "Listening", transcribing: "Transcribing",
    thinking: "Thinking", working: "Working", speaking: "Speaking · Stop", waiting: "Needs your OK", offline: "Offline" }[st] || "Talk";
  $("#orb").setAttribute("aria-pressed", String(S.micOn));
  $("#stop").hidden = !(S.busy || Player.playing);
  const mode = S.bargeMode === "auto" ? (S.headphones ? "auto · headphones" : "auto · off on speakers") : S.bargeMode;
  $("#barge").textContent = `barge-in: ${mode}`;
  $("#barge").title = "Click to cycle barge-in: auto (headphones only) → on → off. On speakers, Esc or ■ stops her.";
  $("#hero-hint").textContent = !S.folder ? "Pick a repo to start" : S.micOn ? "Listening… just talk" : "Tap the orb to talk";
  $("#hero-sub").textContent = !S.folder ? "tap the orb or + New to choose one" : "or type below · Space toggles the mic · Esc stops";
}
// Studio skin: the voice pill's five bars follow the mic or her voice (the orb canvas is hidden there).
{
  const bars = [...document.querySelectorAll("#vp-bars i")], shape = [0.45, 0.8, 1, 0.65, 0.35];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tick = () => {
    if (document.documentElement.dataset.skin === "studio" && !reduced) {
      const st = $("#orb").dataset.state;
      if (st === "listening" || st === "hearing" || st === "speaking") {
        const lv = Math.min(1, orb.source().level * 7), t = performance.now() / 160;
        bars.forEach((b, i) => { b.style.height = `${2 + Math.round(14 * shape[i] * Math.max(lv, 0.08) * (0.75 + 0.25 * Math.sin(t + i * 1.7)))}px`; });
      } else if (bars[0].style.height) bars.forEach((b) => (b.style.height = ""));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function placeOrb() {
  const slot = $("#app").classList.contains("has-chat") ? $("#dock-slot") : $("#hero-slot");
  if ($("#orb").parentElement !== slot) slot.append($("#orb"));
}

// ---------------------------------------------------------------- controls
async function toggleMic() {
  if (!S.folder && !S.micOn) { openPicker("new"); return; } // nothing to talk to yet: pick a repo first
  try { S.micOn ? await Mic.stop() : await Mic.start(); }
  catch (e) { S.localLabel = null; notice(`Microphone: ${e.message || e}`, "error"); refreshState(); }
}
function stopAll() { Player.stop(); send({ type: "interrupt" }); }
$("#orb").onclick = toggleMic;
$("#stop").onclick = stopAll;
$("#barge").onclick = () => {
  S.bargeMode = { auto: "on", on: "off", off: "auto" }[S.bargeMode]; store.set("vd-barge", S.bargeMode); refreshState();
};
$("#mute").onclick = () => {
  S.muted = !S.muted; store.set("vd-muted", S.muted ? "1" : "0");
  $("#mute").setAttribute("aria-pressed", String(S.muted));
  if (S.muted) Player.stop();
  send({ type: "mute", value: S.muted });
};
$("#mute").setAttribute("aria-pressed", String(S.muted));
$("#model").onclick = () => { if (S.folder) send({ type: "set_model", model: S.front === "opus" ? "sonnet" : "opus" }); };
$("#mode").onclick = () => { if (S.folder) send({ type: "set_mode", mode: { default: "auto", auto: "plan", plan: "default" }[S.permMode || "default"] }); };
$("#mcp").onclick = () => { const p = $("#mcp-panel"); if (!p.hidden) { p.hidden = true; return; } p.replaceChildren(el("div", "mcp-row mono", "checking MCP servers…")); p.hidden = false; send({ type: "mcp_status" }); };
$("#new-session").onclick = () => { if (S.folder) { Player.stop(); send({ type: "new_session" }); } };
$("#search").oninput = renderSearch;
$("#open-side").onclick = () => { $("#app").classList.remove("side-collapsed"); store.set("vd-collapsed", "0"); $("#app").classList.add("side-open"); };
$("#close-side").onclick = $("#scrim").onclick = closeDrawer;
$("#collapse-side").onclick = () => { $("#app").classList.add("side-collapsed"); store.set("vd-collapsed", "1"); };
if (store.get("vd-collapsed", "0") === "1") $("#app").classList.add("side-collapsed");
$("#nav-new").onclick = $("#recent-add").onclick = () => openPicker("new");
$("#onb-close").onclick = () => Onb.close();
addEventListener("resize", () => { if (Onb.isOpen) Onb.placeRings(); });
$("#onboarding").addEventListener("scroll", () => Onb.placeRings(), { passive: true });
$("#pin-add").onclick = () => openPicker("pin");
$("#nav-activity").onclick = () => { showView(S.view === "activity" ? "chat" : "activity"); closeDrawer(); };
$("#nav-routines").onclick = () => { showView(S.view === "routines" ? "chat" : "routines"); closeDrawer(); };
$("#nav-settings").onclick = $("#foot-settings").onclick = () => { showView(S.view === "settings" ? "chat" : "settings"); closeDrawer(); };
$("#nav-brain").onclick = () => { if (S.vault) { openFolder(S.vault); closeDrawer(); } };
$("#brain-bar").querySelectorAll("[data-ask]").forEach((b) => (b.onclick = () => { Player.unlock(); send({ type: "user_text", text: b.dataset.ask, interrupt: S.busy }); }));
$("#dictate-note").onclick = async () => { send({ type: "dictate_note" }); flashState("Dictating a note: say it, it's saved word for word"); if (!S.micOn) await toggleMic(); };
$("#picker-close").onclick = closePicker;
$("#picker").onclick = (e) => { if (e.target === $("#picker")) closePicker(); };
$("#picker-search").oninput = renderPicker;
$("#picker-search").onkeydown = (e) => { if (e.key === "Enter") { const first = $("#picker-list .pick"); if (first) first.click(); } };
$("#add-folder").onsubmit = (e) => {
  e.preventDefault(); const p = $("#add-path").value.trim(); if (!p) return;
  $("#add-path").value = ""; closePicker(); closeDrawer();
  if (pickerMode === "pin") send({ type: "pin_folder", path: p, pinned: true }); else send({ type: "start_session", path: p });
};
S.view = "chat";

const input = $("#input");
const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px"; $("#send").disabled = !input.value.trim(); };

// ---------------------------------------------------------------- slash commands
// "/" at the start of the composer opens the session's commands (skills, plugin skills, Claude Code
// built-ins, the dashboard's own). Tab/Enter completes; the text is sent as typed and Claude Code
// expands it, except the dashboard's own (/clear, /model, /mcp, /rewind), which the server runs.
// Typed input only: voice never goes through the composer.
const Slash = {
  items: [], shown: [], active: 0, open: false, menu: $("#slash-menu"),
  set(items) { this.items = items || []; if (this.open) this.update(); },
  query() { const m = input.value.match(/^\/(\S*)$/); return m ? m[1].toLowerCase() : null; },
  rank(c, q) {
    if (!q) return 0;
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.split(":").pop().startsWith(q)) return 1; // plugin skills: "/acc" finds "design:accessibility-review"
    if (n.includes(q)) return 2;
    return (c.description || "").toLowerCase().includes(q) ? 3 : -1;
  },
  update() {
    const q = this.query();
    if (q === null) { this.close(); return; }
    this.shown = this.items.map((c, i) => [this.rank(c, q), i, c]).filter((x) => x[0] >= 0)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 80).map((x) => x[2]);
    if (!this.shown.length) { this.close(); return; } // unknown name: Enter sends it as typed
    this.active = 0; this.open = true; this.menu.hidden = false; input.setAttribute("aria-expanded", "true");
    this.render();
  },
  render() {
    this.menu.replaceChildren(...this.shown.map((c, i) => {
      const row = el("div", "slash-item" + (i === this.active ? " active" : ""));
      row.id = `slash-opt-${i}`; row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(i === this.active));
      row.append(el("span", "slash-name mono", "/" + c.name), el("span", "slash-hint mono", c.argumentHint || ""),
        el("span", "slash-tag mono", c.local ? "dashboard" : ""), el("span", "slash-desc", c.description || ""));
      row.title = c.description || "";
      row.onmousedown = (e) => e.preventDefault(); // keep the caret in the composer
      row.onpointerenter = (e) => { if (e.pointerType === "mouse") this.select(i, false); };
      row.onclick = () => this.pick(i);
      return row;
    }));
    input.setAttribute("aria-activedescendant", `slash-opt-${this.active}`);
  },
  select(i, scroll = true) {
    const rows = this.menu.children;
    rows[this.active]?.classList.remove("active"); rows[this.active]?.setAttribute("aria-selected", "false");
    this.active = (i + this.shown.length) % this.shown.length;
    const row = rows[this.active];
    row?.classList.add("active"); row?.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", `slash-opt-${this.active}`);
    if (scroll) row?.scrollIntoView({ block: "nearest" });
  },
  exact() { return this.shown[this.active]?.name.toLowerCase() === this.query(); },
  pick(i) {
    const c = this.shown[i]; if (!c) return;
    input.value = `/${c.name} `; grow(); this.close();
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  },
  close() {
    if (!this.open) return;
    this.open = false; this.menu.hidden = true; this.menu.replaceChildren();
    input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
  },
};
input.addEventListener("keydown", (e) => {
  if (!Slash.open || e.isComposing) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); Slash.select(Slash.active + (e.key === "ArrowDown" ? 1 : -1)); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); Slash.close(); } // not "stop everything"
  else if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
    if (e.key === "Enter" && Slash.exact()) { Slash.close(); return; } // "/clear" typed in full: Enter sends it
    e.preventDefault(); e.stopImmediatePropagation(); Slash.pick(Slash.active);
  }
});
input.addEventListener("input", grow);
input.addEventListener("input", () => Slash.update());
input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) Slash.close(); }, 200));
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); } });
$("#composer").onsubmit = (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !S.folder) { if (!S.folder) openPicker("new"); return; }
  Player.unlock(); Player.stop(); Slash.close();
  send({ type: "user_text", text, interrupt: S.busy });
  input.value = ""; grow();
};
grow();

document.addEventListener("keydown", (e) => {
  if (Onb.isOpen) { Onb.key(e); return; } // the setup assistant owns the keyboard while it's up
  const typing = e.target.closest?.("textarea, input");
  if (e.key === "Escape") { e.preventDefault(); if (!$("#picker").hidden) { closePicker(); return; } stopAll(); return; }
  if (typing) return;
  if (e.code === "Space" && !e.repeat) { e.preventDefault(); toggleMic(); }
  else if (e.key === "m" || e.key === "M") $("#mute").click();
  else if (e.key === "/") { e.preventDefault(); input.focus(); if (!input.value) { input.value = "/"; grow(); Slash.update(); } }
});
// iOS/Safari: audio may only start after a gesture.
document.addEventListener("pointerdown", () => Player.unlock(), { once: true });

placeOrb();
refreshState();
connect();
