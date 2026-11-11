/* KENAN360 \u2014 Official Lineup Master render engine.
 * One drawing function used by both the browser editor (preview/export)
 * and the credit-free local renderer, so every output matches.
 * No network, no AI: everything here is deterministic canvas drawing.
 */
(function (root) {
  "use strict";

  const MASTER = {
    id: "kenan360-official-lineup-master",
    name: "KENAN360 \u2014 OFFICIAL LINEUP MASTER",
    version: 1,
    width: 1080, height: 1920, fps: 30, duration: 30,
    bpm: 120,
    introEnd: 4, finaleStart: 25,
    colors: { orange: "#FF6A13", amber: "#FFB347", white: "#FFFFFF", black: "#0A0604" },
    // club lighting colour (lasers, haze, grade) \u2014 red per the brief; text stays KENAN360 orange
    light: { r: 255, g: 34, b: 40 },
    fonts: { display: "K360Display", body: "K360Body", condense: 0.88 },
    transitions: { flash: 0.18, punch: 0.07 },
    // background slot -> clip key; clip keys map to uploaded footage (or procedural fallback)
    backgrounds: { intro: "skyline", reveal: ["lasers", "bottles", "toast"], finale: "skyline" },
    clipLabels: { skyline: "Rooftop skyline", lasers: "Red club girls", bottles: "Sparkler bottles", toast: "Disco dance floor" },
    export: { videoBitrate: 12000000, crf: 18, audioFadeOut: 1.5 }
  };

  // ---------- timeline ----------
  function timeline(preset, n) {
    const P = preset || MASTER;
    n = Math.max(1, n | 0);
    const segs = [{ type: "intro", t0: 0, t1: P.introEnd, slot: "intro", clip: P.backgrounds.intro }];
    const span = (P.finaleStart - P.introEnd) / n;
    for (let i = 0; i < n; i++) {
      segs.push({ type: "reveal", index: i, t0: P.introEnd + i * span, t1: P.introEnd + (i + 1) * span,
        slot: "reveal" + (i + 1), clip: P.backgrounds.reveal[i % P.backgrounds.reveal.length] });
    }
    segs.push({ type: "finale", t0: P.finaleStart, t1: P.duration, slot: "finale", clip: P.backgrounds.finale });
    return segs;
  }
  function segmentAt(segs, t) {
    for (const s of segs) if (t >= s.t0 && t < s.t1) return s;
    return segs[segs.length - 1];
  }
  // How a clip of length clipDur maps onto a segment: slow it down if it is shorter.
  function clipRate(seg, clipDur) {
    const d = seg.t1 - seg.t0;
    if (!clipDur || !isFinite(clipDur)) return 1;
    return Math.max(0.5, Math.min(1, (clipDur - 0.05) / d));
  }
  function clipTime(seg, t, clipDur) {
    const u = Math.max(0, t - seg.t0);
    const r = clipRate(seg, clipDur);
    return clipDur ? Math.min(clipDur - 0.04, u * r) : u * r;
  }

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (x) => { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); };
  const easeBack = (x) => { x = clamp(x, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const ramp = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function font(P, kind, size) {
    return (kind === "body" ? "700 " : "900 italic ") + size + "px " + (kind === "body" ? P.fonts.body : P.fonts.display) + ", sans-serif";
  }
  function measure(ctx, P, text, kind, size, tracking) {
    ctx.font = font(P, kind, size);
    const cond = kind === "body" ? 1 : P.fonts.condense;
    let w = 0; for (const ch of text) w += ctx.measureText(ch).width + (tracking || 0);
    if (text.length) w -= (tracking || 0);
    return w * cond;
  }
  // Draw text centered at (x, y) with optional glow, tracking and auto-fit width.
  function text(ctx, P, str, x, y, o) {
    o = o || {};
    let size = o.size || 100; const kind = o.kind || "display"; const tr = o.tracking || 0;
    if (o.maxWidth) { while (size > 20 && measure(ctx, P, str, kind, size, tr * size / (o.size || size)) > o.maxWidth) size -= 2; }
    const track = tr ? tr * size / (o.size || size) : 0;
    const cond = kind === "body" ? 1 : P.fonts.condense;
    const w = measure(ctx, P, str, kind, size, track);
    ctx.save();
    ctx.globalAlpha *= (o.alpha == null ? 1 : o.alpha);
    ctx.translate(x, y);
    if (o.scale) ctx.scale(o.scale, o.scale);
    ctx.scale(cond, 1);
    ctx.font = font(P, kind, size);
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    let cx = -(w / cond) / 2;
    if (o.align === "left") cx = 0;
    const draw = () => { let px = cx; for (const ch of str) { ctx.fillText(ch, px, 0); px += ctx.measureText(ch).width + track; } };
    if (o.shadow !== false) { ctx.shadowColor = "rgba(0,0,0,0.75)"; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetY = size * 0.04; ctx.fillStyle = "rgba(0,0,0,0.01)"; draw(); }
    ctx.shadowOffsetY = 0;
    if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.glowBlur || size * 0.35; }
    else ctx.shadowBlur = 0;
    ctx.fillStyle = o.color || "#fff";
    draw();
    ctx.restore();
    return { size, width: w };
  }
  // A two-colour word pair like KENAN + 360 drawn as one centered unit.
  function pair(ctx, P, a, b, x, y, size, o) {
    o = o || {};
    while (size > 40 && measure(ctx, P, a + b, "display", size) > (o.maxWidth || 960)) size -= 4;
    const wa = measure(ctx, P, a, "display", size), wb = measure(ctx, P, b, "display", size);
    const gap = size * 0.02, total = wa + wb + gap;
    text(ctx, P, a, x - total / 2 + wa / 2, y, { size, color: P.colors.white, alpha: o.alpha, scale: o.scale });
    text(ctx, P, b, x + total / 2 - wb / 2, y, { size, color: P.colors.orange, glow: "rgba(255,106,19,0.85)", alpha: o.alpha, scale: o.scale });
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function coverDraw(ctx, src, x, y, w, h, fx, fy, zoom) {
    const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return false;
    const s = Math.max(w / sw, h / sh) * (zoom || 1);
    const dw = sw * s, dh = sh * s;
    const dx = x + (w - dw) * clamp(fx == null ? 0.5 : fx, 0, 1), dy = y + (h - dh) * clamp(fy == null ? 0.5 : fy, 0, 1);
    ctx.drawImage(src, dx, dy, dw, dh);
    return true;
  }

  // ---------- procedural layers (credit-free backgrounds + overlays) ----------
  function proceduralBackdrop(ctx, P, t, seed) {
    const W = P.width, H = P.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#14030a"); g.addColorStop(0.55, "#2e0508"); g.addColorStop(1, "#060203");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // amber haze
    const R = rng(seed + 7);
    for (let i = 0; i < 5; i++) {
      const hx = W * (0.15 + 0.7 * R()) + Math.sin(t * 0.3 + i) * 60, hy = H * (0.25 + 0.4 * R());
      const rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 520);
      rg.addColorStop(0, lc(P, 0.24)); rg.addColorStop(1, lc(P, 0));
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    // Wasatch mountains with an orange dusk rim, then the SLC skyline
    mountains(ctx, P, seed);
    const S = rng(seed + 99); let x = -20; const base = H * 0.80;
    ctx.fillStyle = "#050201";
    while (x < W + 20) {
      const bw = 60 + S() * 120, bh = 160 + S() * 520;
      ctx.fillRect(x, base - bh, bw, bh + H);
      for (let wy = base - bh + 18; wy < base - 10; wy += 26) for (let wx = x + 10; wx < x + bw - 12; wx += 22) {
        if (S() < 0.35) { ctx.fillStyle = "rgba(255," + (150 + (S() * 80 | 0)) + ",60," + (0.35 + 0.5 * S()) + ")"; ctx.fillRect(wx, wy, 8, 12); ctx.fillStyle = "#050201"; }
      }
      x += bw + 6;
    }
    railing(ctx, P);
    crowd(ctx, P, t, seed);
  }
  function mountains(ctx, P, seed) {
    const W = P.width, H = P.height, R = rng(seed + 55);
    const sky = ctx.createLinearGradient(0, H * 0.32, 0, H * 0.62);
    sky.addColorStop(0, "rgba(255,90,20,0)"); sky.addColorStop(1, "rgba(255,110,30,0.45)");
    ctx.fillStyle = sky; ctx.fillRect(0, H * 0.32, W, H * 0.3);
    [[0.47, "#1a0804", 0.16], [0.53, "#0b0402", 0.11]].forEach(([yb, col, amp], layer) => {
      const pts = []; let y = H * yb;
      for (let x = -40; x <= W + 40; x += 40) { y += (R() - 0.5) * 70; y = clamp(y, H * (yb - amp), H * (yb + 0.03)); pts.push([x, y]); }
      ctx.beginPath(); ctx.moveTo(-40, H); pts.forEach(([x, yy]) => ctx.lineTo(x, yy)); ctx.lineTo(W + 40, H); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      if (layer === 0) { // snow/rim light on the far ridge
        ctx.save(); ctx.strokeStyle = "rgba(255,170,110,0.55)"; ctx.lineWidth = 3; ctx.beginPath();
        pts.forEach(([x, yy], i) => (i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy))); ctx.stroke(); ctx.restore();
      }
    });
  }
  function railing(ctx, P) { // glass rooftop railing in the foreground
    const W = P.width, H = P.height, y = H * 0.83;
    ctx.save(); ctx.fillStyle = "rgba(255,140,60,0.06)"; ctx.fillRect(0, y, W, H * 0.07);
    ctx.fillStyle = "#1a0b05"; ctx.fillRect(0, y - 6, W, 10);
    ctx.strokeStyle = "rgba(255,160,80,0.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, y - 6); ctx.lineTo(W, y - 6); ctx.stroke();
    for (let x = 30; x < W; x += 180) { ctx.fillStyle = "#1a0b05"; ctx.fillRect(x, y, 8, H * 0.07); }
    ctx.restore();
  }
  function crowd(ctx, P, t, seed) {
    const W = P.width, H = P.height, beat = beatPulse(P, t);
    const R = rng(seed + 3);
    ctx.save(); ctx.fillStyle = "#020100";
    for (let i = 0; i < 26; i++) {
      const x = (i / 25) * W + (R() - 0.5) * 40, bob = Math.sin(t * 4 + i) * 8 + beat * 10 * R();
      const y = H * 0.9 + R() * 60 - bob, r = 34 + R() * 16;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - r * 1.5, y + r * 0.6, r * 3, H);
      if (R() < 0.3) { ctx.save(); ctx.translate(x + r, y); ctx.rotate(-0.4 - R() * 0.4); ctx.fillRect(0, -10, 16, -170 - bob * 2); ctx.restore(); }
    }
    ctx.restore();
  }
  function lc(P, a, lift) { const L = P.light || { r: 255, g: 34, b: 40 }, k = lift || 0; return "rgba(" + L.r + "," + Math.min(255, L.g + k) + "," + Math.min(255, L.b + k) + "," + a + ")"; }
  function beatPulse(P, t) { const ph = (t * P.bpm / 60) % 1; return Math.exp(-ph * 6); }
  function lasers(ctx, P, t, strength, seed) {
    const W = P.width, H = P.height;
    const R = rng(seed + 11), beat = beatPulse(P, t);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const origins = [[W * 0.12, -30], [W * 0.5, -40], [W * 0.88, -30]];
    origins.forEach(([ox, oy], k) => {
      for (let b = 0; b < 3; b++) {
        const a = Math.PI / 2 + Math.sin(t * (0.6 + 0.25 * b) + k * 2.1 + R() * 6) * 0.75;
        const len = H * 1.4, ex = ox + Math.cos(a) * len, ey = oy + Math.sin(a) * len;
        const al = strength * (0.35 + 0.65 * beat) * (0.55 + 0.45 * Math.sin(t * 2 + b + k));
        ctx.strokeStyle = lc(P, 0.12 * al); ctx.lineWidth = 36;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = lc(P, 0.7 * al, 60); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      }
    });
    ctx.restore();
  }
  function sparkles(ctx, P, t, amount, seed) {
    const W = P.width, H = P.height, R = rng(seed + 31);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const n = (110 * amount) | 0;
    for (let i = 0; i < n; i++) {
      const sx = R() * W, sy0 = R() * H, vy = 40 + R() * 140, ph = R() * 6.28, fr = 2 + R() * 6, big = R() < 0.12;
      const x = sx + Math.sin(t * 1.3 + ph) * 18, y = (sy0 + vy * t) % (H + 40) - 20;
      const tw = 0.3 + 0.7 * Math.pow(Math.max(0, Math.sin(t * fr + ph)), 2);
      const r = big ? 3.2 : 1.6;
      ctx.fillStyle = "rgba(255," + (190 + (R() * 50 | 0)) + ",120," + (0.75 * tw) + ")";
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      if (big && tw > 0.6) { ctx.fillStyle = "rgba(255,230,190," + (0.5 * tw) + ")"; ctx.fillRect(x - 14, y - 0.8, 28, 1.6); ctx.fillRect(x - 0.8, y - 14, 1.6, 28); }
    }
    ctx.restore();
  }
  function grade(ctx, P, darkness) {
    const W = P.width, H = P.height;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = lc(P, 1, 70); ctx.globalAlpha = 0.38; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(0,0,0," + (0.35 * darkness) + ")"); g.addColorStop(0.45, "rgba(0,0,0," + (0.15 * darkness) + ")");
    g.addColorStop(0.75, "rgba(0,0,0," + (0.55 * darkness) + ")"); g.addColorStop(1, "rgba(0,0,0," + (0.9 * darkness) + ")");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.45, H * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // ---------- scenes ----------
  function background(ctx, P, seg, t, bgSrc, darkness, seed) {
    const W = P.width, H = P.height, u = t - seg.t0;
    const punch = 1 + P.transitions.punch * Math.exp(-u * 9) + 0.035 * (u / (seg.t1 - seg.t0));
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(punch, punch); ctx.translate(-W / 2, -H / 2);
    if (!(bgSrc && coverDraw(ctx, bgSrc, 0, 0, W, H, 0.5, 0.5, 1))) proceduralBackdrop(ctx, P, t, seed);
    ctx.restore();
    grade(ctx, P, darkness);
    lasers(ctx, P, t, bgSrc ? 0.55 : 1, seed);
    sparkles(ctx, P, t, 1, seed);
  }

  function drawIntro(ctx, P, seg, t, ev) {
    const W = P.width, u = t - seg.t0, cy = 860;
    text(ctx, P, (ev.presenterLine || "").toUpperCase(), W / 2, cy - 250, { kind: "body", size: 34, tracking: 18, alpha: ease(ramp(u, 0.15, 0.6)), shadow: true });
    const a = ease(ramp(u, 0.1, 0.55)), sc = 1.35 - 0.35 * easeBack(ramp(u, 0.1, 0.55));
    pair(ctx, P, ev.brandA || "KENAN", ev.brandB || "360", W / 2, cy - 90, 250, { alpha: a, scale: sc });
    text(ctx, P, "PRESENTS", W / 2, cy + 70, { kind: "body", size: 52, tracking: 30, alpha: ease(ramp(u, 0.55, 0.9)) });
    const rw = 520 * ease(ramp(u, 0.8, 1.2));
    ctx.save(); ctx.shadowColor = P.colors.orange; ctx.shadowBlur = 24; ctx.fillStyle = P.colors.orange;
    ctx.fillRect(W / 2 - rw / 2, cy + 140, rw, 8); ctx.restore();
    const dA = ease(ramp(u, 1.15, 1.5)), dy = 40 * (1 - dA);
    text(ctx, P, (ev.title || "").toUpperCase(), W / 2, cy + 250 + dy, { size: 92, color: P.colors.white, alpha: dA, maxWidth: 960 });
    text(ctx, P, ((ev.dayOfWeek || "") + " \u2022 " + (ev.date || "")).toUpperCase(), W / 2, cy + 370 + dy, { size: 104, color: P.colors.orange, glow: "rgba(255,106,19,0.8)", alpha: ease(ramp(u, 1.35, 1.7)), maxWidth: 960 });
    text(ctx, P, (ev.venue || "").toUpperCase(), W / 2, cy + 470, { kind: "body", size: 34, tracking: 10, alpha: ease(ramp(u, 1.6, 2.0)), maxWidth: 960 });
  }

  function drawReveal(ctx, P, seg, t, ev, artist, total) {
    const W = P.width, D = seg.t1 - seg.t0, u = t - seg.t0;
    const cw = 840, ch = 1060, cx = (W - cw) / 2, cyTop = 300;
    const enter = ease(ramp(u, 0, 0.45)), exit = ease(ramp(u, D - 0.35, D));
    const sc = (1.08 - 0.08 * enter) * (1 + 0.12 * exit), slide = 140 * (1 - enter);
    const alpha = enter * (1 - exit);
    // label
    text(ctx, P, "LINEUP  " + String(seg.index + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0"), W / 2, 220, { kind: "body", size: 32, tracking: 16, color: P.colors.orange, alpha: alpha });
    // card
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(W / 2, cyTop + ch / 2 + slide); ctx.scale(sc, sc); ctx.translate(-W / 2, -(cyTop + ch / 2));
    const beat = beatPulse(P, t);
    ctx.save(); ctx.shadowColor = "rgba(255,106,19," + (0.65 + 0.3 * beat) + ")"; ctx.shadowBlur = 60 + 30 * beat;
    roundRect(ctx, cx, cyTop, cw, ch, 40); ctx.fillStyle = "#140803"; ctx.fill(); ctx.restore();
    ctx.save(); roundRect(ctx, cx, cyTop, cw, ch, 40); ctx.clip();
    const crop = (artist && artist.crop) || { x: 0.5, y: 0.3, zoom: 1 };
    const kb = 1 + 0.07 * (u / D);
    let drew = false;
    if (artist && artist.img) drew = coverDraw(ctx, artist.img, cx, cyTop, cw, ch, crop.x, crop.y, (crop.zoom || 1) * kb);
    if (!drew) {
      const g = ctx.createLinearGradient(cx, cyTop, cx, cyTop + ch); g.addColorStop(0, "#3a1606"); g.addColorStop(1, "#0c0502");
      ctx.fillStyle = g; ctx.fillRect(cx, cyTop, cw, ch);
      text(ctx, P, "PHOTO", W / 2, cyTop + ch / 2, { kind: "body", size: 40, tracking: 14, color: "rgba(255,255,255,0.35)", shadow: false });
    }
    // bottom fade inside the card so the name reads
    const fg = ctx.createLinearGradient(0, cyTop + ch * 0.55, 0, cyTop + ch);
    fg.addColorStop(0, "rgba(10,4,2,0)"); fg.addColorStop(1, "rgba(10,4,2,0.85)");
    ctx.fillStyle = fg; ctx.fillRect(cx, cyTop, cw, ch);
    // orange grade + light sweep
    ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = "rgba(255,120,40,0.35)"; ctx.fillRect(cx, cyTop, cw, ch);
    ctx.globalCompositeOperation = "lighter";
    const sp = ramp(u, 0.45, 1.25);
    if (sp > 0 && sp < 1) {
      const sx = cx - 400 + (cw + 800) * sp;
      const sg = ctx.createLinearGradient(sx - 160, cyTop, sx + 160, cyTop + 300);
      sg.addColorStop(0, "rgba(255,200,150,0)"); sg.addColorStop(0.5, "rgba(255,220,180,0.45)"); sg.addColorStop(1, "rgba(255,200,150,0)");
      ctx.fillStyle = sg; ctx.fillRect(cx, cyTop, cw, ch);
    }
    ctx.restore();
    ctx.save(); roundRect(ctx, cx, cyTop, cw, ch, 40); ctx.lineWidth = 6; ctx.strokeStyle = P.colors.orange;
    ctx.shadowColor = P.colors.orange; ctx.shadowBlur = 30; ctx.stroke(); ctx.restore();
    ctx.restore();
    // name slam
    const name = ((artist && artist.name) || "TBA").toUpperCase();
    const nu = ramp(u, 0.35, 0.65);
    const nscale = 1.6 - 0.6 * easeBack(nu), nA = ease(nu) * (1 - exit);
    text(ctx, P, name, W / 2, 1500, { size: 200, color: P.colors.white, alpha: nA, scale: nscale, maxWidth: 980 });
    const sw = 560 * ease(ramp(u, 0.6, 0.95)) * (1 - exit);
    ctx.save(); ctx.globalAlpha = 1 - exit; ctx.shadowColor = P.colors.orange; ctx.shadowBlur = 28; ctx.fillStyle = P.colors.orange;
    ctx.beginPath(); ctx.moveTo(W / 2 - sw / 2, 1618); ctx.lineTo(W / 2 + sw / 2, 1604); ctx.lineTo(W / 2 + sw / 2 - 12, 1616); ctx.lineTo(W / 2 - sw / 2 + 6, 1626); ctx.fill(); ctx.restore();
    const tag = ((artist && artist.tagline) || "").toUpperCase();
    if (tag) text(ctx, P, tag, W / 2, 1690, { size: 64, color: P.colors.orange, glow: "rgba(255,106,19,0.8)", alpha: ease(ramp(u, 0.8, 1.15)) * (1 - exit), maxWidth: 960 });
    text(ctx, P, ("LIVE \u2022 " + (ev.dayOfWeek || "") + " " + (ev.date || "")).toUpperCase(), W / 2, tag ? 1790 : 1700, { kind: "body", size: 32, tracking: 14, alpha: ease(ramp(u, 1.0, 1.4)) * (1 - exit), maxWidth: 960 });
  }

  function drawFinale(ctx, P, seg, t, ev, artists) {
    const W = P.width, u = t - seg.t0;
    text(ctx, P, ((ev.brandA || "KENAN") + (ev.brandB || "360") + " PRESENTS").toUpperCase(), W / 2, 330, { kind: "body", size: 34, tracking: 16, alpha: ease(ramp(u, 0.05, 0.4)) });
    text(ctx, P, (ev.title || "").toUpperCase(), W / 2, 450, { size: 96, color: P.colors.white, alpha: ease(ramp(u, 0.1, 0.45)), maxWidth: 960 });
    const n = artists.length, size = n <= 3 ? 150 : n <= 5 ? 116 : 90, gap = size * 1.12;
    const top = 830 - ((n - 1) * gap) / 2;
    artists.forEach((a, i) => {
      const p = ease(ramp(u, 0.25 + i * 0.14, 0.6 + i * 0.14));
      const off = (i % 2 ? 1 : -1) * 220 * (1 - p);
      text(ctx, P, ((a && a.name) || "TBA").toUpperCase(), W / 2 + off, top + i * gap, { size, color: P.colors.white, alpha: p, maxWidth: 960 });
      if (i < n - 1) {
        ctx.save(); ctx.globalAlpha = p; ctx.fillStyle = P.colors.orange; ctx.shadowColor = P.colors.orange; ctx.shadowBlur = 18;
        ctx.translate(W / 2, top + i * gap + gap / 2); ctx.rotate(Math.PI / 4); ctx.fillRect(-9, -9, 18, 18); ctx.restore();
      }
    });
    const b = ease(ramp(u, 0.9, 1.3)), by = 1300;
    ctx.save(); ctx.globalAlpha = b; roundRect(ctx, 90, by - 85, W - 180, 170, 22); ctx.lineWidth = 5; ctx.strokeStyle = P.colors.orange;
    ctx.shadowColor = P.colors.orange; ctx.shadowBlur = 24; ctx.stroke(); ctx.restore();
    text(ctx, P, ((ev.dayOfWeek || "") + " \u2022 " + (ev.date || "")).toUpperCase(), W / 2, by, { size: 100, color: P.colors.orange, glow: "rgba(255,106,19,0.85)", alpha: b, maxWidth: 860 });
    const c = ease(ramp(u, 1.2, 1.6));
    if (ev.time) text(ctx, P, ev.time.toUpperCase(), W / 2, 1490, { size: 84, color: P.colors.white, alpha: c, maxWidth: 960 });
    text(ctx, P, (ev.venue || "").toUpperCase(), W / 2, 1590, { kind: "body", size: 36, tracking: 10, alpha: c, maxWidth: 960 });
    if (ev.address) text(ctx, P, ev.address.toUpperCase(), W / 2, 1650, { kind: "body", size: 28, tracking: 8, alpha: c, maxWidth: 960 });
    if (ev.age) {
      const d = ease(ramp(u, 1.5, 1.9));
      ctx.save(); ctx.globalAlpha = d; ctx.strokeStyle = P.colors.orange; ctx.lineWidth = 4; ctx.shadowColor = P.colors.orange; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(240, 1760); ctx.lineTo(430, 1760); ctx.moveTo(650, 1760); ctx.lineTo(840, 1760); ctx.stroke(); ctx.restore();
      text(ctx, P, ev.age.toUpperCase(), W / 2, 1760, { size: 80, color: P.colors.orange, glow: "rgba(255,106,19,0.8)", alpha: d });
    }
  }

  /**
   * Draw one frame.
   * state = { preset, event, artists: [{name, tagline, img, crop}], bg: {slotName: drawable|null} }
   */
  function drawFrame(ctx, t, state) {
    const P = state.preset || MASTER, W = P.width, H = P.height;
    const segs = timeline(P, state.artists.length);
    const seg = segmentAt(segs, t);
    const seed = segs.indexOf(seg) * 101 + 17;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    background(ctx, P, seg, t, state.bg && state.bg[seg.slot], seg.type === "reveal" ? 1.25 : seg.type === "finale" ? 1.35 : 1, seed);
    if (seg.type === "intro") drawIntro(ctx, P, seg, t, state.event);
    else if (seg.type === "reveal") drawReveal(ctx, P, seg, t, state.event, state.artists[seg.index], state.artists.length);
    else drawFinale(ctx, P, seg, t, state.event, state.artists);
    // cut flashes on every boundary
    for (const s of segs) {
      if (s.t0 <= 0) continue;
      const d = Math.abs(t - s.t0);
      if (d < P.transitions.flash) {
        const a = Math.pow(1 - d / P.transitions.flash, 2) * 0.85;
        ctx.fillStyle = "rgba(255,170,110," + a + ")"; ctx.fillRect(0, 0, W, H);
      }
    }
    // fade out at the very end
    if (t > P.duration - 0.35) { ctx.fillStyle = "rgba(0,0,0," + ramp(t, P.duration - 0.35, P.duration) + ")"; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  root.K360 = { MASTER, timeline, segmentAt, clipRate, clipTime, drawFrame };
})(typeof window !== "undefined" ? window : globalThis);
