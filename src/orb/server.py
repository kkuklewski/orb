"""FastAPI app: static page + one WebSocket that drives the folder sessions."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import datetime as dt
import logging
import secrets
import time
import uuid
from collections.abc import Awaitable
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketDisconnected
import hashlib
import json

from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers, MutableHeaders

from . import away, billing, chain, config, delegation, desk, folders, forget, handoff, home, intake, items, kokoro_setup, make_task, navigate, needs, parakeet, routines, settings, setup, slash, speech, tasks, tracker, triage, vault_write, vendor, vocab, worktree
from .agent import SCREEN_MAX, FolderSession, dumps, first_request
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
AUTH_TTL = 300  # seconds a Claude Code sign-in check counts for Needs you


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
        self.away = away.Clock(config.STATE_DIR / "away.json")  # the Away recap: when the owner last acted
        self.routines = routines.Watch(config.STATE_DIR / "routines.json", notify=self.routine_notice,
                                       push=self.push_routines)
        self.needs = needs.Needs(config.STATE_DIR / "needs.json", ask=lambda p: routines.ask_haiku(p, needs.MODEL),
                                 push=self.push_all)
        # Slash-command menus by folder (project skills differ), and the latest one for a folder
        # whose Claude Code hasn't started yet (user skills and built-ins are the same everywhere).
        self.commands: dict[str, list[dict]] = {}
        self.auth: dict = {}
        self.auth_at = 0.0
        self.background: set[asyncio.Task] = set()  # first requests of new sessions (handoff, Start in Orb, drops), drop jobs
        self.drops: dict[str, tuple[str, str]] = {}  # a drop's session key -> (drop id, its route); drop_done on its first turn's end
        self.jobs: set[asyncio.Task] = set()  # plan rankings
        self.results_sent: list[dict] | None = None  # the finished sessions the plan last got
        self.last_commands: list[dict] = []
        self.desk = desk.Sources(  # what the Home chat's tools read; live, so settings changes apply at once
            cfg=lambda: settings.settings.data, vault=settings.settings.vault,
            folders=lambda: self.folders or self.scan(),
            routines=self.live_routines,
            sessions=self.store.sessions)
        self.delegator = delegation.Delegator(
            config.STATE_DIR / "delegations.json", store=self.store, session=self.session, push=self.push_all,
            done=self.task_done, waiting=self.card_words,
            limit=lambda: int(settings.settings["delegation_limit"]))
        self.maker = make_task.Maker(cfg=lambda: settings.settings.data, vault=settings.settings.vault,
                                     inbox=lambda: settings.settings["tasks_inbox"])

    def card_words(self, key: str) -> str:
        """The card a session waits on, in its words ("" when none): a delegation's Needs you line shows it."""
        s = self.sessions.get(key)
        return next((ev.get("summary") or ev["tool"] for _, ev in s.pending.values()), "") if s else ""

    async def check_auth(self) -> None:
        """Which plan Claude Code is signed in with, for the sidebar (never the account itself)."""
        self.auth, self.auth_at = await setup.auth_status(), time.time()
        await asyncio.gather(*(c.send({"type": "features", **features()}) for c in self.conns))

    async def setup_problems(self, tasks_error: str | None) -> list[dict]:
        """What is broken in the setup, for Needs you: the sign-in (checked again when older than AUTH_TTL), the
        Tasks source's error and the speech engines the owner chose."""
        if time.time() - self.auth_at > AUTH_TTL:
            await self.check_auth()
        s = settings.settings
        engines = s["tts"] == "kokoro" or s["stt"] == "whisper"
        return needs.setup_problems(self.auth, tasks_error, s["stt"], s["tts"], await speech.health() if engines else {},
                                    parakeet.MODEL.is_file() and parakeet.LIB.is_file(), tracker.name(s.data))

    def commands_for(self, s: FolderSession) -> list[dict]:
        return s.commands or self.commands.get(s.path) or self.last_commands or slash.merge(None)

    # -- folders ----------------------------------------------------------------

    def scan(self) -> list[dict]:
        found: list[dict] = []
        for root in settings.settings.roots():
            if root.is_dir():
                found += [f.to_dict() for f in folders.discover(root) if f.path not in {x["path"] for x in found}]
        known = {f["path"] for f in found}
        vault = settings.settings.vault()
        if vault and vault.is_dir() and str(vault) not in known:  # the notes folder, when it's outside the roots
            found.append(folders.describe(vault, vault.parent).to_dict())
            known.add(str(vault))
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
            out.append({"key": e["key"], "label": e.get("label"), "created": e.get("created"), "last_used": e.get("last_used"),
                        "archived": bool(e.get("archived")),
                        "empty": not e.get("resume") and not (live and (live.busy or live.history)),
                        "status": live.status if live else "idle", "live": bool(live and live.live),
                        "ask": next((ev["summary"] for _, ev in live.pending.values()), None) if live else None,
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
        """A folder inside one of the user's roots or the notes folder, and not in a skipped folder; else None."""
        p = Path(path).expanduser().resolve()
        vault = settings.settings.vault()
        root = folders.root_of(p, settings.settings.roots() + ([vault] if vault else []))
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
                handoff=self.handoff,
                desk=self.desk,
                navigate=self.navigate,
            )
            self.sessions[key] = s
        return s

    async def start_task(self, conn: "Conn", path: str, brief: str) -> None:
        """"Start in Orb": a new session in `path` (already checked) whose first request is `brief`; this page follows it."""
        key = self.store.new_session(path)
        await open_session(conn, path, key)
        self._background(self.session(path, key).send(brief, "text"))

    def _background(self, coro) -> None:
        """Run `coro` without waiting for it; the set keeps the task alive until it ends."""
        task = asyncio.create_task(coro)
        self.background.add(task)
        task.add_done_callback(self.background.discard)

    async def run_drop(self, d: intake.Drop, vault: str) -> dict:
        """A routed drop, in the background (ADR 0009): its job in a thread, or a new notes session that starts on its
        request with the drop's grant. Every page hears drop_done when a job ends, or when the session's first turn
        ends or errs (drop_session_done); in between, its status is the drop's progress."""
        drop = uuid.uuid4().hex[:12]
        if d.job is not None:
            async def run(job=d.job) -> None:
                try:
                    done = await asyncio.to_thread(job)
                    ev = {"type": "drop_done", "id": drop, "ok": True, "text": done.text, "note": done.note}
                except intake.Refused as e:
                    ev = {"type": "drop_done", "id": drop, "ok": False, "text": str(e)}
                except Exception:
                    log.exception("drop job failed")
                    ev = {"type": "drop_done", "id": drop, "ok": False, "text": "The drop failed; see Orb's log."}
                await asyncio.gather(*(c.send(ev) for c in self.conns))
            self._background(run())
            return {"id": drop}
        key = self.store.new_session(vault)
        s = self.session(vault, key)
        s.grant = d.cover
        self.drops[key] = (drop, d.route)
        self._background(s.send(d.request, "text"))
        await self.push_folders()
        return {"id": drop, "session": key, "folder": vault}

    async def handoff(self, src: FolderSession, repo: str, brief: str) -> str:
        """`continue_in_repo`: a new session in another repo that starts on `brief`; pages showing the
        asking session follow it (it keeps running in the background)."""
        brief = brief.strip()
        if not brief:
            raise handoff.HandoffError("Write a brief: what the new session should do, and what you found.")
        target = handoff.resolve(self.folder_list(), repo)
        p = self.allowed_folder(target["path"])
        if p is None:
            raise handoff.HandoffError(f"Not an allowed folder: {target['path']}")
        if str(p) == src.path:
            raise handoff.HandoffError("That is this session's own repo: do the work here.")
        key = self.store.new_session(str(p))
        for c in [c for c in self.conns if c.key == src.key]:
            await open_session(c, str(p), key)  # first, so the request shows once, live
        text = (f"Handed over by Claude from a session in {self.label(src.path)}; the brief below was written by the model, "
                f"not typed by the user.\n\n{brief}")
        self._background(self.session(str(p), key).send(text, "text"))
        return (f"Started a new session in {self.label(str(p))} with your brief; the user's page moved there. "
                "Say one short line that you handed it over, and stop.")

    async def navigate(self, src: FolderSession, destination: str, item: str | None) -> str:
        """`open_screen`: the pages showing the asking session go where the owner asked; a refusal moves nothing."""
        ev, where = await asyncio.to_thread(navigate.resolve, self.desk, destination, item)
        targets = [c for c in self.conns if c.key == src.key]
        if not targets:
            raise navigate.NavigateError("No page shows this session right now, so nothing moved.")
        await asyncio.gather(*(c.send(ev) for c in targets))
        return f"The page now shows {where}. Don't describe it: a word or two at most."

    def folder_sessions(self, path: str) -> list[FolderSession]:
        return [s for s in self.sessions.values() if s.path == path]

    async def broadcast(self, key: str, ev: dict) -> None:
        if ev["type"] == "rate_limit":
            self.rate_limit = ev
        elif ev["type"] == "commands":
            self.commands[ev["folder"]] = self.last_commands = ev["items"]
        targets = [c for c in self.conns if c.key == key or ev["type"] == "rate_limit"]
        await asyncio.gather(*(c.send(ev) for c in targets))
        await self.delegator.on_event(key, ev)
        if key in self.drops and ev["type"] in ("result", "error"):
            await self.drop_session_done(key, ev)
        if ev["type"] in ("result", "session_info", "state", "permission", "permission_done", "user"):
            await self.push_folders()

    async def drop_session_done(self, key: str, ev: dict) -> None:
        """A drop's session ended its first turn (result) or hit an error: every page hears how the drop ended."""
        drop, route = self.drops.pop(key)
        if ev["type"] == "error" or ev.get("is_error"):
            done = {"ok": False, "text": str(ev.get("text") or "It stopped with an error; open it to see why.")[:300]}
        else:
            done = {"ok": True, "text": "Saved" if route == "link" else "Answered"}
        await asyncio.gather(*(c.send({"type": "drop_done", "id": drop, **done}) for c in self.conns))

    async def notify(self, s: FolderSession, kind: str) -> None:
        """A background session finished or needs approval: a sound and one spoken line on
        every page that is not showing it (the page queues it after any answer in progress).
        "tasks": a background task started or ended; only the sidebar and Activity change."""
        if kind == "tasks":
            await self.push_folders()
            return
        targets = [c for c in self.conns if c.key != s.key]
        d = self.delegator.of_session(s.key)
        if not targets or (d and kind == "done"):  # a delegation is never Finished: its stage line says Ready
            await self.push_folders()
            return
        name = spoken_name(self.label(s.path))
        text = f"{name} is done." if kind == "done" else f"{name} needs approval."
        if d:
            text = f"The delegation of task {d['task']} needs approval."
        audio = await notice_audio(text) if any(not c.muted for c in targets) else None
        ev = {"type": "bg_notice", "folder": s.path, "session": s.key, "kind": kind, "text": text,
              "label": self.label(s.path)}
        await asyncio.gather(*(c.send({**ev, "data": None if c.muted else audio, "mime": "audio/mpeg"})
                               for c in targets))
        await self.push_folders()

    async def task_done(self, task: int, on: bool) -> None:
        """A delegation's Apply (or its Undo): the tracker's task done (or open again), and the plan follows."""
        try:
            await asyncio.to_thread(tracker.set_done, settings.settings.data, task, on)
        except tracker.ERRORS as e:
            await self.push_all({"type": "notice", "level": "warn", "text": f"Task #{task} not changed in {tracker.name(settings.settings.data)}: {e}"})
            return
        await self.needs.mark("done", f"vikunja:{task}", dt.date.today().isoformat(), on=on)

    async def routine_notice(self, text: str) -> None:
        """A scheduled cloud agent needs the user: the same chime + spoken line, on every page."""
        if not self.conns:
            return
        audio = await notice_audio(text) if any(not c.muted for c in self.conns) else None
        ev = {"type": "bg_notice", "kind": "routine", "text": text}
        await asyncio.gather(*(c.send({**ev, "data": None if c.muted else audio, "mime": "audio/mpeg"})
                               for c in self.conns))

    async def push_all(self, ev: dict) -> None:
        await asyncio.gather(*(c.send(ev) for c in self.conns))

    async def push_routines(self) -> None:
        ev = self.routines.event()
        await asyncio.gather(*(c.send(ev) for c in self.conns))
        self.replan(routines=self.live_routines())  # a routine that just failed needs you now, not at the next Home refresh

    def live_routines(self) -> list[dict] | None:
        return self.routines.items() if settings.settings["routines"] else None

    def replan(self, force: bool = False, **facts: list[dict] | None) -> None:
        """New facts for the plan: every page gets the rule list at once; a ranking, if due, follows in the background."""
        job = asyncio.create_task(self.needs.update(dt.date.today().isoformat(), force=force, **facts))
        self.jobs.add(job)
        job.add_done_callback(self.jobs.discard)

    async def push_folders(self) -> None:
        items = self.folder_list()
        await asyncio.gather(*(c.send({"type": "folders", "items": items}) for c in self.conns))
        found = self.results(items)
        if found != self.results_sent:  # a session finished, or its answer was opened: the queue changes
            self.replan(results=found)

    def results(self, found: list[dict] | None = None) -> list[dict]:
        """Sessions that finished while nobody looked (their answer is unread), for the plan's queue."""
        out = [{"key": x["key"], "label": x["label"], "repo": f["label"].split("/")[-1], "last_used": x["last_used"]}
               for f in (found if found is not None else self.folder_list())
               for x in f["sessions"] if x["status"] == "done" and not x["archived"]]
        self.results_sent = out
        return out

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
            with contextlib.suppress(Exception):
                await self.delegator.tick()  # "Stuck 20 min"


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


def host_ok(host: str) -> bool:
    """A Host this server answers to: the port is ignored, the name must be one of config.HOSTS, or *.ts.net
    (Tailscale serve) in the personal profile."""
    name = (host.split("]")[0] + "]" if host.startswith("[") else host.rsplit(":", 1)[0]).lower()
    return name in config.HOSTS or (name.endswith(".ts.net") and not settings.settings.work)


class Guard:
    """Every request and response: a known Host (DNS rebinding), no raw HTML under /static (it would skip the
    page's CSP), and `nosniff` plus no framing on every response."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        if not host_ok(Headers(scope=scope).get("host", "")):
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            return await PlainTextResponse("Unknown host.", status_code=421)(scope, receive, send)
        path = scope.get("path", "").casefold()
        if scope["type"] == "http" and path.startswith("/static/") and path.endswith((".html", ".htm")):
            return await PlainTextResponse("Not found", status_code=404)(scope, receive, send)

        async def headed(message) -> None:
            if message["type"] == "http.response.start":
                h = MutableHeaders(scope=message)
                h.setdefault("X-Content-Type-Options", "nosniff")
                h.setdefault("X-Frame-Options", "DENY")
                if "content-security-policy" not in h:
                    h["Content-Security-Policy"] = "frame-ancestors 'none'"
            await send(message)

        await self.app(scope, receive, headed)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(Guard)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


CDN = "https://cdn.jsdelivr.net"


def csp(host: str, secure: bool, cdn: bool = True) -> str:
    """The page's policy. The React page bundles everything, so it gets no CDN at all."""
    ws = f"{'wss' if secure else 'ws'}://{host}"
    extra = f" {CDN}" if cdn else ""
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self'{extra} 'wasm-unsafe-eval'",  # CDN scripts carry SRI hashes
        f"style-src 'self'{extra} https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        f"connect-src 'self' {ws}",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",  # a form in rendered model output never submits anywhere
        "frame-ancestors 'none'",
    ])


