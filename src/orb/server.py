"""FastAPI app: static page + one WebSocket that drives the folder sessions."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import secrets
import time
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
import hashlib

from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import billing, chain, config, folders, routines, settings, setup, slash, speech, vendor, vocab
from .agent import FolderSession, dumps, first_request
from .brain import CaptureGuard
from .sessions import SessionStore

log = logging.getLogger("orb")
STATIC = Path(__file__).parent / "static"


def build_id() -> str:
    """Hash of the page's own files: a page from an older build reloads itself (no stale JS)."""
    h = hashlib.sha256()
    for name in ("index.html", "app.js", "app.css", "studio.css"):
        h.update((STATIC / name).read_bytes())
    return h.hexdigest()[:12]


BUILD = build_id()


class Conn:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.folder: str | None = None
        self.key: str | None = None  # the session shown on this page
        self.muted = False
        self.send_lock = asyncio.Lock()

    async def send(self, ev: dict) -> None:
        async with self.send_lock:
            with contextlib.suppress(Exception):
                await self.ws.send_text(dumps(ev))


STATUS_ORDER = ("approval", "working", "done", "idle")


def spoken_name(label: str) -> str:
    """'acme/shop_web' -> 'shop web'."""
    return label.rsplit("/", 1)[-1].replace("_", " ").replace("-", " ")


async def notice_audio(text: str) -> str | None:
    """Kokoro audio for a background notice (base64), or None: with browser speech the page reads
    the notice's text itself."""
    if settings.settings["tts"] == "browser":
        return None
    try:
        return base64.b64encode(await speech.synthesize(text)).decode()
    except Exception as e:  # noqa: BLE001
        log.warning("notice speech failed: %s", e)
        return None


