import math

from build.fetch import parse_kalshi, parse_manifold, parse_polymarket
from build.pipeline import clean_title, make_map


def test_polymarket_parser():
    row = {
        "question": "Will X happen?", "slug": "will-x",
        "outcomes": '["Yes", "No"]', "bestBid": 0.4, "bestAsk": 0.44,
        "liquidity": "1500", "endDate": "2026-12-31T00:00:00Z",
    }
    m = parse_polymarket(row)
    assert m and m["p"] == 0.42 and m["venue"] == "polymarket"
    assert parse_polymarket({**row, "outcomes": '["A", "B"]'}) is None
    assert parse_polymarket({**row, "bestBid": None}) is None


def test_kalshi_parser_dollar_fields():
    row = {
        "market_type": "binary", "title": "Fed cuts?", "yes_sub_title": "25bp",
        "yes_bid_dollars": "0.40", "yes_ask_dollars": "0.44",
        "open_interest_fp": "900.0", "close_time": "2026-09-18T18:00:00Z",
        "ticker": "T", "event_ticker": "E",
    }
    m = parse_kalshi(row, {"title": "Fed decision"})
    assert m and m["p"] == 0.42 and "25bp" in m["title"] and m["usd"] == 900.0
    assert parse_kalshi({**row, "market_type": "scalar"}, {}) is None


def test_manifold_parser_quality_bar():
    row = {
        "outcomeType": "BINARY", "probability": 0.7, "question": "Will Y?",
        "uniqueBettorCount": 20, "closeTime": 1790000000000,
        "url": "https://manifold.markets/y", "totalLiquidity": 400,
    }
    assert parse_manifold(row)
    assert parse_manifold({**row, "uniqueBettorCount": 3}) is None
    assert parse_manifold({**row, "question": "A resolves the same as B"}) is None


def _fake_markets():
    themes = [
        ("Will the Fed cut interest rates in {} 2026?", "polymarket"),
        ("Will Bitcoin close above {}0k this year?", "kalshi"),
        ("Will {} win the Champions League?", "manifold"),
        ("Will AI model {} be released before 2027?", "polymarket"),
    ]
    fills = ["January", "March", "May", "July", "September", "November",
             "5", "7", "9", "12", "15", "20",
             "Madrid", "Bayern", "Arsenal", "Inter", "PSG", "Chelsea",
             "GPT-6", "Claude 5", "Gemini 3", "Llama 5", "Grok 4", "Mistral 3"]
    out = []
    for i in range(120):
        tpl, venue = themes[i % 4]
        out.append({
            "venue": venue, "title": tpl.format(fills[(i * 7) % len(fills)]),
            "p": 0.1 + (i % 80) / 100, "usd": 100 * (1 + i % 50),
            "close": 1_800_000_000 + i * 86400, "url": f"https://example.com/{i}",
        })
    return out


def test_make_map_shape_and_ranges():
    data = make_map(_fake_markets(), seed=7)
    assert data["counts"]["total"] == 120
    assert len(data["stars"]) == 120
    assert len(data["clusters"]) >= 4
    for s in data["stars"]:
        x, y, p, size, venue, days, cid, title, url, usd = s
        assert -1 <= x <= 1 and -1 <= y <= 1
        assert 0 < p < 1 and 0 <= size <= 1
        assert venue in (0, 1, 2) and isinstance(title, str) and url
        assert usd >= 0
    labels = " ".join(c["label"] for c in data["clusters"]).lower()
    assert "fed" in labels or "rates" in labels  # themes surface as constellations


def test_clean_title_strips_tags():
    assert clean_title("Strait reopens? [Polymarket]") == "Strait reopens?"


def test_deterministic():
    a = make_map(_fake_markets(), seed=7)
    b = make_map(_fake_markets(), seed=7)
    assert a["stars"][0][:2] == b["stars"][0][:2]