def page(request: Request, html: str, cdn: bool) -> HTMLResponse:
    secure = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
    return HTMLResponse(html, headers={
        "Cache-Control": "no-store",
        "Content-Security-Policy": csp(request.headers.get("host", ""), secure, cdn=cdn),
        "Referrer-Policy": "no-referrer",
    })


@app.get("/")
@app.get("/chat")
@app.get("/sessions")
@app.get("/chats")
@app.get("/activity")
@app.get("/routines")
@app.get("/tasks")
@app.get("/brain")
@app.get("/settings")
@app.get("/vikunjas")
@app.get("/items/{route:path}")
@app.get("/s/{route:path}")
@app.get("/t/{route:path}")
@app.get("/r/{route:path}")
@app.get("/n/{route:path}")
async def index(request: Request, route: str = ""):
    """The React page (web/, built into static/app). Its own routes (/s/<session>, /settings, …) all get
    the same page; the page reads the path."""
    built = STATIC / "app" / "index.html"
    if not built.is_file():
        return PlainTextResponse("The page isn't built. Run: cd web && npm ci && npm run build", status_code=404)
    return page(request, built.read_text(), cdn=False)


@app.get("/old")
async def old_page(request: Request):
    """The previous page (plain JS), kept reachable until the React page has everything."""
    return page(request, (STATIC / "index.html").read_text().replace("__BUILD__", BUILD), cdn=True)


