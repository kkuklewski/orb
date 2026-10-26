import asyncio
import base64
import json
import os
import subprocess
import time

import pytest

from orb import intake, vault_write

SCRIPT = "tools/fetch-transcript.sh"
FAKE_FETCH = """#!/usr/bin/env bash
printf '%s' '{"status":"ok","videoId":"dQw4w9WgXcQ","title":"Acme: a \\"quoted\\" talk","language":"en","transcript":"Hello from acme."}' > "$2"
"""


def git(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def vault(tmp_path):
    v = tmp_path / "notes"
    script = v / SCRIPT
    script.parent.mkdir(parents=True)
    script.write_text(FAKE_FETCH)
    return v


@pytest.fixture
def repo(vault, tmp_path):
    """The vault as a git repo with a bare remote, plus the owner's own unfinished work in it."""
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    git(vault, "init", "-q", "-b", "main")
    git(vault, "config", "user.email", "owner@acme.example")
    git(vault, "config", "user.name", "Owner")
    (vault / "a.md").write_text("one\n")
    git(vault, "add", "-A")
    git(vault, "commit", "-qm", "start")
    git(vault, "remote", "add", "origin", str(remote))
    git(vault, "push", "-qu", "origin", "main")
    (vault / "a.md").write_text("owner's edit\n")  # unstaged
    (vault / "b.md").write_text("staged\n")
    git(vault, "add", "b.md")
    return vault, remote


def env(vault, brain=True):
    return intake.Env(vault, brain, SCRIPT)


def test_youtube_ids_come_from_every_link_shape():
    for url in ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ?si=x",
                "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ",
                "https://youtube.com/live/dQw4w9WgXcQ", "https://music.youtube.com/watch?v=dQw4w9WgXcQ"):
        assert intake.youtube_id(url) == "dQw4w9WgXcQ", url
    for url in ("https://www.youtube.com/@acme", "https://youtu.be/short", "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
                "https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/watch?v=dQw4w9WgXcQ%0A"):
        assert intake.youtube_id(url) is None, url


def test_a_youtube_link_is_a_job_for_orb_not_a_session(vault):
    d = intake.route_link(" https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1 ", env(vault))
    assert d.route == "youtube" and d.job is not None and not d.request and d.cover is None


def test_the_transcript_job_saves_one_note_and_commits_only_it(repo):
    vault, remote = repo
    done = intake.route_link("https://youtu.be/dQw4w9WgXcQ", env(vault)).job()
    assert done.text == 'Saved: Acme: a "quoted" talk' and done.note.startswith("scrapers/Transcripts/")
    text = (vault / done.note).read_text()
    assert 'title: "Acme: a \\"quoted\\" talk"' in text and 'lang: "en"' in text and text.endswith("Hello from acme.\n")
    assert git(remote, "show", "--stat", "--format=%s", "main").split()[:2] == ["transcript:", "Acme:"]
    assert git(remote, "show", "--name-only", "--format=", "main").split() == [done.note]  # nothing of the owner's
    assert git(vault, "status", "--short").splitlines() == [" M a.md", "A  b.md"]
    with pytest.raises(intake.Refused, match="Already saved"):
        intake.route_link("https://youtu.be/dQw4w9WgXcQ", env(vault)).job()


def test_a_push_that_fails_keeps_the_note_and_says_so(repo, tmp_path):
    vault, remote = repo
    other = tmp_path / "other"
    subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True)
    (other / "c.md").write_text("vps\n")
    git(other, "add", "-A")
    git(other, "-c", "user.email=v@acme.example", "-c", "user.name=V", "commit", "-qm", "vps")
    git(other, "push", "-q")
    done = intake.route_link("https://youtu.be/dQw4w9WgXcQ", env(vault)).job()
    assert "not pushed: your vault is behind GitHub" in done.text and (vault / done.note).is_file()



def test_owner_commits_that_are_not_pushed_yet_stay_local(repo):
    vault, remote = repo
    git(vault, "commit", "-qm", "owner's draft", "--", "b.md")
    before = git(remote, "rev-parse", "main")
    done = intake.route_link("https://youtu.be/dQw4w9WgXcQ", env(vault)).job()
    assert "not pushed: other unpushed commits" in done.text and (vault / done.note).is_file()
    assert git(remote, "rev-parse", "main") == before

