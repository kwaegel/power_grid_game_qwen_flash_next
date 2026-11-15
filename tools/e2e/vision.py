#!/usr/bin/env python3
"""Direct image review against the local Strata endpoint.

omp's own `read <image>.png?q=...` path is currently gated off by a cached model
capability (see NOTES.md, "The vision path"), so this asks the same model that
backs modelRoles.vision directly, over the endpoint's `image_url` support.

    python3 tools/e2e/vision.py tools/e2e/shots/08-mid-run.png [...]
    python3 tools/e2e/vision.py -p "your own question" img.png

Zoom into small text first with: node tools/e2e/crop.mjs <in> <out> <x> <y> <w> <h> [scale]

Needs ~/.omp/agent/strata_api_key.txt and network access to localhost:50645.
"""
import base64
import json
import os
import sys
import urllib.request

KEY_FILE = os.path.expanduser("~/.omp/agent/strata_api_key.txt")
URL = "http://host.docker.internal:50645/v1/chat/completions"
MODEL = "iq3_s"

PROMPT = (
    "You are reviewing a screenshot of Gridling, a cosy browser power-grid game. "
    "Report: 1) what is on screen and where; 2) defects: anything broken, misaligned, "
    "cut off, overlapping, unreadable, low-contrast, empty, or ugly; 3) is money / "
    "supply-vs-demand / warnings / buttons readable at a glance? Be specific and "
    "critical, as bullets. Under 200 words. Answer directly, no preamble."
)


def look(path, prompt=PROMPT, max_tokens=2000):
    with open(path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    body = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64}},
            ],
        }],
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
        "content-type": "application/json",
        "authorization": "Bearer " + open(KEY_FILE).read().strip(),
    })
    with urllib.request.urlopen(req, timeout=300) as r:
        d = json.load(r)
    msg = d["choices"][0]["message"]
    text = msg.get("content") or ""
    if not text and msg.get("reasoning_content"):
        # The endpoint sometimes spends the whole budget on reasoning and returns
        # no answer; raise the budget rather than accept an empty review.
        text = "(no answer: token budget exhausted by reasoning; retry with a larger -t)"
    return text, d["choices"][0].get("finish_reason"), d.get("usage", {})


def main(argv):
    prompt = PROMPT
    max_tokens = 2000
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == "-p":
            prompt, i = argv[i + 1], i + 2
        elif argv[i] == "-t":
            max_tokens, i = int(argv[i + 1]), i + 2
        else:
            args.append(argv[i])
            i += 1
    if not args:
        print(__doc__)
        return 2
    if not os.path.exists(KEY_FILE):
        print(f"missing {KEY_FILE}", file=sys.stderr)
        return 1
    bad = 0
    for path in args:
        try:
            text, finish, usage = look(path, prompt, max_tokens)
        except Exception as exc:                      # noqa: BLE001
            print(f"!! {path}: {exc}", file=sys.stderr)
            bad += 1
            continue
        print("=" * 72)
        print(f'{path}   finish={finish} in={usage.get("prompt_tokens")} '
              f'out={usage.get("completion_tokens")}')
        print("=" * 72)
        print(text)
        print()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