@app.get("/next")
@app.get("/next/{route:path}")
async def next_moved(request: Request, route: str = ""):
    """The React page used to live here; old bookmarks and links land on the same screen at /."""
    target = "/" + route.lstrip("/\\")  # /next//evil.com must not become the protocol-relative //evil.com
    if request.url.query:
        target += "?" + request.url.query
    return RedirectResponse(target, status_code=307)


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
    if config.DEV_ORIGIN and origin == config.DEV_ORIGIN:  # the Vite dev server, only when ORB_DEV_ORIGIN says so
        return True
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
                await owner_acted(msg)
                await handle(conn, msg)
            except Exception as e:  # noqa: BLE001
                log.exception("ws message %s", msg.get("type"))
                await conn.send({"type": "error", "text": str(e)})
    except (WebSocketDisconnect, WebSocketDisconnected):  # closed by the page, also before its first message
        pass
    finally:
        hub.conns.discard(conn)


def features() -> dict:
    """What the page shows: the user's folders, and the optional parts they turned on."""
    s = settings.settings
    return {"roots": s["roots"], "vault": str(s.vault() or ""), "brain": s["brain"], "routines": s["routines"], "profile": s["profile"],
            "onboarded": s["onboarded"], "stt": s["stt"], "tts": s["tts"], "plan": hub.auth.get("subscription"),
            "tracker": tracker.name(s.data), "drops": intake.labels(drop_env())}