def test_a_failing_fetch_is_refused_and_writes_nothing(repo):
    vault, _ = repo
    (vault / SCRIPT).write_text("""printf '%s' '{"status":"error","error":"no captions"}' > "$2"\n""")
    git(vault, "commit", "-qm", "fetch", "--", SCRIPT)
    with pytest.raises(intake.Refused, match="no captions"):
        intake.route_link("https://youtu.be/dQw4w9WgXcQ", env(vault)).job()
    assert not (vault / vault_write.TRANSCRIPTS).exists()


def test_the_fetch_script_runs_only_as_committed(repo, tmp_path):
    vault, _ = repo
    marker = tmp_path / "ran"
    (vault / SCRIPT).write_text(f"touch {marker}\n")  # a session's edit, not committed
    with pytest.raises(intake.Refused, match="uncommitted changes"):
        intake.route_link("https://youtu.be/dQw4w9WgXcQ", env(vault)).job()
    git(vault, "checkout", "--", SCRIPT)
    (vault / "tools" / "new.sh").write_text(FAKE_FETCH)  # never committed
    with pytest.raises(intake.Refused, match="isn't committed"):
        intake.route_link("https://youtu.be/dQw4w9WgXcQ", intake.Env(vault, True, "tools/new.sh")).job()
    git(vault, "config", "core.fsmonitor", f"touch {marker} #")  # git would run it on status / diff
    with pytest.raises(intake.Refused, match="core.fsmonitor"):
        intake.route_link("https://youtu.be/dQw4w9WgXcQ", env(vault)).job()
    assert not marker.exists() and not (vault / vault_write.TRANSCRIPTS).exists()


def test_a_vault_git_config_that_runs_commands_stops_the_commit(repo, tmp_path):
    vault, remote = repo
    for key, value in (("filter.x.clean", "cat"), ("core.sshCommand", "ssh -v"), ("includeIf.gitdir:~/.path", "x"),
                       ("remote.origin.receivepack", "x")):
        git(vault, "config", key, value)
        assert key.split(".")[0].lower() in (vault_write.unsafe_config(vault) or "").lower()
        assert not vault_write.commit_new(vault, "a.md", "x")
        git(vault, "config", "--unset", key)
    assert vault_write.unsafe_config(vault) is None
    assert git(vault, "status", "--short").splitlines() == [" M a.md", "A  b.md"]  # nothing staged or committed


def test_the_script_and_the_folder_stay_inside_the_vault(vault, tmp_path):
    outside = tmp_path / "evil.sh"
    outside.write_text(FAKE_FETCH)
    for script in ("../evil.sh", str(outside), ""):
        assert intake.route_link("https://youtu.be/dQw4w9WgXcQ", intake.Env(vault, True, script)).route == "link"
    (vault / "tools" / "link.sh").symlink_to(outside)
    assert intake.route_link("https://youtu.be/dQw4w9WgXcQ", intake.Env(vault, True, "tools/link.sh")).route == "link"
    for folder in ("../out", "/tmp/out", ".git/x", ""):
        with pytest.raises(vault_write.TaskError, match="inside the vault"):
            vault_write.new_transcript(vault, "dQw4w9WgXcQ", "t", "", "x", folder=folder)
    (vault / "away").symlink_to(tmp_path)
    with pytest.raises(vault_write.TaskError, match="inside the vault"):
        vault_write.new_transcript(vault, "dQw4w9WgXcQ", "t", "", "x", folder="away/sub")


def test_the_legend_says_what_this_install_can_do(vault, tmp_path):
    assert intake.labels(env(vault))[:2] == ["YouTube → transcript", "Link → saved to Brain"]
    assert intake.labels(intake.Env(tmp_path, False))[0] == "Link → summary"
    assert "PDF → read and sorted" in intake.labels(env(vault))


