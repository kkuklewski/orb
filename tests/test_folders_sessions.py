import os
from pathlib import Path

from orb import folders
from orb.sessions import SessionStore


def make_repo(path: Path, remote: str | None = None, branch: str = "main") -> None:
    (path / ".git").mkdir(parents=True)
    (path / ".git" / "HEAD").write_text(f"ref: refs/heads/{branch}\n")
    cfg = "[core]\n\tbare = false\n"
    if remote:
        cfg += f'[remote "origin"]\n\turl = {remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
    (path / ".git" / "config").write_text(cfg)


def test_discovery_finds_nested_repos_labelled_by_remote(tmp_path):
    make_repo(tmp_path / "acme" / "portal" / "app", "git@github.com:acme/portal.git", "dev")
    make_repo(tmp_path / "notes" / "vault", "https://github.com/acme/vault")
    make_repo(tmp_path / "scratch")
    found = {f.rel: f for f in folders.discover(tmp_path)}
    assert set(found) == {"acme/portal/app", "notes/vault", "scratch"}
    assert found["acme/portal/app"].label == "acme/portal"
    assert found["acme/portal/app"].branch == "dev"
    assert found["notes/vault"].label == "acme/vault"
    assert found["scratch"].label == "scratch"


def test_secrets_and_skipped_folders_are_never_listed_or_entered(tmp_path, monkeypatch):
    from orb.settings import settings
    monkeypatch.setitem(settings.data, "skip_names", ["old-clone", "vendor-clone"])  # the user's never-open list
    for name in ("secrets", "old-clone", "vendor-clone", "node_modules"):
        make_repo(tmp_path / name / "inner")
        make_repo(tmp_path / name) if name != "node_modules" else None
    make_repo(tmp_path / "web" / "node_modules" / "pkg")
    make_repo(tmp_path / "ok")

    entered: list[str] = []
    real_scandir = os.scandir

    def spy(path):
        entered.append(str(path))
        return real_scandir(path)

    monkeypatch.setattr(folders.os, "scandir", spy)
    found = [f.rel for f in folders.discover(tmp_path)]
    assert found == ["ok"]
    inside = [os.path.relpath(p, tmp_path) for p in entered]
    assert not any(p.split(os.sep)[0] == "secrets" for p in inside), "secrets/ must not even be opened"
    assert folders.is_forbidden(tmp_path / "secrets" / "x", tmp_path)
    assert not folders.is_forbidden(tmp_path / "ok", tmp_path)


def test_remote_label():
    assert folders.remote_label("git@github.com:acme/shop_site.git") == "acme/shop_site"
    assert folders.remote_label("https://github.com/czlonkowski/n8n-skills") == "czlonkowski/n8n-skills"
    assert folders.remote_label(None) is None


def test_several_sessions_per_folder_survive_a_restart(tmp_path):
    p = tmp_path / "state" / "sessions.json"
    s = SessionStore(p)
    a = s.open("/repo")  # no session yet: creates one
    s.set_resume("/repo", a, "claude-a")
    s.label_from_request("/repo", a, "Fix the login bug please")
    b = s.new_session("/repo")  # "New session" adds one instead of replacing
    s.label_from_request("/repo", b, "Write the changelog")
    s.add_folder("/extra")
    s.set_mode("/repo", "auto")

    s2 = SessionStore(p)  # e.g. after a server restart
    labels = {x["key"]: x["label"] for x in s2.sessions("/repo")}
    assert labels == {a: "Fix the login bug please", b: "Write the changelog"}
    assert s2.resume_id("/repo", a) == "claude-a" and s2.resume_id("/repo", b) is None
    assert s2.active("/repo") == b
    assert s2.open("/repo", a) == a and s2.active("/repo") == a
    assert s2.mode("/repo") == "auto" and s2.mode("/other") == "default"
    assert s2.extra_folders() == ["/extra"]
    assert s2.last_used("/repo") is not None


def test_label_is_the_first_request_only(tmp_path):
    s = SessionStore(tmp_path / "s.json")
    k = s.new_session("/r")
    s.label_from_request("/r", k, "first " * 30)
    s.label_from_request("/r", k, "second")
    label = s.sessions("/r")[0]["label"]
    assert label.startswith("first first") and label.endswith("…") and len(label) <= 61


def test_migrates_the_single_session_file(tmp_path):
    p = tmp_path / "sessions.json"
    p.write_text('{"folders": {"/a": {"session_id": "old-1", "last_used": 5, "permission_mode": "auto"}}}')
    s = SessionStore(p)
    [only] = s.sessions("/a")
    assert only["resume"] == "old-1" and s.active("/a") == only["key"] and s.mode("/a") == "auto"


def test_backfill_titles_from_transcript_else_date(tmp_path):
    s = SessionStore(tmp_path / "s.json")
    a = s.new_session("/a"); s.set_resume("/a", a, "r-a")
    b = s.new_session("/a"); s.set_resume("/a", b, "r-b")
    c = s.new_session("/a")  # never used: stays untitled (hidden in the page)
    s.data["/a"]["sessions"][a]["label"] = "Earlier session"
    firsts = {"r-a": "  Deploy   the bot to staging-box  ", "r-b": None}
    assert s.backfill_labels(lambda folder, rid: firsts[rid]) == 2
    labels = {x["key"]: x["label"] for x in s.sessions("/a")}
    assert labels[a] == "Deploy the bot to staging-box"
    assert labels[b].startswith("Session ") and labels[c] == "New session"
    assert s.backfill_labels(lambda folder, rid: "x") == 0  # titled sessions are left alone


def test_session_store_survives_corrupt_file(tmp_path):
    p = tmp_path / "sessions.json"
    p.write_text("{not json")
    assert SessionStore(p).sessions("/a") == []
