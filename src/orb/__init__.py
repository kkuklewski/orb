"""Orb: talk to Claude by voice in the repos you choose, through your own Claude Code login."""

import logging
import sys

USAGE = """usage: orb           start Orb and print its link
       orb open      open the running Orb's page (started at login or in another window)"""


def open_page() -> int:
    """`orb open`: the running server's link from its token file, printed and opened in the browser."""
    import webbrowser

    from . import config

    if not config.port_in_use():
        print(f"Orb isn't running on {config.HOST}:{config.PORT}. Start it with: orb", file=sys.stderr)
        return 1
    value = config.saved_token()
    if not value:
        print(f"No access token in {config.STATE_DIR}. Restart Orb, then run: orb open", file=sys.stderr)
        return 1
    url = config.page_url(value)
    print(f"\n  Orb: {url}\n", flush=True)
    webbrowser.open(url)
    return 0


def main(argv: list[str] | None = None) -> None:
    from . import billing, config

    try:
        billing.assert_subscription_env()
    except billing.BillingError as e:
        print(e, file=sys.stderr)
        raise SystemExit(2) from None

    args = sys.argv[1:] if argv is None else argv
    if args == ["open"]:
        raise SystemExit(open_page())
    if args:
        print(USAGE, file=sys.stderr)
        raise SystemExit(0 if args[0] in ("-h", "--help", "help") else 2)

    if not config.env("STATE", "") and config.migrate_state():
        print(f"Moved {config.LEGACY_STATE} to {config.STATE_DIR} (the old path links to it).", file=sys.stderr)

    # Before token(): a second start must not replace the running server's token file.
    if config.port_in_use() or not config.claim_state():
        print(f"Orb is already running ({config.HOST}:{config.PORT}, {config.STATE_DIR}). Open it with: orb open",
              file=sys.stderr)
        raise SystemExit(1)

    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    url = config.page_url(config.token())
    print(f"\n  Orb: {url}\n", flush=True)
    if config.env("OPEN", ""):
        import threading
        import webbrowser

        threading.Timer(2.0, webbrowser.open, args=(url,)).start()
    uvicorn.run("orb.server:app", host=config.HOST, port=config.PORT, log_level="warning",
                ws_max_size=32 * 1024 * 1024)
