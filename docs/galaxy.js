"use strict";
/* porvenir galaxy — raw WebGL point-sprite renderer plus all interaction.
 * No libraries. Stars are one draw call; labels and UI are DOM. */
(function () {
  const C = window.PorvenirCore;
  const DATA = window.PORVENIR_DATA;
  const $ = (id) => document.getElementById(id);
  const canvas = $("sky");
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) { $("tip").textContent = "WebGL unavailable"; return; }

  const stars = DATA.stars; // [x, y, p, size, venue, days, cluster, title, url]
  const N = stars.length;

  /* ------------------------------------------------------------- shaders -- */
  const VS = `
    attribute vec2 aPos;
    attribute float aSize, aProb, aVenue, aPhase, aState; // aState: 0 hidden, 1 normal, 2 dim, 3 lit
    uniform vec2 uScaleOff_x, uScaleOff_y; // (scale, offset) per axis
    uniform float uTime, uDpr, uIntro, uAspectX, uAspectY;
    varying float vProb, vVenue, vAlpha, vLit;
    void main() {
      vec2 clip = vec2((aPos.x * uScaleOff_x.x + uScaleOff_x.y) * uAspectX,
                       (aPos.y * uScaleOff_y.x + uScaleOff_y.y) * uAspectY);
      gl_Position = vec4(clip, 0.0, 1.0);
      float intro = clamp(uIntro * 1.6 - aPhase * 0.6, 0.0, 1.0);
      float tw = 0.82 + 0.18 * sin(uTime * (0.6 + aPhase * 2.2) + aPhase * 40.0);
      float base = (3.0 + aSize * 21.0) * pow(uScaleOff_x.x, 0.42) * uDpr;
      gl_PointSize = clamp(base * intro * (aState == 3.0 ? 1.5 : 1.0), 1.5, 90.0 * uDpr);
      float a = tw * intro;
      if (aState == 0.0) a = 0.0;
      if (aState == 2.0) a *= 0.10;
      if (aState == 3.0) a = intro;
      vAlpha = a;
      vProb = aProb;
      vVenue = aVenue;
      vLit = aState == 3.0 ? 1.0 : 0.0;
    }`;
  const FS = `
    precision mediump float;
    varying float vProb, vVenue, vAlpha, vLit;
    void main() {
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float d = length(q);
      if (d > 1.0) discard;
      vec3 no = vec3(0.22, 0.44, 0.96), mid = vec3(0.72, 0.76, 0.85), yes = vec3(0.98, 0.64, 0.20);
      vec3 col = vProb < 0.5 ? mix(no, mid, vProb * 2.0) : mix(mid, yes, (vProb - 0.5) * 2.0);
      col = mix(col, vec3(1.0), vLit * 0.5);
      // keep intensity low enough that additive overlaps tint, not bleach
      float glow = pow(max(0.0, 1.0 - d), 3.2) * 0.55;
      float core = smoothstep(0.26, 0.0, d) * 0.5;
      float ring = smoothstep(0.14, 0.02, abs(d - 0.62)) * 0.7;
      float shape = vVenue > 1.5 ? (glow * 0.3 + ring) : (glow + core);
      gl_FragColor = vec4(col * shape * vAlpha, 1.0);
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive: overlapping glows add up like light

  /* ------------------------------------------------------------- buffers -- */
  const pos = new Float32Array(N * 2), size = new Float32Array(N), prob = new Float32Array(N),
        venue = new Float32Array(N), phase = new Float32Array(N), state = new Float32Array(N).fill(1);
  stars.forEach((s, i) => {
    pos[i * 2] = s[0]; pos[i * 2 + 1] = s[1];
    size[i] = s[3]; prob[i] = s[2]; venue[i] = s[4];
    phase[i] = (i * 0.61803) % 1;
  });
  function attach(name, arr, comps, dynamic) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 0, 0);
    return buf;
  }
  attach("aPos", pos, 2); attach("aSize", size, 1); attach("aProb", prob, 1);
  attach("aVenue", venue, 1); attach("aPhase", phase, 1);
  const stateBuf = attach("aState", state, 1, true);
  function pushState() {
    gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, state);
  }
  const U = (n) => gl.getUniformLocation(prog, n);

  /* -------------------------------------------------------- camera + nav -- */
  const cam = C.makeCamera();
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener("resize", resize);

  let dragging = false, lastX = 0, lastY = 0, vx = 0, vy = 0;
  canvas.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mouseup", () => { dragging = false; });
  window.addEventListener("mousemove", (e) => {
    if (dragging) {
      const s = Math.min(W, H) / 2;
      const dx = (e.clientX - lastX) / s, dy = -(e.clientY - lastY) / s;
      cam.x += dx; cam.y += dy; vx = dx; vy = dy;
      lastX = e.clientX; lastY = e.clientY;
      hideTip();
    } else {
      hover(e.clientX, e.clientY);
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    C.zoomAt(cam, Math.pow(1.0018, -e.deltaY), e.clientX, e.clientY, W, H);
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => C.zoomAt(cam, 1.9, e.clientX, e.clientY, W, H));

  /* -------------------------------------------------- filters and search -- */
  const venueOn = [true, true, true];
  let closingOnly = false, query = "";
  const titlesLower = stars.map((s) => s[7].toLowerCase());

  function applyStates() {
    let matches = 0;
    for (let i = 0; i < N; i++) {
      const s = stars[i];
      const visible = venueOn[s[4]] && (!closingOnly || (s[5] >= 0 && s[5] <= 30));
      if (!visible) { state[i] = 0; continue; }
      if (query) {
        const hit = titlesLower[i].includes(query);
        state[i] = hit ? 3 : 2;
        if (hit) matches++;
      } else {
        state[i] = 1;
      }
    }
    pushState();
    $("searchCount").textContent = query ? `${matches} match${matches === 1 ? "" : "es"}` : "";
  }

  document.querySelectorAll(".chip[data-venue]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const v = +chip.dataset.venue;
      venueOn[v] = !venueOn[v];
      chip.classList.toggle("off", !venueOn[v]);
      applyStates();
    });
  });
  $("closing").addEventListener("click", () => {
    closingOnly = !closingOnly;
    $("closing").classList.toggle("off", !closingOnly);
    applyStates();
  });
  $("search").addEventListener("input", (e) => {
    query = e.target.value.trim().toLowerCase();
    applyStates();
  });

  /* ------------------------------------------------------- hover + click -- */
  const grid = C.makeGrid(stars);
  const tip = $("tip");
  let hovered = -1;
  function hover(px, py) {
    const [wx, wy] = C.screenToWorld(cam, px, py, W, H);
    const maxD = 16 / (Math.min(W, H) / 2) / cam.scale;
    hovered = grid.nearest(wx, wy, maxD, (i) => state[i] === 1 || state[i] === 3);
    if (hovered < 0) { hideTip(); return; }
    const s = stars[hovered];
    tip.innerHTML = `<div class="t">${escapeHtml(s[7])}</div>
      <div class="m"><b>${Math.round(s[2] * 100)}%</b> says the crowd ·
      ${["Polymarket", "Kalshi", "Manifold (play)"][s[4]]} · ${stakeTxt(s)} · ${C.fmtDays(s[5])}</div>`;
    tip.style.left = Math.min(px + 14, W - 340) + "px";
    tip.style.top = (py + 16) + "px";
    tip.style.opacity = 1;
    canvas.style.cursor = "pointer";
  }
  function stakeTxt(s) {
    const usd = s[9] || 0;
    return s[4] === 2 ? `${C.fmtUsd(usd).slice(1)} mana` : `${C.fmtUsd(usd)} at stake`;
  }
  function hideTip() { tip.style.opacity = 0; canvas.style.cursor = "grab"; }

  canvas.addEventListener("click", () => {
    if (hovered < 0) return;
    const s = stars[hovered];
    $("cardTitle").textContent = s[7];
    $("cardProb").textContent = Math.round(s[2] * 100) + "%";
    $("cardFill").style.width = (s[2] * 100).toFixed(1) + "%";
    $("cardMeta").textContent =
      `${["Polymarket", "Kalshi", "Manifold — play money"][s[4]]} · ${stakeTxt(s)} · ${C.fmtDays(s[5])}`;
    const a = $("cardLink");
    a.href = s[8];
    $("card").classList.add("show");
  });
  $("cardClose").addEventListener("click", () => $("card").classList.remove("show"));

  /* -------------------------------------------------------------- labels -- */
  const labelBox = $("labels");
  const ranked = [...DATA.clusters].sort((a, b) => b.n - a.n);
  const labels = ranked.map((c, rank) => {
    const el = document.createElement("div");
    el.className = "constellation";
    el.textContent = c.label;
    labelBox.appendChild(el);
    // Big constellations surface first; the long tail waits for zoom.
    const minScale = rank < 8 ? 0.8 : rank < 16 ? 1.5 : 2.3;
    return { el, c, minScale };
  });
  function placeLabels() {
    const placed = [];
    for (const { el, c, minScale } of labels) {
      const fade = Math.max(0, Math.min(1, (cam.scale - minScale) / 0.5));
      if (fade <= 0) { el.style.opacity = 0; continue; }
      const [px, py] = C.worldToScreen(cam, c.x, c.y, W, H);
      if (px < -180 || px > W + 180 || py < -60 || py > H + 60) { el.style.opacity = 0; continue; }
      // Greedy declutter: bigger constellations claim their space first.
      if (placed.some(([qx, qy]) => Math.abs(qx - px) < 170 && Math.abs(qy - py) < 26)) {
        el.style.opacity = 0; continue;
      }
      placed.push([px, py]);
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      el.style.opacity = (fade * 0.85).toFixed(2);
    }
  }

  /* ---------------------------------------------------------- main loop -- */
  const t0 = performance.now();
  function frame(now) {
    if (!dragging) {
      cam.x += vx; cam.y += vy; vx *= 0.92; vy *= 0.92;
      if (Math.abs(vx) + Math.abs(vy) < 1e-5) { vx = vy = 0; }
    }
    resizeIfNeeded();
    const aspect = Math.min(W, H);
    gl.clearColor(0.012, 0.02, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U("uScaleOff_x"), cam.scale, cam.x);
    gl.uniform2f(U("uScaleOff_y"), cam.scale, cam.y);
    gl.uniform1f(U("uAspectX"), aspect / W);
    gl.uniform1f(U("uAspectY"), aspect / H);
    gl.uniform1f(U("uTime"), (now - t0) / 1000);
    gl.uniform1f(U("uDpr"), dpr);
    gl.uniform1f(U("uIntro"), Math.min(1, (now - t0) / 1400));
    gl.drawArrays(gl.POINTS, 0, N);
    placeLabels();
    requestAnimationFrame(frame);
  }
  let sized = false;
  function resizeIfNeeded() {
    if (!sized || canvas.clientWidth !== W || canvas.clientHeight !== H) { resize(); sized = true; }
  }

  /* --------------------------------------------------------------- boot -- */
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // Shareable views: ?zoom=1.8&x=0.1&y=-0.3 restores a camera position.
  const qs = new URLSearchParams(location.search);
  if (qs.get("zoom")) cam.scale = Math.max(0.35, Math.min(40, parseFloat(qs.get("zoom")) || cam.scale));
  if (qs.get("x")) cam.x = parseFloat(qs.get("x")) || 0;
  if (qs.get("y")) cam.y = parseFloat(qs.get("y")) || 0;

  const built = DATA.built_at ? Math.round((Date.now() / 1000 - DATA.built_at) / 60) : null;
  $("stats").textContent =
    `${DATA.counts.total.toLocaleString("en-US")} open questions · ` +
    `Polymarket ${DATA.counts.polymarket.toLocaleString("en-US")} · ` +
    `Kalshi ${DATA.counts.kalshi.toLocaleString("en-US")} · ` +
    `Manifold ${DATA.counts.manifold.toLocaleString("en-US")}` +
    (built !== null ? ` · sky built ${built < 90 ? built + "m" : Math.round(built / 60) + "h"} ago` : "");
  applyStates();
  requestAnimationFrame(frame);
})();
