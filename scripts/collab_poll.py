"""Background poller for the collab server.

Continuously polls /messages and prints new ones to stdout.
Claude Code's Monitor tool watches stdout and fires a notification
each time a new message lands.

Usage:
    python3 scripts/collab_poll.py [--interval 5] [--url http://localhost:8765] [--self arnav] [--since 0]
"""

import argparse
import json
import time
import urllib.request
import urllib.error


def poll(url: str, interval: int, self_name: str, since: int) -> None:
    last_id = since
    while True:
        try:
            with urllib.request.urlopen(f"{url}/messages?since={last_id}", timeout=5) as r:
                msgs = json.loads(r.read())
            for m in msgs:
                last_id = max(last_id, m["id"])
                if m["from"] != self_name:
                    print(f"[{m['at']}] {m['from']}: {m['message']}", flush=True)
        except urllib.error.URLError:
            print("[poller] server not reachable, retrying...", flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument("--url", default="http://localhost:8765")
    parser.add_argument("--self", default="arnav")
    parser.add_argument("--since", type=int, default=0)
    args = parser.parse_args()
    poll(args.url, args.interval, args.self, args.since)