def test_a_drops_grant_covers_only_its_own_link_and_file():
    g = intake.DropGrant(url="https://blog.acme.example/post", capture=True)
    assert g.covers("WebFetch", {"url": "https://blog.acme.example/post/", "prompt": "title"})
    assert not g.covers("WebFetch", {"url": "https://globex.example/"})
    assert not g.covers(intake.CAPTURE_TOOL, {"kind": "thought", "text": "https://blog.acme.example/post"})
    assert not g.covers(intake.CAPTURE_TOOL, {"kind": "link", "url": "https://globex.example/"})
    assert not g.covers(intake.CAPTURE_TOOL, {"kind": "link", "url": "https://globex.example/", "text": "https://blog.acme.example/post"})
    assert g.covers(intake.CAPTURE_TOOL, {"kind": "link", "url": "https://blog.acme.example/post", "text": "A post"})
    assert not g.covers(intake.CAPTURE_TOOL, {"kind": "link", "url": "https://blog.acme.example/post"})  # once
    assert not g.covers("Bash", {"command": "curl https://blog.acme.example/post"})
    summary = intake.DropGrant(url="https://blog.acme.example/post")  # the summary route: read it, save nothing
    assert summary.covers("WebFetch", {"url": "https://blog.acme.example/post"})
    assert not summary.covers(intake.CAPTURE_TOOL, {"kind": "link", "url": "https://blog.acme.example/post", "text": "A post"})
    f = intake.DropGrant(file="/tmp/drops/x.md")
    assert f.covers("Read", {"file_path": "/tmp/drops/x.md"}) and not f.covers("Read", {"file_path": "/tmp/drops/y.md"})
    assert not f.covers("Write", {"file_path": "/tmp/drops/x.md"}) and not f.covers("WebFetch", {"url": "x"})


def test_without_the_script_a_youtube_link_is_an_ordinary_link(tmp_path):
    d = intake.route_link("https://youtu.be/dQw4w9WgXcQ", intake.Env(tmp_path, brain=True))
    assert d.route == "link"


def test_an_https_link_goes_to_brain_capture_and_without_the_connector_is_summarised(vault):
    d = intake.route_link("https://blog.acme.example/post", env(vault))
    assert d.route == "link" and 'kind="link"' in d.request and "https://blog.acme.example/post" in d.request
    assert d.cover == intake.DropGrant(url="https://blog.acme.example/post", capture=True)
    page = intake.route_link("https://blog.acme.example/post", env(vault, brain=False))
    assert page.route == "page" and page.cover == intake.DropGrant(url="https://blog.acme.example/post")
    assert intake.route_link("http://blog.acme.example/post", env(vault)).route == "page"  # capture takes https only


@pytest.mark.parametrize("text", ["", "hello there", "ftp://acme.example/x", "https://", "https://a.example/x https://b.example",
                                  "javascript:alert(1)", "https://acme.example/" + "x" * 3000])
def test_anything_but_one_web_link_is_refused(vault, text):
    with pytest.raises(intake.Refused):
        intake.route_link(text, env(vault))


def test_a_file_is_saved_privately_under_a_clean_name_and_named_in_the_request(vault, tmp_path):
    drops = tmp_path / "drops"
    d = intake.route_file("../../Notes from call (v2).md", b"# hi", env(vault), folder=drops, now=0)
    saved = list(drops.iterdir())
    assert len(saved) == 1 and saved[0].parent == drops and saved[0].name.endswith("-Notes-from-call-v2.md")
    assert saved[0].read_bytes() == b"# hi" and saved[0].stat().st_mode & 0o077 == 0
    assert d.route == "text" and str(saved[0]) in d.request and d.cover == intake.DropGrant(file=str(saved[0]))
    again = intake.route_file("Notes from call (v2).md", b"x", env(vault), folder=drops, now=0)
    assert again.request != d.request and len(list(drops.iterdir())) == 2  # same second, same name: never overwritten


def test_pdfs_and_images_have_routes_and_other_files_are_refused_before_anything_is_written(vault, tmp_path):
    drops = tmp_path / "drops"
    e = env(vault)
    assert intake.route_file("paper.PDF", b"%PDF", e, folder=drops).route == "pdf"
    assert intake.route_file("shot.png", b"\x89PNG", e, folder=drops).route == "image"
    before = len(list(drops.iterdir()))
    for name, data in (("song.mp3", b"x"), (".env", b"KEY=1"), ("id_rsa", b"x"), ("empty.txt", b""),
                       ("big.txt", b"x" * (intake.MAX_FILE_BYTES + 1))):
        with pytest.raises(intake.Refused):
            intake.route_file(name, data, e, folder=drops)
    assert len(list(drops.iterdir())) == before


