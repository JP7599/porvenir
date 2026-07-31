"""Turn a pile of market titles into a 2D galaxy.

TF-IDF over titles → truncated SVD → t-SNE for the layout (semantically
similar questions end up near each other), KMeans for constellations, top
TF-IDF terms per cluster for the constellation names. Everything is
precomputed here so the site itself ships as static files.
"""

from __future__ import annotations

import json
import math
import re
import time
from pathlib import Path

import numpy as np

_BRACKETS = re.compile(r"\[[^\]]*\]")


def clean_title(t: str) -> str:
    return _BRACKETS.sub(" ", t).strip()


def make_map(markets: list[dict], seed: int = 42, k: int | None = None) -> dict:
    from sklearn.cluster import KMeans
    from sklearn.decomposition import TruncatedSVD
    from sklearn.feature_extraction.text import TfidfVectorizer

    n = len(markets)
    if n < 8:
        raise ValueError(f"need at least 8 markets, got {n}")
    titles = [clean_title(m["title"]) for m in markets]

    vec = TfidfVectorizer(stop_words="english", min_df=2, ngram_range=(1, 2),
                          max_features=20000, sublinear_tf=True)
    X = vec.fit_transform(titles)

    dims = min(50, X.shape[1] - 1, n - 1)
    svd = TruncatedSVD(n_components=max(2, dims), random_state=seed)
    Xr = svd.fit_transform(X)

    if n >= 100:
        from sklearn.manifold import TSNE
        tsne = TSNE(n_components=2, perplexity=min(40, (n - 1) // 3), init="pca",
                    learning_rate="auto", random_state=seed)
        coords = tsne.fit_transform(Xr)
    else:  # tiny corpora (tests): SVD plane is enough
        coords = Xr[:, :2].copy()

    # Normalize into [-1, 1] with a margin; nudge exact overlaps apart.
    coords = coords - coords.mean(axis=0)
    scale = np.abs(coords).max() or 1.0
    coords = coords / scale * 0.92
    rng = np.random.default_rng(seed)
    coords += rng.normal(0, 0.0015, coords.shape)

    kk = k or max(8, min(30, n // 150))
    kk = min(kk, n)
    km = KMeans(n_clusters=kk, n_init=4, random_state=seed)
    cluster_ids = km.fit_predict(Xr)

    # Constellation names: top mean-TF-IDF terms per cluster, deduped.
    terms = np.array(vec.get_feature_names_out())
    clusters = []
    for c in range(kk):
        mask = cluster_ids == c
        if not mask.any():
            continue
        mean_tfidf = np.asarray(X[mask].mean(axis=0)).ravel()
        top = terms[np.argsort(-mean_tfidf)]
        label_terms: list[str] = []
        for t in top:
            if any(t in u or u in t for u in label_terms):
                continue
            label_terms.append(t)
            if len(label_terms) == 3:
                break
        cx, cy = coords[mask].mean(axis=0)
        clusters.append({"id": int(c), "label": " · ".join(label_terms),
                         "x": round(float(cx), 4), "y": round(float(cy), 4),
                         "n": int(mask.sum())})

    now = time.time()
    usd = np.array([max(m.get("usd") or 0.0, 1.0) for m in markets])
    size = np.log10(usd + 10)
    size = (size - size.min()) / (size.max() - size.min() or 1.0)

    venues = ["polymarket", "kalshi", "manifold"]
    stars = []
    for i, m in enumerate(markets):
        close = m.get("close")
        days = round((close - now) / 86400, 1) if close else -1
        stars.append([
            round(float(coords[i, 0]), 4),
            round(float(coords[i, 1]), 4),
            m["p"],
            round(float(size[i]), 3),
            venues.index(m["venue"]),
            days,
            int(cluster_ids[i]),
            m["title"],
            m["url"],
            round(float(m.get("usd") or 0.0)),
        ])

    counts = {v: sum(1 for m in markets if m["venue"] == v) for v in venues}
    return {
        "built_at": now,
        "counts": {"total": n, **counts},
        "clusters": clusters,
        "stars": stars,
    }


def main() -> int:
    from .fetch import fetch_all

    t0 = time.time()
    print("fetching venues…", flush=True)
    markets = fetch_all()
    # One star per unique (venue, title).
    seen: set[tuple] = set()
    unique = []
    for m in markets:
        key = (m["venue"], m["title"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(m)
    print(f"  {len(unique)} markets ({time.time() - t0:.0f}s), embedding…", flush=True)
    data = make_map(unique)
    web = Path(__file__).resolve().parent.parent / "docs"
    payload = json.dumps(data, separators=(",", ":"))
    (web / "data.json").write_text(payload)
    # data.js makes the site work straight from file:// (no fetch, no server).
    (web / "data.js").write_text(f"window.PORVENIR_DATA={payload};")
    kb = (web / "data.json").stat().st_size / 1024
    print(f"  wrote data.json + data.js ({kb:.0f} KB) · {len(data['clusters'])} constellations "
          f"· {time.time() - t0:.0f}s total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
