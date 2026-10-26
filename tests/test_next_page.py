import pytest
from starlette.testclient import TestClient

from orb import config, server


def test_root_serves_the_built_react_page_without_cdn():
    r = TestClient(server.app).get("/")
    assert r.status_code == 200 and '<div id="root"></div>' in r.text
    policy = r.headers["content-security-policy"]
    assert "cdn.jsdelivr.net" not in policy and "script-src 'self' 'wasm-unsafe-eval'" in policy


@pytest.mark.parametrize("route", ["/s/abc123", "/settings", "/routines", "/sessions", "/chats", "/activity", "/r/trig_1", "/t/inbox%2Fg7.md/6"])
def test_react_routes_get_the_same_page(route):
    r = TestClient(server.app).get(route)
    assert r.status_code == 200 and '<div id="root"></div>' in r.text and "cdn.jsdelivr.net" not in r.headers["content-security-policy"]


def test_old_page_keeps_its_cdn_policy():
    assert "cdn.jsdelivr.net" in TestClient(server.app).get("/old").headers["content-security-policy"]


def test_next_links_redirect_to_the_same_screen():
    r = TestClient(server.app).get("/next/s/abc", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/s/abc"
    assert TestClient(server.app).get("/next", follow_redirects=False).headers["location"] == "/"


@pytest.mark.parametrize("dev, origin, ok", [
    ("", "http://localhost:5173", False),                      # off by default
    ("http://localhost:5173", "http://localhost:5173", True),  # the Vite dev server, when switched on
    ("http://localhost:5173", "http://evil.test", False),
])
def test_dev_origin_is_opt_in(monkeypatch, dev, origin, ok):
    monkeypatch.setattr(config, "DEV_ORIGIN", dev)

    class WS:
        headers = {"origin": origin, "host": "127.0.0.1:8765"}

    assert server.origin_ok(WS()) is ok


def test_dev_origin_must_be_plain_localhost(monkeypatch):
    import importlib
    for bad in ("https://localhost:5173", "http://evil.test:5173", "http://localhost"):
        monkeypatch.setenv("ORB_DEV_ORIGIN", bad)
        assert importlib.reload(config).DEV_ORIGIN == ""
    monkeypatch.setenv("ORB_DEV_ORIGIN", "http://localhost:5173/")
    assert importlib.reload(config).DEV_ORIGIN == "http://localhost:5173"
    monkeypatch.delenv("ORB_DEV_ORIGIN")
    importlib.reload(config)


@pytest.mark.parametrize("path", ["/next//evil.test", "/next///evil.test/x", "/next/%2Fevil.test", "/next/\\evil.test"])
def test_next_redirect_stays_on_this_origin(path):
    r = TestClient(server.app).get(path, follow_redirects=False)
    loc = r.headers["location"]
    assert r.status_code == 307 and loc.startswith("/") and not loc.startswith(("//", "/\\"))
