"""Fetch open binary markets from Polymarket, Kalshi, and Manifold.

Same public endpoints discrepa uses, reduced to what a map needs: title,
venue, probability, dollars at stake, close time, URL. Junk filtered at the
door (quote-less shells, parlay strings, sub-threshold books).
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "porvenir/0.1 (personal map of prediction markets)", "Accept": "application/json"}


def _get(url: str, params: dict) -> dict | list:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def _iso_ts(s: str | None) -> float | None:
    if not s:
        return None
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.replace(tzinfo=dt.tzinfo or timezone.utc).timestamp()
    except ValueError:
        return None


def parse_polymarket(row: dict) -> dict | None:
    try:
        outcomes = json.loads(row.get("outcomes") or "[]")
    except (TypeError, json.JSONDecodeError):
        return None
    if [str(o).strip().lower() for o in outcomes] != ["yes", "no"]:
        return None
    bid, ask = row.get("bestBid"), row.get("bestAsk")
    if bid is None or ask is None or not (0 < float(bid) <= float(ask) < 1):
        return None
    title = (row.get("question") or "").strip()
    if not title:
        return None
    return {
        "venue": "polymarket",
        "title": title,
        "p": round((float(bid) + float(ask)) / 2, 4),
        "usd": float(row.get("liquidity") or 0.0),
        "close": _iso_ts(row.get("endDate")),
        "url": f"https://polymarket.com/market/{row.get('slug', '')}",
    }


def parse_kalshi(row: dict, event: dict) -> dict | None:
    if row.get("market_type") != "binary":
        return None

    def dollars(key_d: str, key_c: str) -> float | None:
        v = row.get(key_d)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                return None
        c = row.get(key_c)
        return c / 100.0 if isinstance(c, (int, float)) else None

    bid, ask = dollars("yes_bid_dollars", "yes_bid"), dollars("yes_ask_dollars", "yes_ask")
    if bid is None or ask is None or not (0 < bid <= ask < 1):
        return None
    title = (row.get("title") or event.get("title") or "").strip()
    sub = (row.get("yes_sub_title") or "").strip()
    if sub and sub.lower() not in title.lower() and len(sub) < 80:
        title = f"{title} — {sub}"
    if not title or title.count(",") >= 3:
        return None
    oi = float(row.get("open_interest_fp") or row.get("open_interest") or 0.0)
    return {
        "venue": "kalshi",
        "title": title,
        "p": round((bid + ask) / 2, 4),
        "usd": oi,
        "close": _iso_ts(row.get("close_time")),
        "url": f"https://kalshi.com/markets/{row.get('event_ticker', row.get('ticker', ''))}",
    }


def parse_manifold(row: dict) -> dict | None:
    if row.get("outcomeType") != "BINARY" or row.get("isResolved"):
        return None
    if (row.get("uniqueBettorCount") or 0) < 8:
        return None
    prob = row.get("probability")
    title = (row.get("question") or "").strip()
    if prob is None or not (0 < prob < 1) or not title:
        return None
    if "resolve the same" in title.lower() or "resolves the same" in title.lower():
        return None
    close = row.get("closeTime")
    return {
        "venue": "manifold",
        "title": title,
        "p": round(float(prob), 4),
        "usd": float(row.get("totalLiquidity") or 0.0),  # mana, signal-scale only
        "close": (close / 1000.0) if isinstance(close, (int, float)) else None,
        "url": row.get("url", ""),
    }


def fetch_polymarket(pages: int = 12, min_usd: float = 300.0) -> list[dict]:
    out = []
    for page in range(pages):
        rows = _get("https://gamma-api.polymarket.com/markets", {
            "limit": 100, "offset": page * 100, "active": "true", "closed": "false",
            "order": "volume24hr", "ascending": "false",
        })
        if not rows:
            break
        for row in rows:
            m = parse_polymarket(row)
            if m and m["usd"] >= min_usd:
                out.append(m)
        if len(rows) < 100:
            break
    return out


def fetch_kalshi(pages: int = 10, min_usd: float = 300.0) -> list[dict]:
    out, cursor = [], ""
    for _ in range(pages):
        params = {"limit": 200, "status": "open", "with_nested_markets": "true"}
        if cursor:
            params["cursor"] = cursor
        data = _get("https://api.elections.kalshi.com/trade-api/v2/events", params)
        for event in data.get("events", []):
            for row in event.get("markets", []) or []:
                m = parse_kalshi(row, event)
                if m and m["usd"] >= min_usd:
                    out.append(m)
        cursor = data.get("cursor") or ""
        if not cursor:
            break
    return out


def fetch_manifold(pages: int = 3) -> list[dict]:
    out, before = [], ""
    for _ in range(pages):
        params = {"limit": 1000}
        if before:
            params["before"] = before
        rows = _get("https://api.manifold.markets/v0/markets", params)
        if not rows:
            break
        for row in rows:
            m = parse_manifold(row)
            if m:
                out.append(m)
        before = rows[-1].get("id", "")
        if len(rows) < 1000 or not before:
            break
    return out


def fetch_all() -> list[dict]:
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3) as pool:
        fp = pool.submit(fetch_polymarket)
        fk = pool.submit(fetch_kalshi)
        fm = pool.submit(fetch_manifold)
        return fp.result() + fk.result() + fm.result()
