"""One real routines check into a scratch state file; prints the panel rows."""
import asyncio, json, sys, time
from pathlib import Path
from orb import routines

async def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/vd-routines.json")
    async def notify(t): print("NOTICE:", t)
    async def push(): pass
    w = routines.Watch(out, notify, push)
    t = time.time(); await w.refresh(force=True)
    ev = w.event()
    print("error:", ev["error"], "| needs:", ev["needs"], "| new:", ev["new"], "|", round(time.time() - t, 1), "s")
    for x in ev["items"]:
        l = x["last"] or {}
        print(f'{x["name"][:28]:28} {str(x["enabled"]):5} {str(l.get("outcome")):8} needs={x["needs"]} {l.get("summary","")[:70]!r}')

asyncio.run(main())
