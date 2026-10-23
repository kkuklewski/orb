import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from orb import server


def test_stale_token_is_told_4403_not_a_silent_failure():
    # A page left open from an earlier install keeps its old token; it must get 4403 (shown as
    # "open the new link"), not a failed handshake it would retry forever.
    client = TestClient(server.app)
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/ws?t=stale", headers={"origin": "http://testserver"}) as ws:
            ws.receive_json()
    assert e.value.code == 4403


def test_page_closing_right_away_is_not_an_error(caplog):
    client = TestClient(server.app)
    with client.websocket_connect(f"/ws?t={server.config.token()}", headers={"origin": "http://testserver"}) as ws:
        assert ws.receive_json()["type"] == "hello"
    assert "Exception in ASGI application" not in caplog.text