def drop_env() -> intake.Env:
    """What Home's drop routes may count on, from the settings (intake.Env)."""
    s = settings.settings
    return intake.Env(s.vault(), bool(s["brain"]), s["transcript_script"], s["transcripts_folder"] or vault_write.TRANSCRIPTS)


async def settings_event() -> dict:
    vocab_file = config.STATE_DIR / "vocabulary.txt"
    installed = await speech.voices()
    return {"type": "settings", "values": settings.settings.view(), "voices": installed,
            "recommended": speech.recommended(installed, settings.settings["voice"]),
            "vocabulary": vocab_file.read_text() if vocab_file.exists() else "",
            "vocab_seed": vocab.SEED, "whisper_prompt": speech.PROMPT,
            "vault": str(settings.settings.vault() or ""), "port": config.PORT, "host": config.HOST}


def repo_of(path: str | None) -> tuple[str, str] | None:
    """(path, label) of a repo that is an allowed folder, else None. The page never names a path."""
    p = hub.allowed_folder(path) if path else None
    return (str(p), hub.label(str(p))) if p else None


def item_args() -> tuple[dict, object, list[dict]]:
    return settings.settings.data, settings.settings.vault(), hub.folders or hub.scan()


TASKS_BULK_MAX = 500
_jobs: set[asyncio.Task] = set()
triaging = False  # a priority-suggestion run is in progress (one at a time)


async def tasks_suggest(conn: "Conn") -> None:
    """Rate the open tasks with Haiku, then send the list again with the Suggested column filled."""
    global triaging
    if triaging:
        return
    triaging = True
    try:
        await item_list(conn, "vikunja")
        got = await asyncio.to_thread(tracker.open_tasks, settings.settings.data)
        await triage.suggest(got["tasks"], dt.date.today().isoformat(), lambda p: routines.ask_haiku(p, triage.MODEL))
    except (*tracker.ERRORS, RuntimeError, OSError) as e:
        await conn.send({"type": "error", "text": f"Couldn't suggest priorities: {e}"})
    finally:
        triaging = False
    await item_list(conn, "vikunja")


async def note_action(conn: "Conn", file: str, line: int, expect: str, action: str,
                      until: str | None = None, value: str | None = None) -> None:
    """One change to a notes task line; every page gets the new list and the plan follows."""
    vault = settings.settings.vault()
    try:
        ev = await asyncio.to_thread(tasks.act, vault, file, line, expect, action, until, value)
    except (tasks.TaskError, OSError, UnicodeDecodeError) as e:
        await conn.send({"type": "error", "text": str(e) if isinstance(e, tasks.TaskError) else f"Couldn't change the note: {e}"})
        return
    await conn.send(ev)
    summary = await asyncio.to_thread(home.summary, vault)
    await asyncio.gather(*(c.send(summary) for c in hub.conns))  # every page shows the new list
    hub.replan(notes=summary["tasks"], awaiting=summary["awaiting_count"])


async def item_list(conn: "Conn", source: str) -> None:
    """A table for the page: each row with the label of the repo it maps to (None = no repo here)."""
    try:
        got = await asyncio.to_thread(items.list_, source, *item_args())
    except items.ItemError as e:
        await conn.send({"type": "error", "text": str(e)})
        return
    memo: dict[str | None, tuple[str, str] | None] = {}
    for r in got["rows"]:
        path = r.pop("repo_path")
        if path not in memo:
            memo[path] = repo_of(path)
        r["repo"] = memo[path][1] if memo[path] else None
    if source == "vikunja":
        got["busy"] = triaging
    await conn.send({"type": "item_list", **got})


async def brain_list(conn: "Conn") -> None:
    vault = settings.settings.vault()
    if not vault:
        await conn.send({"type": "brain_list", "notes": [], "error": "No notes folder is set up."})
        return
    await conn.send({"type": "brain_list", "notes": await asyncio.to_thread(home.brain_notes, vault)})


async def brain_note(conn: "Conn", file: str) -> bool:
    try:
        n = await asyncio.to_thread(home.brain_note, settings.settings.vault(), file)
    except (tasks.TaskError, OSError) as e:
        await conn.send({"type": "error", "text": str(e) if isinstance(e, tasks.TaskError) else f"Couldn't open the note: {e}"})
        return False
    await conn.send({"type": "brain_note", **n})
    return True


def brain_read(file: str, seen: str) -> None:
    """owner_read once: only when the note has no verdict and owner_read still reads `seen`; a refusal is silent."""
    vault = settings.settings.vault()
    try:
        n = home.brain_note(vault, file)
        if not n["verdict"] and n["owner_read"] == seen == "":
            vault_write.set_owner_read(vault, file, seen)
    except (tasks.TaskError, OSError, UnicodeDecodeError):
        pass


