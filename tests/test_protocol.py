"""The protocol (src/orb/protocol.py) must describe exactly what the code sends and reads.

Read straight from the source: every dict the server builds with a literal "type", every field
handle() reads from a page message, and every event / message the old page handles or sends.
"""

import ast
import json
import re
from pathlib import Path

from orb import protocol, server

SRC = Path(protocol.__file__).parent
ROOT = SRC.parent.parent
# Dicts with a "type" that are not WebSocket events: Agent SDK options and prompts.
NOT_EVENTS = {("agent.py", "preset"), ("routines.py", "user")}


def built_events() -> dict[str, list[tuple[str, set[str], bool]]]:
    """type -> [(file, keys, has ** spread)] for every dict literal with a constant "type"."""
    out: dict[str, list] = {}
    for path in sorted(SRC.glob("*.py")):
        if path.name == "protocol.py":
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Dict):
                continue
            keys = [k.value if isinstance(k, ast.Constant) else None for k in node.keys]
            if "type" not in keys:
                continue
            t = node.values[keys.index("type")]
            if not isinstance(t, ast.Constant) or (path.name, t.value) in NOT_EVENTS:
                continue
            out.setdefault(t.value, []).append((path.name, {k for k in keys if k and k != "type"}, None in keys))
    return out


def fields(model) -> set[str]:
    return {f.alias or name for name, f in model.model_fields.items()}


def test_every_event_the_server_builds_is_in_the_protocol_with_its_fields():
    built = built_events()
    assert set(built) == set(protocol.SERVER_EVENTS), "events built vs described differ"
    for t, uses in built.items():
        model = protocol.SERVER_EVENTS[t]
        if model.model_config.get("extra") == "allow":
            continue
        for file, keys, _ in uses:
            assert keys <= fields(model), f"{file}: {t} sends {sorted(keys - fields(model))} not in {model.__name__}"


def test_features_match_the_features_model():
    assert set(server.features()) == fields(protocol.Features)


def handled_messages() -> dict[str, set[str]]:
    fn = next(n for n in ast.walk(ast.parse((SRC / "server.py").read_text()))
              if isinstance(n, ast.AsyncFunctionDef) and n.name == "handle")
    out: dict[str, set[str]] = {}
    for n in ast.walk(fn):
        if (isinstance(n, ast.If) and isinstance(n.test, ast.Compare) and isinstance(n.test.left, ast.Name)
                and n.test.left.id == "t" and isinstance(n.test.comparators[0], ast.Constant)):
            keys = out.setdefault(n.test.comparators[0].value, set())
            for b in n.body:
                for m in ast.walk(b):
                    if (isinstance(m, ast.Call) and isinstance(m.func, ast.Attribute) and m.func.attr == "get"
                            and isinstance(m.func.value, ast.Name) and m.func.value.id == "msg"):
                        keys.add(m.args[0].value)
                    if isinstance(m, ast.Subscript) and isinstance(m.value, ast.Name) and m.value.id == "msg":
                        keys.add(m.slice.value)
    return out


def test_every_message_handle_reads_is_in_the_protocol_with_its_fields():
    handled = handled_messages()
    assert set(handled) == set(protocol.CLIENT_MESSAGES), "handled vs described messages differ"
    for t, keys in handled.items():
        model = protocol.CLIENT_MESSAGES[t]
        assert keys <= fields(model), f"handle() reads {sorted(keys - fields(model))} from {t}, not in {model.__name__}"


def test_the_old_page_only_handles_and_sends_described_messages():
    js = (SRC / "static" / "app.js").read_text()
    cases = set(re.findall(r'case "([a-z_]+)"', js))
    sends = set(re.findall(r'send\(\{ type: "([a-z_]+)"', js))
    assert cases <= set(protocol.SERVER_EVENTS), sorted(cases - set(protocol.SERVER_EVENTS))
    assert sends <= set(protocol.CLIENT_MESSAGES), sorted(sends - set(protocol.CLIENT_MESSAGES))


def test_the_committed_schema_is_current():
    committed = json.loads((ROOT / "web" / "src" / "protocol.schema.json").read_text())
    assert committed == json.loads(json.dumps(protocol.schema())), "run: uv run orb-protocol && (cd web && npm run gen:protocol)"


def test_models_accept_real_shapes():
    protocol.CLIENT_MESSAGES["set_settings"].model_validate({"type": "set_settings", "values": {"voice": "af_heart"}})
    protocol.SERVER_EVENTS["voice_sample"].model_validate({"type": "voice_sample", "voice": "x", "error": "nope"})
    try:
        protocol.CLIENT_MESSAGES["mute"].model_validate({"type": "mute", "value": True, "extra": 1})
        raise AssertionError("unknown fields must be refused")
    except Exception as e:  # pydantic.ValidationError
        assert "extra" in str(e)


def test_routine_rows_match_the_model():
    import time
    from orb import routines
    r = {"id": "trig_1", "name": "nightly", "enabled": True, "cron_expression": "0 2 * * *", "next_run_at": None}
    runs = [{"id": "run_1", "created_at": "2026-10-23T02:00:00Z", "last_event_at": "2026-10-23T02:05:00Z", "url": "https://claude.ai/x"}]
    row = routines.item(r, runs, {"run_1": {"outcome": "failed", "summary": "boom"}}, {}, time.time())
    protocol.RoutineItem.model_validate(row)


def test_command_items_match_the_model():
    from orb import slash
    for c in slash.merge([{"name": "review", "description": "Review", "argumentHint": "[pr]"}, "compact"]):
        protocol.CommandItem.model_validate(c)


def test_task_dicts_match_the_model():
    """agent.py builds each background task as one dict literal with "task_id"; its keys are TaskInfo's."""
    tree = ast.parse((SRC / "agent.py").read_text())
    found = [{k.value for k in n.keys if isinstance(k, ast.Constant)} for n in ast.walk(tree)
             if isinstance(n, ast.Dict) and any(isinstance(k, ast.Constant) and k.value == "task_id" for k in n.keys)]
    assert found and all(keys == fields(protocol.TaskInfo) for keys in found), found


def test_every_model_field_reaches_the_schema():
    defs = protocol.schema()["$defs"]
    for name, d in defs.items():
        model = getattr(protocol, name, None)
        if model is None or not hasattr(model, "model_fields"):
            continue
        assert fields(model) <= set(d.get("properties", {})), f"{name}: {sorted(fields(model) - set(d.get('properties', {})))}"


def literal_dicts(file: str, marker: str) -> list[set[str]]:
    tree = ast.parse((SRC / file).read_text())
    return [{k.value for k in n.keys if isinstance(k, ast.Constant)} for n in ast.walk(tree)
            if isinstance(n, ast.Dict) and any(isinstance(k, ast.Constant) and k.value == marker for k in n.keys)]


def test_session_info_and_mcp_rows_match_the_models():
    infos = [d for d in literal_dicts("agent.py", "apiKeySource")]
    assert infos and all(d <= fields(protocol.SessionInfo) for d in infos), infos
    rows = [d for d in literal_dicts("agent.py", "tools") if "status" in d]
    assert rows and all(d <= fields(protocol.McpServer) for d in rows), rows
    protocol.SERVER_EVENTS["rate_limit"].model_validate(
        {"type": "rate_limit", "windows": {"five_hour": {"utilization": 0.4, "resetsAt": 1.7e9, "status": "allowed"}}})