class Hub:
    def __init__(self) -> None:
        self.conns: set[Conn] = set()
        self.sessions: dict[str, FolderSession] = {}  # by session key
        self.store = SessionStore(config.STATE_DIR / "sessions.json")
        self.folders: list[dict] = []
        self.rate_limit: dict | None = None
        self.guard = CaptureGuard(config.STATE_DIR / "captures.json")  # shared: one daily limit
        self.routines = routines.Watch(config.STATE_DIR / "routines.json", notify=self.routine_notice,
                                       push=self.push_routines)
        # Slash-command menus by folder (project skills differ), and the latest one for a folder
        # whose Claude Code hasn't started yet (user skills and built-ins are the same everywhere).
        self.commands: dict[str, list[dict]] = {}
        self.auth: dict = {}
        self.last_commands: list[dict] = []

    async def check_auth(self) -> None:
        """Which plan Claude Code is signed in with, for the sidebar (never the account itself)."""
        self.auth = await setup.auth_status()
        await asyncio.gather(*(c.send({"type": "features", **features()}) for c in self.conns))

    def commands_for(self, s: FolderSession) -> list[dict]:
        return s.commands or self.commands.get(s.path) or self.last_commands or slash.merge(None)

    # -- folders ----------------------------------------------------------------

    def scan(self) -> list[dict]:
        found: list[dict] = []
        for root in settings.settings.roots():
            if root.is_dir():
                found += [f.to_dict() for f in folders.discover(root) if f.path not in {x["path"] for x in found}]
        known = {f["path"] for f in found}
        for extra in self.store.extra_folders():
            p = Path(extra)
            if extra not in known and self.allowed_folder(extra) is not None:
                found.append(folders.describe(p, folders.root_of(p, settings.settings.roots())).to_dict())
        self.folders = found
        speech.PROMPT = vocab.build_prompt([f["label"] for f in found], config.STATE_DIR / "vocabulary.txt")
        return found

    def label(self, path: str) -> str:
        return next((f["label"] for f in self.folders if f["path"] == path), Path(path).name)

    def session_list(self, path: str) -> list[dict]:
        out = []
        for e in self.store.sessions(path):
            live = self.sessions.get(e["key"])
            out.append({"key": e["key"], "label": e.get("label"), "last_used": e.get("last_used"),
                        "empty": not e.get("resume") and not (live and (live.busy or live.history)),
                        "status": live.status if live else "idle", "live": bool(live and live.live),
                        "mcp_failed": live.info.get("mcp_failed", 0) if live else 0,
                        "opus": sum(1 for t in live.running_tasks() if t["coder"]) if live else 0})
        return out

    def folder_list(self) -> list[dict]:
        out = []
        for f in self.folders or self.scan():
            sessions = self.session_list(f["path"])
            statuses = [x["status"] for x in sessions]
            status = next((st for st in STATUS_ORDER if st in statuses), "idle")
            out.append({**f, "last_used": self.store.last_used(f["path"]), "status": status,
                        "pinned": self.store.pinned(f["path"]),
                        "mcp_failed": max((x["mcp_failed"] for x in sessions), default=0),
                        "live": any(x["live"] for x in sessions), "has_session": bool(sessions),
                        "sessions": sessions})
        return out

    def allowed_folder(self, path: str) -> Path | None:
        """A folder inside one of the user's roots and not in a skipped folder; else None."""
        p = Path(path).expanduser().resolve()
        root = folders.root_of(p, settings.settings.roots())
        if not p.is_dir() or root is None or folders.is_forbidden(p, root):
            return None
        return p

    # -- sessions -----------------------------------------------------------------

    def session(self, path: str, key: str) -> FolderSession:
        s = self.sessions.get(key)
        if s is None:
            s = FolderSession(
                path, key, self.store,
                emit=lambda ev, k=key: self.broadcast(k, ev),
                wants_audio=lambda k=key: any(c.key == k and not c.muted for c in self.conns),
                viewed=lambda k=key: any(c.key == k for c in self.conns),
                notify=self.notify,
                guard=self.guard,
            )
            self.sessions[key] = s
        return s

    def folder_sessions(self, path: str) -> list[FolderSession]:
        return [s for s in self.sessions.values() if s.path == path]

    async def broadcast(self, key: str, ev: dict) -> None:
        if ev["type"] == "rate_limit":
            self.rate_limit = ev
        elif ev["type"] == "commands":
            self.commands[ev["folder"]] = self.last_commands = ev["items"]
        targets = [c for c in self.conns if c.key == key or ev["type"] == "rate_limit"]
        await asyncio.gather(*(c.send(ev) for c in targets))
        if ev["type"] in ("result", "session_info", "state", "permission", "permission_done", "user"):
            await self.push_folders()

    async def notify(self, s: FolderSession, kind: str) -> None:
        """A background session finished or needs approval: a sound and one spoken line on
        every page that is not showing it (the page queues it after any answer in progress).
        "tasks": a background task started or ended; only the sidebar and Activity change."""
        if kind == "tasks":
            await self.push_folders()
            return
        targets = [c for c in self.conns if c.key != s.key]
        if not targets:
            return
        name = spoken_name(self.label(s.path))
        text = f"{name} is done." if kind == "done" else f"{name} needs approval."
        audio = await notice_audio(text) if any(not c.muted for c in targets) else None
        ev = {"type": "bg_notice", "folder": s.path, "session": s.key, "kind": kind, "text": text,
              "label": self.label(s.path)}
        await asyncio.gather(*(c.send({**ev, "data": None if c.muted else audio, "mime": "audio/mpeg"})
                               for c in targets))
        await self.push_folders()

    async def routine_notice(self, text: str) -> None:
        """A scheduled cloud agent needs the user: the same chime + spoken line, on every page."""
        if not self.conns:
            return
        audio = await notice_audio(text) if any(not c.muted for c in self.conns) else None
        ev = {"type": "bg_notice", "kind": "routine", "text": text}
        await asyncio.gather(*(c.send({**ev, "data": None if c.muted else audio, "mime": "audio/mpeg"})
                               for c in self.conns))

    async def push_routines(self) -> None:
        ev = self.routines.event()
        await asyncio.gather(*(c.send(ev) for c in self.conns))

    async def push_folders(self) -> None:
        items = self.folder_list()
        await asyncio.gather(*(c.send({"type": "folders", "items": items}) for c in self.conns))

    async def enforce_limits(self) -> None:
        """Close idle sessions (never one with a running turn or an open card)."""
        live = sorted((s for s in self.sessions.values() if s.live), key=lambda s: s.last_active)
        viewed = {c.key for c in self.conns}
        now = time.time()
        for s in live:
            idle = not s.busy and not s.pending and not s.running_tasks() and s.key not in viewed
            too_many = sum(1 for x in self.sessions.values() if x.live) > config.MAX_LIVE_SESSIONS
            if idle and (too_many or now - s.last_active > config.IDLE_CLOSE_SECONDS):
                log.info("closing idle session %s (%s)", s.path, s.key[:8])
                await s.close()

    async def janitor(self) -> None:
        while True:
            await asyncio.sleep(60)
            with contextlib.suppress(Exception):
                await self.enforce_limits()


hub = Hub()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    billing.assert_subscription_env()
    await asyncio.to_thread(vendor.ensure)
    await asyncio.to_thread(hub.store.backfill_labels, first_request)
    hub.scan()
    tasks = [asyncio.create_task(hub.janitor()), asyncio.create_task(hub.routines.loop()),
             asyncio.create_task(hub.check_auth())]
    yield
    for task in tasks:
        task.cancel()
    for s in list(hub.sessions.values()):
        await s.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