async def item_get(conn: "Conn", source: str, item_id: str, start: bool) -> None:
    """One item for its page, or (start) a new session on it in the repo it maps to. The repo is worked out
    here, never taken from the page, and must be an allowed folder."""
    try:
        got = await asyncio.to_thread(items.get, source, item_id, *item_args())
    except items.ItemError as e:
        await conn.send({"type": "error", "text": str(e)})
        return
    repo = repo_of(got.pop("repo_path"))
    if start:
        vault = settings.settings.vault()
        where = repo[0] if repo else hub.allowed_folder(str(vault)) if vault else None  # no repo: the Home chat (notes folder)
        if where is None:
            await conn.send({"type": "error", "text": "This item has no repo here: copy the prompt instead."})
            return
        await hub.start_task(conn, str(where), got["brief"])
        return
    await conn.send({"type": "item", "source": source, "id": item_id, **got, "repo": repo[1] if repo else None})


async def owner_acted(msg: dict) -> None:
    """Every page message passes here first: a click or a message moves the Away recap's clock (away.ACTIONS), a page
    that only opens or reads does not. Back after 24 hours: every page's Home freezes the recap."""
    if msg.get("type") in away.ACTIONS and hub.away.acted():
        await hub.push_all(hub.away.event())


async def delegate(conn: Conn, task_id: int, path: str | None) -> None:
    """Delegate on a tracker task: the grant card. The repo comes from the repo map, or for an unmapped task from the
    picker (this delegation only; the notes are never edited); either way it must be an allowed folder."""
    cfg = settings.settings.data
    task = await asyncio.to_thread(tracker.task, cfg, task_id)
    mapped = await asyncio.to_thread(tracker.repo_path, cfg, settings.settings.vault(), task["project_id"])
    repo = repo_of(mapped) if mapped else repo_of(path)
    if repo is None:
        raise delegation.DelegationError("Its repo isn't an allowed folder here." if mapped or path else "Choose the repo to work in.")
    await conn.send(await asyncio.to_thread(hub.delegator.card, task, *repo))


async def delegate_bulk(conn: Conn, ids: list[int]) -> None:
    """Bulk Delegate: each task's mapped repo (a task without one is skipped and named), grouped by repo in the order
    the tasks came; the first repo's card now, the next after each answer."""
    cfg, vault = settings.settings.data, settings.settings.vault()
    groups: dict[str, tuple[list[dict], str, str]] = {}
    skipped: list[str] = []
    for tid in dict.fromkeys(ids):
        task = await asyncio.to_thread(tracker.task, cfg, tid)
        mapped = await asyncio.to_thread(tracker.repo_path, cfg, vault, task["project_id"])
        repo = repo_of(mapped) if mapped else None
        if repo is None:
            skipped.append(f"Task #{tid} has no repo here.")
            continue
        groups.setdefault(str(repo[0]), ([], str(repo[0]), repo[1]))[0].append(task)
    await bulk_next(conn, list(groups.values()), skipped)


async def bulk_next(conn: Conn, groups: list, skipped: list[str] | None = None) -> None:
    card, more = await asyncio.to_thread(hub.delegator.bulk, groups)
    if skipped := [*(skipped or []), *more]:
        await conn.send({"type": "notice", "level": "warn", "text": " ".join(skipped)})
    if card:
        await conn.send(card)


async def delegate_confirm(conn: Conn, cid: str, ok: bool) -> None:
    """The card's answer; on a bulk card the next repo's card follows either way."""
    rest = hub.delegator.then(cid)
    never = {*settings.settings["skip_names"], "secrets"}  # never-open names stay out of the snapshot, like the fence
    try:
        await hub.delegator.confirm(cid, ok, never)
    finally:
        if rest:
            await bulk_next(conn, rest)


async def delegation_step(conn: Conn, step: Awaitable[object]) -> None:
    """One delegation step for a page; a refusal comes back as its error line."""
    try:
        await step
    except (delegation.DelegationError, worktree.WorktreeError, *tracker.ERRORS, ValueError, OSError) as e:
        await conn.send({"type": "error", "text": str(e)})


async def discard(conn: Conn, rid: str) -> None:
    if left := await hub.delegator.discard(rid):
        await conn.send({"type": "notice", "level": "warn", "text": "Left behind: " + ", ".join(left)})


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
    p = hub.allowed_folder(path) or ((d := hub.delegator.folder(path)) and Path(d))  # a delegation's worktree too
    if p is None:
        await conn.send({"type": "error", "text": f"Not an allowed folder: {path}"})
        return
    await open_session(conn, str(p), hub.store.open(str(p), key))


async def change_session(conn: Conn, t: str, path: str, key: str, archived: bool) -> None:
    """Archive / restore / remove one session. Never one with a running turn or an open card."""
    p = hub.allowed_folder(path)
    if p is None or key not in {x["key"] for x in hub.store.sessions(str(p))}:
        return
    path = str(p)
    live = hub.sessions.get(key)
    hiding = t == "remove_session" or archived
    if hiding and live is not None and (live.busy or live.status == "approval"):
        await conn.send({"type": "error", "text": "That session is working. Stop it first."})
        return
    if t == "remove_session":
        hub.store.remove(path, key)
    else:
        hub.store.set_archived(path, key, bool(archived))
    if hiding and live is not None:
        hub.sessions.pop(key, None)
        await live.close()
    if hiding:
        for c in [c for c in hub.conns if c.key == key]:  # pages showing it move to the folder's next session
            await open_session(c, path, hub.store.open(path))
    await hub.push_folders()


