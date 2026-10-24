"""watch: reminders, pinned links, repos with unsaved work, open PRs and Vikunja tasks for the home screen."""

import datetime as dt
import json
import os
import subprocess

from orb import protocol, settings, vikunja, watch

TODAY = dt.date(2030, 3, 10)


def test_reminders_soon_first_then_undated():
    items = [
        {"text": "Renew acme.example", "due": "2030-03-20", "url": "https://registrar.example/acme"},
        {"text": "Far away", "due": "2030-09-01"},
        {"text": "Run the switch script on globex"},
        {"text": "Overdue cert", "due": "2030-03-08", "url": "javascript:alert(1)"},
        {"text": "  "}, "not a dict",
    ]
    got = watch.reminders(items, TODAY)
    assert [r["text"] for r in got] == ["Overdue cert", "Renew acme.example", "Run the switch script on globex"]
    assert got[0] == {"text": "Overdue cert", "due": "2030-03-08", "days": -2, "url": None}
    assert got[1]["days"] == 10 and got[1]["url"] == "https://registrar.example/acme"
    assert got[2]["due"] is None


def test_links_keep_web_urls_only():
    got = watch.links([{"label": "Tracker", "url": "http://10.0.0.5:8002"}, {"url": "https://acme.example"},
                       {"label": "bad", "url": "file:///etc/passwd"}])
    assert got == [{"label": "Tracker", "url": "http://10.0.0.5:8002"},
                   {"label": "https://acme.example", "url": "https://acme.example"}]


def test_parse_status():
    assert watch.parse_status("## main...origin/main [ahead 2, behind 1]\n M a.py\n?? b.py\n") == \
        {"branch": "main", "changed": 2, "ahead": 2}
    assert watch.parse_status("## main...origin/main\n") == {"branch": "main", "changed": 0, "ahead": 0}
    assert watch.parse_status("## feature\n M x\n") == {"branch": "feature", "changed": 1, "ahead": None}
    assert watch.parse_status("## No commits yet on main\n") == {"branch": "main", "changed": 0, "ahead": None}


def test_repos_lists_only_unsaved(tmp_path):
    def repo(name):
        p = tmp_path / name
        p.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main", str(p)], check=True)
        return {"path": str(p), "label": f"acme/{name}"}

    clean, dirty = repo("clean"), repo("dirty")
    (tmp_path / "dirty" / "new.txt").write_text("x")
    not_git = {"path": str(tmp_path), "label": "root"}
    assert watch.repos([clean, dirty, not_git]) == [
        {"path": dirty["path"], "label": "acme/dirty", "branch": "main", "changed": 1, "ahead": None}]


def test_repos_never_run_programs_from_the_repos_config(tmp_path):
    p = tmp_path / "acme"
    git = lambda *a: subprocess.run(["git", "-C", str(p), *a], check=True, capture_output=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(p)], check=True)
    (p / ".gitattributes").write_text("* filter=ev=il\n")
    (p / "x.txt").write_text("x")
    git("-c", "user.email=a@acme.example", "-c", "user.name=a", "-c", "filter.ev=il.clean=cat", "add", ".")
    git("-c", "user.email=a@acme.example", "-c", "user.name=a", "-c", "filter.ev=il.clean=cat", "commit", "-qm", "x")
    ran = tmp_path / "ran"
    git("config", "core.fsmonitor", f"touch {ran}-fsmonitor")
    git("config", "filter.ev=il.clean", f"touch {ran}-clean; cat")
    git("config", "filter.ev=il.process", f"sh -c 'touch {ran}-process; exit 1'")
    for x in tmp_path.glob("ran-*"):  # set-up runs, not the check's
        x.unlink()
    os.utime(p / "x.txt", (1, 1))  # stat changed, content not: git re-reads the file through its filter
    (p / "y.txt").write_text("y")
    assert watch.repos([{"path": str(p), "label": "acme"}])[0]["changed"] == 1
    assert not list(tmp_path.glob("ran-*"))


def test_repo_filters_only_blanks_the_repos_own():
    out = "global\0filter.lfs.clean\ngit-lfs clean -- %f\0local\0filter.a b=c.process\nsh x\0local\0filter.evil.required\ntrue\0"
    assert watch.repo_filters(out) == ["filter.a b=c.process"]
    assert watch.blank_env(["filter.x=y.clean"]) == {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "filter.x=y.clean", "GIT_CONFIG_VALUE_0": ""}


def test_parse_prs_marks_stale():
    now = dt.datetime(2030, 3, 10, tzinfo=dt.timezone.utc).timestamp()
    raw = json.dumps([
        {"number": 7, "title": "Fresh", "repository": {"nameWithOwner": "acme/app"}, "url": "https://github.com/acme/app/pull/7",
         "updatedAt": "2030-03-09T12:00:00Z", "isDraft": False},
        {"number": 3, "title": "Old", "repository": {"nameWithOwner": "acme/web"}, "url": "https://github.com/acme/web/pull/3",
         "updatedAt": "2030-03-01T00:00:00Z", "isDraft": True},
    ])
    got = watch.parse_prs(raw, now)
    assert [(p["number"], p["idle_days"], p["stale"], p["draft"]) for p in got] == [(3, 9, True, True), (7, 0, False, False)]


def test_vikunja_order_and_config(monkeypatch):
    t = lambda title, due, prio, upd: {"title": title, "due": due, "priority": prio, "updated": upd}
    got = vikunja.order([t("later", None, 1, 5), t("urgent", None, 4, 1), t("due soon", "2030-03-11", 0, 0),
                         t("due later", "2030-04-01", 5, 0)])
    assert [x["title"] for x in got] == ["due soon", "due later", "urgent", "later"]
    monkeypatch.delenv("ORB_VIKUNJA_TOKEN", raising=False)
    assert vikunja.configured("http://10.0.0.5:8002") is None
    monkeypatch.setenv("ORB_VIKUNJA_TOKEN", "tk")
    assert vikunja.configured("http://10.0.0.5:8002/") == ("http://10.0.0.5:8002", "tk")
    assert vikunja.configured("ftp://nope") is None


def test_summary_validates(monkeypatch):
    monkeypatch.delenv("ORB_VIKUNJA_TOKEN", raising=False)
    monkeypatch.setattr(watch, "prs", lambda: [])
    s = watch.summary({"reminders": [{"text": "Pay the domain", "due": "2030-03-12"}],
                       "links": [{"label": "Kimai", "url": "https://time.acme.example"}]}, [], TODAY)
    protocol.SERVER_EVENTS["home_watch"].model_validate(s)
    assert s["tracker"] is None and s["reminders"][0]["days"] == 2


def test_settings_accept_reminders_and_links(tmp_path):
    st = settings.Settings(tmp_path / "s.json")
    st.update({"reminders": [{"text": "Renew", "due": "2030-01-01", "junk": 1}, {"due": "2030-01-01"}],
               "links": [{"label": "X", "url": "https://x.example"}, {"url": "javascript:x"}],
               "vikunja_url": "file:///nope"})
    assert st["reminders"] == [{"text": "Renew", "due": "2030-01-01"}]
    assert st["links"] == [{"label": "X", "url": "https://x.example"}]
    assert st["vikunja_url"] == ""
