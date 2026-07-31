/* porvenir map-core tests — run with: node docs/tests.mjs */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("./map-core.js");

let passed = 0, failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.error(`  FAIL ${name}`); }
};

console.log("\ncamera math");
{
  const cam = C.makeCamera();
  const [px, py] = C.worldToScreen(cam, 0.3, -0.2, 1200, 800);
  const [wx, wy] = C.screenToWorld(cam, px, py, 1200, 800);
  ok(Math.abs(wx - 0.3) < 1e-9 && Math.abs(wy + 0.2) < 1e-9, "screen/world round-trip is exact");

  const before = C.screenToWorld(cam, 700, 300, 1200, 800);
  C.zoomAt(cam, 2.0, 700, 300, 1200, 800);
  const after = C.screenToWorld(cam, 700, 300, 1200, 800);
  ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9,
     "zooming pins the point under the cursor");
  const cam2 = C.makeCamera();
  for (let i = 0; i < 50; i++) C.zoomAt(cam2, 10, 0, 0, 100, 100);
  ok(cam2.scale <= 40, "zoom is clamped");
}

console.log("\nbelief color scale");
{
  const no = C.probColor(0), mid = C.probColor(0.5), yes = C.probColor(1);
  ok(no[2] > no[0], "0% is blue-leaning");
  ok(yes[0] > yes[2], "100% is warm-leaning");
  ok(Math.abs(mid[0] - mid[2]) < 0.15, "50% is near-neutral");
  let lastWarmth = -Infinity;
  for (let p = 0; p <= 1.001; p += 0.05) {
    const c = C.probColor(Math.min(p, 1));
    const warmth = c[0] - c[2];
    ok2(warmth >= lastWarmth - 1e-9);
    lastWarmth = warmth;
  }
  function ok2(cond) { if (!cond) { failed++; console.error("  FAIL warmth not monotonic"); } }
  ok(true, "warmth increases monotonically with probability");
}

console.log("\nspatial grid picking");
{
  const stars = [[0, 0], [0.5, 0.5], [0.51, 0.5], [-0.9, 0.9]];
  const grid = C.makeGrid(stars);
  ok(grid.nearest(0.507, 0.5, 0.05) === 2, "finds the nearest of two close stars");
  ok(grid.nearest(0.505, 0.5, 0.05, (i) => i !== 2) === 1, "accept filter skips hidden stars");
  ok(grid.nearest(0.2, -0.2, 0.05) === -1, "returns -1 when nothing is in range");
}

console.log("\nformatters");
{
  ok(C.fmtUsd(2_400_000) === "$2.4M" && C.fmtUsd(5300) === "$5k" && C.fmtUsd(42) === "$42", "usd");
  ok(C.fmtDays(-1) === "no deadline" && C.fmtDays(0.4) === "closes today", "days edge cases");
  ok(C.fmtDays(90) === "closes in 3mo" && C.fmtDays(1100) === "closes in 3.0y", "days scaling");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