async def run_local(conn: Conn, s: FolderSession, name: str, args: str) -> None:
    """A slash command the dashboard runs itself (slash.LOCAL); nothing goes to the model."""
    if name == "clear":
        # Like the New session button: a fresh session here, the current one keeps running.
        await open_session(conn, s.path, hub.store.new_session(s.path))
    elif name == "model":
        want = args.lower().strip()
        want = "sonnet" if want == "sonet" else want
        if not want:
            await conn.send({"type": "notice", "text": f"Front model: {s.model}. /model haiku, sonnet or opus switches it."})
        elif want not in chain.MODELS:
            await conn.send({"type": "notice", "level": "warn",
                             "text": f"Unknown front model {args!r}: use haiku, sonnet or opus."})
        else:
            for x in {s, *hub.folder_sessions(s.path)}:  # per folder, like the header chip
                await x.set_model(want)
            await conn.send({"type": "notice", "text": f"Front model: {want}."})
    elif name == "mcp":
        await conn.send({"type": "mcp", "folder": s.path, "session": s.key, "servers": await s.mcp_status(), "open": True})
        await hub.push_folders()
    elif name in desk.SLASH_NAMES:
        if not s.is_desk:
            await conn.send({"type": "notice", "level": "warn", "text": f"/{name} works in the Home chat (your notes folder) only."})
            return
        try:
            msg = await asyncio.to_thread(desk.slash_message, s.sources, name, args)
        except desk.DeskError as e:
            await conn.send({"type": "notice", "level": "warn", "text": str(e)})
            return
        before, s.screen = s.screen, (msg.screen, msg.data)  # the data rides as the screen note: not in the bubble
        try:
            await s.send(msg.ask, "text")
        finally:
            s.screen = before
        await hub.enforce_limits()
    elif name == "rewind":
        await s.request_undo(None)
    elif name == "config":
        # Per repo, like the header chips; never Claude Code's own /config (global settings.json).
        changes, problems = slash.parse_config(args)
        if problems:
            await conn.send({"type": "notice", "level": "warn", "text": "Nothing changed. " + "; ".join(problems) + "."})
            return
        if changes.get("outwardSteps") == "on" and s.fence.in_client():
            await conn.send({"type": "notice", "level": "warn",
                             "text": "Nothing changed. outwardSteps stays off in a client folder: push and PRs always ask."})
            return
        folder = {s, *hub.folder_sessions(s.path)}
        if "permissionMode" in changes:
            for x in folder:
                await x.set_mode(changes["permissionMode"])
        if "model" in changes:
            for x in folder:
                await x.set_model(changes["model"])
        if "outwardSteps" in changes:
            hub.store.set_outward(s.path, changes["outwardSteps"] == "on")
        if "trustSettings" in changes:
            for x in folder:
                await x.set_trusted(changes["trustSettings"] == "on")
            hub.store.set_trusted(s.path, changes["trustSettings"] == "on")  # also with no session open
        if "applyMode" in changes:
            hub.store.set_apply_mode(s.path, changes["applyMode"])
        for kind in ("test", "build"):
            if kind in changes:
                hub.store.set_command(s.path, kind, changes[kind])
        repo = Path(s.path).name
        cmds = hub.store.commands(s.path)
        shown = ", ".join(f"{k}={json.dumps(v) if v else '(none)'}" for k, v in cmds.items())
        await conn.send({"type": "notice", "text": f"{repo}: permissionMode={s.mode}, model={s.model}, "
                         f"outwardSteps={'on' if hub.store.outward(s.path) else 'off'}"
                         + (" (client folder: always off)" if s.fence.in_client() else "")
                         + f", trustSettings={'on' if hub.store.trusted(s.path) else 'off'}"
                         + f", applyMode={hub.store.apply_mode(s.path)}, {shown}"
                         + ("" if changes else ". Change with /config permissionMode=default|auto|plan model=haiku|sonnet|opus"
                            " outwardSteps=on|off trustSettings=on|off applyMode=squash|merge test=\"…\" build=\"…\"")
                         + ". Only this repo's sessions; your global Claude Code settings are untouched."})


# Until the onboarding is done, the page can only check the setup and change settings.
SETUP_ONLY = {"setup_status", "get_settings", "set_settings", "mute", "voice_sample", "browse", "pick_folder",
              "kokoro_setup"}