def test_old_drops_are_cleared_on_the_next_one(vault, tmp_path):
    drops = tmp_path / "drops"
    drops.mkdir()
    old = drops / "old.txt"
    old.write_text("x")
    os.utime(old, (0, 0))
    intake.route_file("new.txt", b"y", env(vault), folder=drops, now=time.time())
    assert not old.exists() and len(list(drops.iterdir())) == 1


class Conn:
    folder = key = None

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send(self, ev):
        self.sent.append(ev)


async def test_the_drop_message_runs_in_the_background_and_answers_at_once(repo, tmp_path, monkeypatch):
    from orb import server, settings
    vault, _ = repo
    monkeypatch.setitem(settings.settings.data, "transcript_script", SCRIPT)
    monkeypatch.setitem(settings.settings.data, "onboarded", True)
    monkeypatch.setitem(settings.settings.data, "brain", True)
    monkeypatch.setitem(settings.settings.data, "vault", "")
    monkeypatch.setattr(intake, "DROP_DIR", tmp_path / "drops")
    started = []

    class Session:
        grant = None

        async def send(self, text, how):
            started.append((text, self.grant))

    monkeypatch.setattr(server.hub, "session", lambda path, key: Session())
    monkeypatch.setattr(server.hub, "conns", [])
    conn = Conn()
    monkeypatch.setattr(server.hub, "conns", [conn])
    await server.handle(conn, {"type": "drop", "url": "https://youtu.be/dQw4w9WgXcQ"})
    assert conn.sent[-1]["ok"] is False and "Brain folder" in conn.sent[-1]["text"]

    monkeypatch.setitem(settings.settings.data, "vault", str(vault))
    monkeypatch.setattr(vault_write, "commit_new", lambda v, rel, m: vault_write.Pushed(True))
    await server.handle(conn, {"type": "drop", "url": "https://youtu.be/dQw4w9WgXcQ"})
    routed = conn.sent[-1]
    assert routed["type"] == "drop_routed" and routed["ok"] and routed["route"] == "youtube" and "session" not in routed
    for _ in range(100):
        if conn.sent[-1]["type"] == "drop_done":
            break
        await asyncio.sleep(0.02)
    assert conn.sent[-1] == {"type": "drop_done", "id": routed["id"], "ok": True, "text": 'Saved: Acme: a "quoted" talk',
                             "note": conn.sent[-1]["note"]}
    assert started == []  # no session for a job

    await server.handle(conn, {"type": "drop", "name": "a.md", "data": base64.b64encode(b"# a").decode()})
    routed = [e for e in conn.sent if e["type"] == "drop_routed"][-1]
    assert routed["route"] == "text" and routed["folder"] == str(vault) and routed["session"]
    await asyncio.sleep(0)
    text, cover = started[-1]
    assert str(tmp_path / "drops") in text and cover.file and cover.file in text
    await server.handle(conn, {"type": "drop", "name": "a.md", "data": "not base64!"})
    assert conn.sent[-1] == {"type": "drop_routed", "ok": False, "text": "The file didn't arrive whole; try again."}
    await server.handle(conn, {"type": "drop", "url": "just words"})
    assert conn.sent[-1]["ok"] is False


async def test_a_session_drop_ends_with_its_first_turn(monkeypatch):
    from orb import server
    conn = Conn()
    monkeypatch.setattr(server.hub, "conns", [conn])
    monkeypatch.setattr(server.hub, "push_folders", lambda: asyncio.sleep(0))
    monkeypatch.setattr(server.hub.delegator, "on_event", lambda key, ev: asyncio.sleep(0))
    monkeypatch.setattr(server.hub, "drops", {"k1": ("d1", "link"), "k2": ("d2", "page"), "k3": ("d3", "text")})
    await server.hub.broadcast("k1", {"type": "result", "is_error": False})
    await server.hub.broadcast("k1", {"type": "result", "is_error": False})  # a later turn: the drop already ended
    await server.hub.broadcast("k2", {"type": "error", "text": "Claude: rate limited"})
    await server.hub.broadcast("k3", {"type": "result", "is_error": True})
    assert [e for e in conn.sent if e["type"] == "drop_done"] == [
        {"type": "drop_done", "id": "d1", "ok": True, "text": "Saved"},
        {"type": "drop_done", "id": "d2", "ok": False, "text": "Claude: rate limited"},
        {"type": "drop_done", "id": "d3", "ok": False, "text": "It stopped with an error; open it to see why."}]
    assert server.hub.drops == {}
