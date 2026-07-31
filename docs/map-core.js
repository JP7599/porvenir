"use strict";
/* porvenir map core — the pure math the galaxy runs on.
 * Camera transforms, the probability color scale, and the spatial hash used
 * for hover picking. Kept DOM-free so node can test it.
 */
(function (global) {
  /* Camera: world [-1,1]^2 → clip space. scale grows as you zoom in. */
  function makeCamera() {
    return { scale: 0.9, x: 0, y: 0 };
  }

  function worldToScreen(cam, wx, wy, w, h) {
    const s = Math.min(w, h) / 2;
    return [
      w / 2 + (wx * cam.scale + cam.x) * s,
      h / 2 - (wy * cam.scale + cam.y) * s,
    ];
  }

  function screenToWorld(cam, px, py, w, h) {
    const s = Math.min(w, h) / 2;
    return [
      ((px - w / 2) / s - cam.x) / cam.scale,
      (-(py - h / 2) / s - cam.y) / cam.scale,
    ];
  }

  /* Zoom about a screen point: the world point under the cursor stays put. */
  function zoomAt(cam, factor, px, py, w, h) {
    const [wx, wy] = screenToWorld(cam, px, py, w, h);
    cam.scale = Math.max(0.35, Math.min(40, cam.scale * factor));
    const s = Math.min(w, h) / 2;
    cam.x = (px - w / 2) / s - wx * cam.scale;
    cam.y = -(py - h / 2) / s - wy * cam.scale;
    return cam;
  }

  /* Diverging belief scale: cold blue (no) → pale (unsure) → warm gold (yes). */
  const NO = [0.31, 0.49, 0.94], MID = [0.81, 0.84, 0.90], YES = [0.94, 0.70, 0.31];
  function probColor(p) {
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    return p < 0.5 ? mix(NO, MID, p * 2) : mix(MID, YES, (p - 0.5) * 2);
  }

  /* Uniform spatial hash over world space for nearest-star lookup. */
  function makeGrid(stars, cell = 0.02) {
    const map = new Map();
    const key = (cx, cy) => cx + ":" + cy;
    stars.forEach((s, i) => {
      const cx = Math.floor(s[0] / cell), cy = Math.floor(s[1] / cell);
      const k = key(cx, cy);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    });
    return {
      cell,
      nearest(wx, wy, maxDist, accept) {
        const r = Math.ceil(maxDist / cell);
        const cx = Math.floor(wx / cell), cy = Math.floor(wy / cell);
        let best = -1, bestD = maxDist * maxDist;
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            const bucket = map.get(key(cx + dx, cy + dy));
            if (!bucket) continue;
            for (const i of bucket) {
              if (accept && !accept(i)) continue;
              const s = stars[i];
              const d = (s[0] - wx) ** 2 + (s[1] - wy) ** 2;
              if (d < bestD) { bestD = d; best = i; }
            }
          }
        }
        return best;
      },
    };
  }

  function fmtUsd(v) {
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "k";
    return "$" + Math.round(v);
  }

  function fmtDays(d) {
    if (d === -1 || d === null) return "no deadline";
    if (d < 0) return "closing";
    if (d < 1) return "closes today";
    if (d < 60) return `closes in ${Math.round(d)}d`;
    if (d < 720) return `closes in ${Math.round(d / 30)}mo`;
    return `closes in ${(d / 365).toFixed(1)}y`;
  }

  const Exported = { makeCamera, worldToScreen, screenToWorld, zoomAt, probColor, makeGrid, fmtUsd, fmtDays };
  if (typeof module !== "undefined" && module.exports) module.exports = Exported;
  else global.PorvenirCore = Exported;
})(typeof window !== "undefined" ? window : globalThis);