CDN = "https://cdn.jsdelivr.net"


def csp(host: str, secure: bool) -> str:
    ws = f"{'wss' if secure else 'ws'}://{host}"
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' {CDN} 'wasm-unsafe-eval'",  # CDN scripts carry SRI hashes
        f"style-src 'self' {CDN} https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        f"connect-src 'self' {ws}",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
    ])


@app.get("/")
async def index(request: Request):
    secure = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
    html = (STATIC / "index.html").read_text().replace("__BUILD__", BUILD)
    return HTMLResponse(html, headers={
        "Cache-Control": "no-store",
        "Content-Security-Policy": csp(request.headers.get("host", ""), secure),
        "Referrer-Policy": "no-referrer",
    })


@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/api/health")
async def health():
    return JSONResponse({"ok": True, "services": await speech.health()})


def origin_ok(ws: WebSocket) -> bool:
    """Same-origin only: another page open in the browser must not drive the agent."""
    origin = ws.headers.get("origin")
    host = ws.headers.get("host", "")
    if not origin:
        return False
    return urlparse(origin).netloc == host


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    token = ws.query_params.get("t", "")
    if not origin_ok(ws) or not secrets.compare_digest(token, config.token()):
        # Accept, then close with 4403: a close before accept reaches the browser as a plain failed
        # connection (1006), and the page would keep reconnecting with a stale token forever.
        await ws.accept()
        await ws.close(code=4403)
        return
    await ws.accept()
    conn = Conn(ws)
    hub.conns.add(conn)
    try:
        await conn.send({"type": "hello", "build": BUILD, "folders": hub.folder_list(), **features(),
                         "services": await speech.health(), "rate_limit": hub.rate_limit})
        await conn.send(hub.routines.event())
        while True:
            msg = await ws.receive_json()
            try:
                await handle(conn, msg)
            except Exception as e:  # noqa: BLE001
                log.exception("ws message %s", msg.get("type"))
                await conn.send({"type": "error", "text": str(e)})
    except WebSocketDisconnect:
        pass
    finally:
        hub.conns.discard(conn)


def features() -> dict:
    """What the page shows: the user's folders, and the optional parts they turned on."""
    s = settings.settings
    return {"roots": s["roots"], "vault": str(s.vault() or ""), "brain": s["brain"], "routines": s["routines"],
            "onboarded": s["onboarded"], "stt": s["stt"], "tts": s["tts"], "plan": hub.auth.get("subscription")}


async def settings_event() -> dict:
    vocab_file = config.STATE_DIR / "vocabulary.txt"
    installed = await speech.voices()
    return {"type": "settings", "values": settings.settings.data, "voices": installed,
            "recommended": speech.recommended(installed, settings.settings["voice"]),
            "vocabulary": vocab_file.read_text() if vocab_file.exists() else "",
            "vocab_seed": vocab.SEED, "whisper_prompt": speech.PROMPT,
            "vault": str(settings.settings.vault() or ""), "port": config.PORT, "host": config.HOST}


async def open_session(conn: Conn, path: str, key: str) -> None:
    old = hub.sessions.get(conn.key) if conn.key and conn.key != key else None
    conn.folder, conn.key = path, key
    if old is not None and not old.viewed():
        await old.speaker.reset()  # nobody hears it any more; stop synthesizing
    s = hub.session(path, key)
    s.unseen = False
    await asyncio.to_thread(s.load_history)
    desc = folders.describe(Path(path), folders.root_of(Path(path), settings.settings.roots()) or Path(path).parent)
    await conn.send({"type": "opened", "folder": path, "session": key, "label": desc.label, "branch": desc.branch,
                     "rel": desc.rel, "session_id": s.session_id, "live": s.live, "busy": s.busy,
                     "speech_gen": s.speaker.gen, "mode": s.mode, "model": s.model, "info": s.info,
                     "tasks": list(s.tasks.values())})
    await conn.send({"type": "commands", "folder": path, "session": key, "items": hub.commands_for(s)})
    await conn.send({"type": "history", "folder": path, "session": key, "events": s.history})
    for ev in s.pending_events():
        await conn.send(ev)
    await conn.send({"type": "state", "folder": path, "session": key, "value": "working" if s.busy else "idle",
                     "busy": s.busy})
    await hub.push_folders()
    if not s.live:
        asyncio.create_task(s.prewarm())  # the first request then skips starting Claude Code


