"""Orb: talk to Claude by voice in the repos you choose, through your own Claude Code login."""

import logging
import sys


def main() -> None:
    from . import billing, config

    try:
        billing.assert_subscription_env()
    except billing.BillingError as e:
        print(e, file=sys.stderr)
        raise SystemExit(2) from None

    if not config.env("STATE", "") and config.migrate_state():
        print(f"Moved {config.LEGACY_STATE} to {config.STATE_DIR} (the old path links to it).", file=sys.stderr)

    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    url = f"http://{config.HOST}:{config.PORT}/#t={config.token()}"
    print(f"\n  Orb: {url}\n", flush=True)
    if config.env("OPEN", ""):
        import threading
        import webbrowser

        threading.Timer(2.0, webbrowser.open, args=(url,)).start()
    uvicorn.run("orb.server:app", host=config.HOST, port=config.PORT, log_level="warning",
                ws_max_size=32 * 1024 * 1024)
