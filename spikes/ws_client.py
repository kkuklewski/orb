"""Drive the dashboard over its WebSocket like the page does. Used for milestone checks.

uv run python spikes/ws_client.py <folder> "<message>" [--allow|--deny] [--interrupt-after SEC]
"""
import asyncio
import json
import sys
import time

import websockets

from orb import config


async def main(folder: str, text: str, decision: str, interrupt_after: float | None, mode: str | None = None) -> None:
    url = f"ws://127.0.0.1:{config.PORT}/ws?t={config.token()}"
    async with websockets.connect(url, origin=f"http://127.0.0.1:{config.PORT}", max_size=None) as ws:
        await ws.send(json.dumps({"type": "open_folder", "path": folder}))
        await ws.send(json.dumps({"type": "mute", "value": False}))
        t0, sent, texts, audio = time.time(), False, {}, []
        while True:
            ev = json.loads(await asyncio.wait_for(ws.recv(), 240))
            t = ev["type"]
            el = f"{time.time() - t0:6.1f}s"
            if t == "history" and not sent:
                print(el, "history events:", len(ev["events"]))
                if mode:
                    await ws.send(json.dumps({"type": "set_mode", "mode": mode}))
                await ws.send(json.dumps({"type": "user_text", "text": text}))
                sent = True
                if interrupt_after:
                    async def stop():
                        await asyncio.sleep(interrupt_after)
                        print(f"{time.time() - t0:6.1f}s >>> interrupt")
                        await ws.send(json.dumps({"type": "interrupt"}))
                    asyncio.create_task(stop())
            elif t == "said":
                said = locals().get("said", "")
                print(el, "SAID", repr(ev["delta"]))
            elif t == "text":
                texts[ev["block"]] = texts.get(ev["block"], "") + ev["delta"]
            elif t == "audio":
                audio.append(ev["text"])
                print(el, "AUDIO", repr(ev["text"]), len(ev["data"]), "b64 chars")
            elif t in ("tool_input", "tool_result", "permission", "permission_done", "result", "error", "held",
                       "session_info", "speech_reset", "state", "opened", "notice", "user"):
                slim = {k: (v if not isinstance(v, str) or len(v) < 120 else v[:120] + "…") for k, v in ev.items()
                        if k not in ("folder", "input")}
                print(el, t, json.dumps(slim, ensure_ascii=False))
                if t == "permission" and decision:
                    await ws.send(json.dumps({"type": "permission", "id": ev["id"], "allow": decision == "--allow"}))
                if t == "result":
                    await asyncio.sleep(4)  # let the last sentences synthesize
                    while True:
                        try:
                            ev = json.loads(await asyncio.wait_for(ws.recv(), 3))
                        except TimeoutError:
                            break
                        if ev["type"] == "audio":
                            audio.append(ev["text"])
                            print("  AUDIO", repr(ev["text"]))
                    break
        print("\n=== chat text ===")
        for v in texts.values():
            print(v.strip(), "\n---")
        print("=== spoken ===", audio)


if __name__ == "__main__":
    args = sys.argv[1:]
    ia = None
    if "--interrupt-after" in args:
        i = args.index("--interrupt-after")
        ia = float(args[i + 1])
        del args[i : i + 2]
    mode = None
    if "--mode" in args:
        i = args.index("--mode")
        mode = args[i + 1]
        del args[i : i + 2]
    decision = next((a for a in args if a in ("--allow", "--deny")), "")
    args = [a for a in args if a not in ("--allow", "--deny")]
    asyncio.run(main(args[0], args[1], decision, ia, mode))