async def open_folder(conn: Conn, path: str, key: str | None = None) -> None:
    p = hub.allowed_folder(path)
    if p is None:
        await conn.send({"type": "error", "text": f"Not an allowed folder: {path}"})
        return
    await open_session(conn, str(p), hub.store.open(str(p), key))


async def run_local(conn: Conn, s: FolderSession, name: str, args: str) -> None:
    """A slash command the dashboard runs itself (slash.LOCAL); nothing goes to the model."""
    if name == "clear":
        # Like the New session button: a fresh session here, the current one keeps running.
        await open_session(conn, s.path, hub.store.new_session(s.path))
    elif name == "model":
        want = args.lower().strip()
        want = "sonnet" if want == "sonet" else want
        if not want:
            await conn.send({"type": "notice", "text": f"Front model: {s.model}. /model sonnet or /model opus switches it."})
        elif want not in chain.MODELS:
            await conn.send({"type": "notice", "level": "warn",
                             "text": f"Unknown front model {args!r}: use sonnet or opus."})
        else:
            for x in {s, *hub.folder_sessions(s.path)}:  # per folder, like the header chip
                await x.set_model(want)
            await conn.send({"type": "notice", "text": f"Front model: {want}."})
    elif name == "mcp":
        await conn.send({"type": "mcp", "folder": s.path, "session": s.key, "servers": await s.mcp_status(), "open": True})
        await hub.push_folders()
    elif name == "rewind":
        await s.request_undo(None)
    elif name == "config":
        # Per repo, like the header chips; never Claude Code's own /config (global settings.json).
        changes, problems = slash.parse_config(args)
        if problems:
            await conn.send({"type": "notice", "level": "warn", "text": "Nothing changed. " + "; ".join(problems) + "."})
            return
        folder = {s, *hub.folder_sessions(s.path)}
        if "permissionMode" in changes:
            for x in folder:
                await x.set_mode(changes["permissionMode"])
        if "model" in changes:
            for x in folder:
                await x.set_model(changes["model"])
        repo = Path(s.path).name
        await conn.send({"type": "notice", "text": f"{repo}: permissionMode={s.mode}, model={s.model}"
                         + ("" if changes else ". Change with /config permissionMode=default|auto|plan model=sonnet|opus")
                         + ". Only this repo's sessions; your global Claude Code settings are untouched."})


# Until the onboarding is done, the page can only check the setup and change settings.
SETUP_ONLY = {"setup_status", "get_settings", "set_settings", "mute", "voice_sample", "browse", "pick_folder"}