async def handle(conn: Conn, msg: dict) -> None:
    t = msg.get("type")
    if t == "browse":
        await conn.send(await asyncio.to_thread(setup.browse, msg.get("path")))
        return
    if t == "pick_folder":
        await conn.send(await setup.pick_native())
        return
    if t == "kokoro_setup":  # the click is the approval; the page polls setup_status for the progress
        kokoro_setup.start()
        t = "setup_status"
    if t == "setup_status":
        ev = await setup.status()
        await conn.send(ev)
        hub.auth_at = time.time()
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
    if t == "archive_session":
        await change_session(conn, t, str(msg.get("folder") or ""), str(msg.get("key") or ""), bool(msg.get("archived", True)))
        return
    if t == "remove_session":
        await change_session(conn, t, str(msg.get("folder") or ""), str(msg.get("key") or ""), True)
        return
    if t == "get_settings":
        await conn.send(await settings_event())
        return
    if t == "set_settings":
        values = msg.get("values") or {}
        before = {k: settings.settings[k] for k in ("profile", "brain", "connectors")}
        settings.settings.update(values)
        if any(settings.settings[k] != v for k, v in before.items()):  # the fence and the connectors change
            for x in list(hub.sessions.values()):
                await x.refresh()
        if isinstance(msg.get("vocabulary"), str):
            path = config.STATE_DIR / "vocabulary.txt"
            config.write_private(path, msg["vocabulary"][:4000])
        if isinstance(msg.get("vocabulary"), str) or {"roots", "skip_names"} & set(values):
            hub.scan()  # new folders, or a new Whisper prompt
            await hub.push_folders()
        if {"routines_judge", "routines_notify"} & set(values):
            await hub.push_routines()  # every page shows who notifies now
        if {"roots", "vault", "brain", "routines", "onboarded", "stt", "tts", "vikunja_url", "jira_url", "profile"} & set(values):
            await asyncio.gather(*(c.send({"type": "features", **features()}) for c in hub.conns))
        if {"roots", "vault", "stt", "tts", "profile"} & set(values) and not values.get("onboarded"):
            await conn.send(await setup.status())  # the setup page shows the result at once
        await conn.send(await settings_event())
        return
    if t == "voice_sample":
        voice = msg.get("voice") or settings.settings["voice"]
        try:
            audio = await speech.synthesize("Hi, this is how I sound.", voice)
            await conn.send({"type": "voice_sample", "voice": voice, "mime": "audio/mpeg", "data": base64.b64encode(audio).decode()})
        except Exception as e:  # noqa: BLE001 - the page shows it on the voice it asked for
            await conn.send({"type": "voice_sample", "voice": voice, "error": speech.tts_error(e)})
        return
    if t == "drop":
        # Home's drop zone (ADR 0009): a link or a file -> a job Orb runs, or a background session in the notes folder
        # with the drop's grant. The page stays where it is; drop_done says how it ended.
        vault = settings.settings.vault()
        env = drop_env()
        try:
            if not vault:
                raise intake.Refused("Set the Brain folder in Settings first: drops run in your notes.")
            if msg.get("data") is not None:
                data = base64.b64decode(str(msg["data"]), validate=True)
                d = await asyncio.to_thread(intake.route_file, str(msg.get("name") or "drop"), data, env)
            else:
                d = intake.route_link(str(msg.get("url") or ""), env)
        except (intake.Refused, ValueError) as e:
            text = str(e) if isinstance(e, intake.Refused) else "The file didn't arrive whole; try again."
            await conn.send({"type": "drop_routed", "ok": False, "text": text})
            return
        await conn.send({"type": "drop_routed", "ok": True, "route": d.route, "text": d.label,
                         **await hub.run_drop(d, str(vault))})
        return
    if t == "rescan":
        hub.scan()
        await hub.push_folders()
        return
    if t == "home":
        await conn.send(hub.away.event())
        await conn.send(hub.delegator.event())
        notes = await asyncio.to_thread(home.summary, settings.settings.vault())
        await conn.send(notes)
        # Git and gh (Don't forget), then the tracker (the Tasks source) are slower than the notes: events of their own.
        w = await asyncio.to_thread(forget.summary, settings.settings.data, hub.folders or hub.scan())
        await conn.send(w)
        cfg = settings.settings.data
        src = await asyncio.to_thread(tracker.source, cfg) if tracker.wanted(cfg) else None
        await conn.send(tracker.home_event(src))
        # Then the plan: the rule lists at once, a new ranking in the background when it changed.
        open_ = src["tasks"] if src else []
        mine = triage.current(open_, triage.load())  # the suggested priority stands in where the tracker has none
        repos = {pid: repo_of(path) for pid, path in (await asyncio.to_thread(tracker.repo_map, cfg, settings.settings.vault())).items()}
        hub.replan(setup=await hub.setup_problems(src and src["error"]), reminders=forget.due_now(settings.settings.data),
                   tasks=[{**x, "suggested": (mine.get(x["id"]) or {}).get("p"), "repo": (repos.get(x.get("project_id")) or (None, None))[1]}
                          for x in open_], routines=hub.live_routines(),
                   notes=notes["tasks"], awaiting=notes["awaiting_count"], prs=w.get("prs") or [], results=hub.results(),
                   force=bool(msg.get("rerank")))
        return
    if t == "away_seen":  # the Away recap was closed, or Home left: gone on every page
        if hub.away.seen():
            await hub.push_all(hub.away.event())
        return
    if t == "plan_start":
        await hub.needs.mark("started", str(msg["key"]), dt.date.today().isoformat())
        return
    if t == "plan_later":
        await hub.needs.mark("later", str(msg["key"]), dt.date.today().isoformat())
        return
    if t == "plan_done":
        # Done on a queue task: the tracker's is written there at once (Undo opens it again); a notes task gets its line
        # ticked like on the task screen, and that toast's Undo puts the line back.
        key, undo = str(msg["key"]), bool(msg.get("undo"))
        if key.startswith("vikunja:"):
            try:
                await asyncio.to_thread(tracker.set_done, settings.settings.data, int(key.split(":", 1)[1]), not undo)
            except (*tracker.ERRORS, ValueError) as e:
                await conn.send({"type": "error", "text": str(e)})
                return
            await hub.needs.mark("done", key, dt.date.today().isoformat(), on=not undo)
            return
        n = hub.needs.note(key) if key.startswith("note:") and not undo else None
        if not n:
            await conn.send({"type": "error", "text": "Only tasks can be marked done here." if not key.startswith("note:") else "That task changed. Open Home again."})
            return
        await note_action(conn, n["file"], int(n["line"]), n["raw"], "done")
        return
    if t == "task_detail":
        try:
            await conn.send(await asyncio.to_thread(tasks.detail, settings.settings.vault(), msg["file"], int(msg["line"])))
        except (tasks.TaskError, OSError) as e:
            await conn.send({"type": "error", "text": str(e) if isinstance(e, tasks.TaskError) else f"Couldn't read the note: {e}"})
        return
    if t == "item_list":
        await item_list(conn, msg["source"])
        return
    if t == "item_get":
        await item_get(conn, msg["source"], str(msg["id"]), start=False)
        return
    if t == "item_done":
        if msg["source"] != "vikunja":
            await conn.send({"type": "error", "text": "Only tracker tasks can be archived."})
            return
        try:
            await asyncio.to_thread(tracker.set_done, settings.settings.data, int(msg["id"]), bool(msg.get("done", True)))
        except (*tracker.ERRORS, ValueError) as e:
            await conn.send({"type": "error", "text": str(e)})
            return
        await item_list(conn, "vikunja")
        return
    if t == "tasks_bulk":
        cfg = settings.settings.data
        ids = [str(i) for i in msg["ids"]][:TASKS_BULK_MAX]
        if (msg.get("done") is None) == (msg.get("priority") is None):
            await conn.send({"type": "error", "text": "Choose Archive or a priority."})
            return

        def apply() -> str | None:
            for i in ids:
                try:
                    if msg.get("done") is not None:
                        tracker.set_done(cfg, int(i), bool(msg["done"]))
                    else:
                        tracker.set_priority(cfg, int(i), int(msg["priority"]))
                except (*tracker.ERRORS, ValueError) as e:
                    return str(e)
            return None

        problem = await asyncio.to_thread(apply)
        if problem:
            await conn.send({"type": "error", "text": problem})
        await item_list(conn, "vikunja")
        return
    if t == "tasks_suggest":
        job = asyncio.create_task(tasks_suggest(conn))  # takes a while: don't hold up the socket
        _jobs.add(job)
        job.add_done_callback(_jobs.discard)
        return
    if t == "notes_verdict":
        try:
            seen = {str(n["file"]): str(n.get("seen") or "") for n in msg["notes"]}
            await asyncio.to_thread(vault_write.set_verdict, settings.settings.vault(), seen, msg["verdict"])
        except (tasks.TaskError, OSError, UnicodeDecodeError) as e:
            await conn.send({"type": "error", "text": str(e) if isinstance(e, tasks.TaskError) else f"Couldn't change the notes: {e}"})
            return
        await item_list(conn, "notes")
        return
    if t == "brain_list":
        await brain_list(conn)
        return
    if t == "brain_get":
        await brain_note(conn, str(msg["file"]))
        return
    if t == "brain_apply":
        try:
            applied, refused = await asyncio.to_thread(vault_write.set_verdicts, settings.settings.vault(), msg["notes"])
        except tasks.TaskError as e:
            await conn.send({"type": "error", "text": str(e)})
            return
        await conn.send({"type": "brain_applied", "applied": applied, "refused": refused})
        await brain_list(conn)
        return
    if t == "brain_verdict":
        try:
            await asyncio.to_thread(vault_write.set_verdict, settings.settings.vault(), {str(msg["file"]): str(msg.get("seen") or "")}, msg["verdict"])
        except (tasks.TaskError, OSError, UnicodeDecodeError) as e:
            await conn.send({"type": "error", "text": str(e) if isinstance(e, tasks.TaskError) else f"Couldn't change the note: {e}"})
            return
        if await brain_note(conn, str(msg["file"])):
            await brain_list(conn)
        return
    if t == "brain_read":
        await asyncio.to_thread(brain_read, str(msg["file"]), str(msg.get("seen") or ""))
        await brain_list(conn)
        return
    if t == "item_start":
        await item_get(conn, msg["source"], str(msg["id"]), start=True)
        return
    if t == "task_action":
        await note_action(conn, msg["file"], int(msg["line"]), msg["expect"], msg["action"], msg.get("until"), msg.get("value"))
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
        await hub.routines.mark_seen(msg.get("id"), bool(msg.get("all")))
        return
    if t == "routines_resolve":
        await hub.routines.resolve(str(msg["id"]), bool(msg.get("undo")))
        return
    if t == "make_task":
        x = next((r for r in hub.routines.items() if r["id"] == msg["routine"]), None)
        await conn.send(await asyncio.to_thread(hub.maker.card, x))
        return
    if t == "make_task_confirm":
        await conn.send(await asyncio.to_thread(hub.maker.confirm, str(msg["id"]), bool(msg["ok"])))
        return
    if t == "make_task_undo":
        await conn.send(await asyncio.to_thread(hub.maker.undo, int(msg["task"])))
        return
    if t == "mute":
        conn.muted = bool(msg.get("value"))
        return
    if t == "delegate":
        await delegation_step(conn, delegate(conn, int(msg["task"]), msg.get("path")))
        return
    if t == "delegate_bulk":
        await delegation_step(conn, delegate_bulk(conn, [int(x) for x in msg.get("tasks") or []][:50]))
        return
    if t == "delegate_confirm":
        await delegation_step(conn, delegate_confirm(conn, str(msg["id"]), bool(msg["ok"])))
        return
    if t == "delegation_review":
        await delegation_step(conn, hub.delegator.diff(str(msg["id"]), conn.send))
        return
    if t == "delegation_apply":
        await delegation_step(conn, hub.delegator.apply(str(msg["id"]), hub.store.apply_mode))
        return
    if t == "delegation_revert":
        await delegation_step(conn, hub.delegator.revert(str(msg["id"])))
        return
    if t == "delegation_discard":
        await delegation_step(conn, discard(conn, str(msg["id"])))
        return
    if t == "delegation_retry":
        await delegation_step(conn, hub.delegator.retry(str(msg["id"])))
        return
    if t == "delegation_resume":
        await delegation_step(conn, hub.delegator.resume(str(msg["id"])))
        return
    if t == "delegation_outward":
        await delegation_step(conn, hub.delegator.outward(str(msg["id"]), bool(msg["allow"])))
        return
    if t == "revoke_grant":
        # From any page (the Delegated strip lives on Home): that session's calls ask again from the next one.
        target = hub.sessions.get(str(msg.get("session") or ""))
        if target is None or not await target.revoke_grant():
            await conn.send({"type": "notice", "level": "warn", "text": "That session has no grant to revoke."})
            return
        hub.delegator.revoked(target.key)
        return
    if not conn.folder or not conn.key:
        await conn.send({"type": "error", "text": "Pick a folder first."})
        return
    if t == "new_session":
        # A new session next to the others; the current one keeps running in the background.
        await open_session(conn, conn.folder, hub.store.new_session(conn.folder))
        return
    s = hub.session(conn.folder, conn.key)
    if t == "screen":
        name, text = msg.get("name"), str(msg.get("text") or "")[:SCREEN_MAX]
        s.screen = (str(name)[:40], text) if name and text.strip() else None
        return
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