async def handle(conn: Conn, msg: dict) -> None:
    t = msg.get("type")
    if t == "browse":
        await conn.send(await asyncio.to_thread(setup.browse, msg.get("path")))
        return
    if t == "pick_folder":
        await conn.send(await setup.pick_native())
        return
    if t == "setup_status":
        ev = await setup.status()
        await conn.send(ev)
        if ev["auth"] != hub.auth:  # signed in (or out) since the last check
            hub.auth = ev["auth"]
            await asyncio.gather(*(c.send({"type": "features", **features()}) for c in hub.conns))
        return
    if not settings.settings["onboarded"] and t not in SETUP_ONLY:
        await conn.send({"type": "error", "text": "Finish the setup first."})
        return
    if t == "open_folder":
        await open_folder(conn, msg["path"], msg.get("session"))
        return
    if t == "add_folder":
        p = hub.allowed_folder(msg["path"])
        if p is None:
            await conn.send({"type": "error", "text": f"Not a folder, or not allowed: {msg['path']}"})
            return
        hub.store.add_folder(str(p))
        hub.scan()
        await open_folder(conn, str(p))
        return
    if t == "start_session":
        # "+ New" picker: a fresh session in any folder
        p = hub.allowed_folder(msg["path"])
        if p is None:
            await conn.send({"type": "error", "text": f"Not an allowed folder: {msg['path']}"})
            return
        await open_session(conn, str(p), hub.store.new_session(str(p)))
        return
    if t == "pin_folder":
        p = hub.allowed_folder(msg["path"])
        if p is not None:
            hub.store.set_pinned(str(p), bool(msg.get("pinned", True)))
            hub.scan()
            await hub.push_folders()
        return
    if t == "get_settings":
        await conn.send(await settings_event())
        return
    if t == "set_settings":
        values = msg.get("values") or {}
        settings.settings.update(values)
        if isinstance(msg.get("vocabulary"), str):
            path = config.STATE_DIR / "vocabulary.txt"
            path.write_text(msg["vocabulary"][:4000])
        if isinstance(msg.get("vocabulary"), str) or {"roots", "skip_names"} & set(values):
            hub.scan()  # new folders, or a new Whisper prompt
            await hub.push_folders()
        if {"roots", "vault", "brain", "routines", "onboarded", "stt", "tts"} & set(values):
            await asyncio.gather(*(c.send({"type": "features", **features()}) for c in hub.conns))
        if {"roots", "stt", "tts", "voice"} & set(values) and not values.get("onboarded"):
            await conn.send(await setup.status())  # the setup page shows the result at once
        await conn.send(await settings_event())
        return
    if t == "voice_sample":
        try:
            audio = await speech.synthesize("Hi, this is how I sound.", msg.get("voice"))
            await conn.send({"type": "voice_sample", "mime": "audio/mpeg", "data": base64.b64encode(audio).decode()})
        except Exception as e:  # noqa: BLE001
            await conn.send({"type": "error", "text": f"Kokoro: {e}"})
        return
    if t == "rescan":
        hub.scan()
        await hub.push_folders()
        return
    if t == "routines":
        # Panel opened: show what we have, check again if it's old. "refresh": the button.
        await conn.send(hub.routines.event())
        if not settings.settings["routines"]:
            return
        stale = time.time() - hub.routines.state["checked_at"] > routines.STALE_SECONDS
        if msg.get("refresh") or stale:
            asyncio.create_task(hub.routines.refresh())
        return
    if t == "routines_seen":
        await hub.routines.mark_seen()
        return
    if t == "mute":
        conn.muted = bool(msg.get("value"))
        return
    if not conn.folder or not conn.key:
        await conn.send({"type": "error", "text": "Pick a folder first."})
        return
    if t == "new_session":
        # A new session next to the others; the current one keeps running in the background.
        await open_session(conn, conn.folder, hub.store.new_session(conn.folder))
        return
    s = hub.session(conn.folder, conn.key)
    if t == "user_text":
        text = (msg.get("text") or "").strip()
        if (cmd := slash.local_command(text)) is not None:
            await run_local(conn, s, *cmd)
        elif text:
            if msg.get("interrupt") and s.busy and not s.pending:
                await s.interrupt()
            await s.send(text, "text")
            await hub.enforce_limits()
    elif t == "speech_start":
        s.voice.speech_start(bool(msg.get("echo_risk")))
        speech.warm_tts()
    elif t == "barge_in":
        # Speech over her: stop talking right away; the utterance follows. With an approval
        # card open the turn is not interrupted (that would deny the tool): it may be a yes/no.
        s.voice.speech_start()
        await s.speaker.reset()
        if s.busy and not s.pending:
            await s.interrupt()
    elif t == "speech_cancelled":
        s.voice.speech_cancelled()
    elif t == "utterance":
        await s.speaker.reset()
        await s.voice.utterance(base64.b64decode(msg["wav"]))
        await hub.enforce_limits()
    elif t == "voice_text":  # browser speech recognition: words instead of audio
        await s.speaker.reset()
        await s.voice.text(str(msg.get("text") or ""), echo_risk=msg.get("echo_risk") is not False)
        await hub.enforce_limits()
    elif t == "interrupt":
        await s.interrupt()
    elif t == "playback":
        await s.playback_report(str(msg.get("turn", "")), int(msg.get("vad_ms") or 0), int(msg.get("play_ms") or 0))
    elif t == "permission":
        await s.answer_permission(msg["id"], bool(msg.get("allow")), msg.get("answers"))
    elif t == "read_all":
        await s.speaker.reset()
        s.read_all(msg.get("text", ""))
    elif t == "dictate_note":
        s.voice.note_next = True
    elif t == "undo_request":
        await s.request_undo(msg.get("user_id"))
    elif t == "undo_confirm":
        await s.confirm_undo(msg["id"], bool(msg.get("ok")))
    elif t == "mcp_status":
        await conn.send({"type": "mcp", "folder": s.path, "session": s.key, "servers": await s.mcp_status()})
        await hub.push_folders()
    elif t == "mcp_reconnect":
        try:
            await s.reconnect_mcp(msg["name"])
        except Exception as e:  # noqa: BLE001
            await conn.send({"type": "error", "text": f"Reconnect {msg['name']} failed: {e}"})
        await conn.send({"type": "mcp", "folder": s.path, "session": s.key, "servers": await s.mcp_status()})
    elif t == "set_mode":
        # Per folder: applies to all of its sessions.
        mode = msg.get("mode", "default")
        for x in {s, *hub.folder_sessions(conn.folder)}:
            await x.set_mode(mode)
    elif t == "set_model":
        # Per folder, like the approvals mode: the front model of all its sessions.
        model = msg.get("model", "sonnet")
        for x in {s, *hub.folder_sessions(conn.folder)}:
            await x.set_model(model)
