/* Hero animation: top-down view of a UAV flying below a forest canopy.
   A rotating LiDAR beam reveals tree trunks as point returns that persist as a map,
   while the UAV weaves between trunks toward sampling targets.
   Purely decorative; contains no project content (this file is published unencrypted). */
(function () {
  "use strict";
  var canvas = document.getElementById("dc7-canopy");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hudPts = document.getElementById("dc7-hud-pts");
  var hudPose = document.getElementById("dc7-hud-pose");

  var W = 0, H = 0, DPR = 1;
  var trunks = [], points = [], trail = [], targets = [];
  var camX = 0, spawnX = 0, nextTarget = 600;
  var drone = { x: 0, y: 0, vy: 0, heading: 0 };
  var sweep = 0, time = 0, running = true, visible = true, totalPts = 0;

  var RANGE = 280, SPEED = 1.15, MAX_POINTS = 6500, DRONE_FX = 0.62;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    var r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    DRONE_FX = W < 760 ? 0.5 : 0.62;
    RANGE = Math.max(180, Math.min(360, W * 0.26));
  }

  function spawnUntil(xMax) {
    // Poisson-ish placement of trunks (and small undergrowth) in world coordinates.
    while (spawnX < xMax) {
      spawnX += rand(18, 34);
      var n = Math.random() < 0.5 ? 1 : 2;
      for (var i = 0; i < n; i++) {
        var y = rand(-40, H + 40);
        var big = Math.random() < 0.75;
        var t = { x: spawnX + rand(-10, 10), y: y, r: big ? rand(7, 16) : rand(2.5, 5) };
        // keep a little clearance around the flight band so the path stays plausible
        var ok = true;
        for (var j = trunks.length - 1; j >= 0 && j > trunks.length - 30; j--) {
          var o = trunks[j], dx = o.x - t.x, dy = o.y - t.y;
          if (dx * dx + dy * dy < Math.pow(o.r + t.r + 26, 2)) { ok = false; break; }
        }
        if (ok) trunks.push(t);
      }
    }
  }

  function reset() {
    trunks = []; points = []; trail = []; targets = [];
    camX = 0; spawnX = -W * 0.2; totalPts = 0; nextTarget = W * 0.9;
    drone.x = W * DRONE_FX; drone.y = H * 0.55; drone.vy = 0; drone.heading = 0;
    spawnUntil(W * 1.6);
    // clear trunks too close to the start position
    trunks = trunks.filter(function (t) { var dx = t.x - drone.x, dy = t.y - drone.y; return dx * dx + dy * dy > Math.pow(t.r + 40, 2); });
  }

  function steer() {
    // Look-ahead repulsion from trunks plus a gentle pull toward the next target or mid-band.
    var goalY = H * (0.5 + 0.18 * Math.sin(time * 0.0016));
    for (var k = 0; k < targets.length; k++) {
      if (!targets[k].done && targets[k].x > drone.x) { goalY = targets[k].y; break; }
    }
    var ay = (goalY - drone.y) * 0.0009;
    for (var i = 0; i < trunks.length; i++) {
      var t = trunks[i], dx = t.x - drone.x;
      if (dx < -10 || dx > 140) continue;
      var dy = drone.y - t.y, d = Math.sqrt(dx * dx + dy * dy) - t.r;
      if (d < 70) { var f = (70 - d) / 70; ay += (dy >= 0 ? 1 : -1) * f * f * 0.55 * (1 - dx / 160); }
    }
    drone.vy = (drone.vy + ay) * 0.9;
    drone.vy = Math.max(-2.2, Math.min(2.2, drone.vy));
    drone.y += drone.vy;
    drone.y = Math.max(H * 0.12, Math.min(H * 0.9, drone.y));
    drone.x += SPEED;
    drone.heading = Math.atan2(drone.vy, SPEED);
  }

  function castRays(n) {
    for (var k = 0; k < n; k++) {
      sweep += 0.052;
      var a = sweep, cx = Math.cos(a), cy = Math.sin(a), best = RANGE, hit = null;
      for (var i = 0; i < trunks.length; i++) {
        var t = trunks[i], ox = t.x - drone.x, oy = t.y - drone.y;
        if (Math.abs(ox) > RANGE + t.r || Math.abs(oy) > RANGE + t.r) continue;
        var b = ox * cx + oy * cy; if (b < 0) continue;
        var c = ox * ox + oy * oy - t.r * t.r, disc = b * b - c;
        if (disc < 0) continue;
        var s = b - Math.sqrt(disc);
        if (s > 0 && s < best) { best = s; hit = t; }
      }
      if (hit) {
        points.push({ x: drone.x + cx * best + rand(-0.8, 0.8), y: drone.y + cy * best + rand(-0.8, 0.8), b: time, s: hit.r > 6 ? 1 : 0.6 });
        totalPts++;
      } else if (Math.random() < 0.18) {
        // sparse ground / undergrowth returns
        var g = rand(0.35, 1) * RANGE;
        points.push({ x: drone.x + cx * g, y: drone.y + cy * g, b: time, s: 0.25 });
        totalPts++;
      }
    }
    if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
  }

  function updateTargets() {
    if (drone.x + W * 0.7 > nextTarget) {
      // place a sampling target in open space ahead
      for (var tries = 0; tries < 20; tries++) {
        var tx = nextTarget, ty = rand(H * 0.25, H * 0.8), clear = true;
        for (var i = 0; i < trunks.length; i++) {
          var t = trunks[i], dx = t.x - tx, dy = t.y - ty;
          if (dx * dx + dy * dy < Math.pow(t.r + 45, 2)) { clear = false; break; }
        }
        if (clear) { targets.push({ x: tx, y: ty, done: false, at: 0 }); break; }
      }
      nextTarget += rand(W * 0.55, W * 0.85);
    }
    for (var k = 0; k < targets.length; k++) {
      var g = targets[k];
      if (!g.done && Math.abs(g.x - drone.x) < 14 && Math.abs(g.y - drone.y) < 40) { g.done = true; g.at = time; }
    }
  }

  function step() {
    time += 16;
    steer();
    castRays(14);
    updateTargets();
    trail.push({ x: drone.x, y: drone.y });
    if (trail.length > 420) trail.shift();
    camX = drone.x - W * DRONE_FX;
    spawnUntil(camX + W * 1.6);
    // cull
    var minX = camX - 80;
    if (trunks.length && trunks[0].x < minX) trunks = trunks.filter(function (t) { return t.x > minX; });
    if (targets.length && targets[0].x < minX) targets = targets.filter(function (t) { return t.x > minX; });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(-camX, 0);

    // unseen forest (very faint) so the scene has depth before it is mapped
    ctx.fillStyle = "rgba(94,234,212,0.035)";
    for (var u = 0; u < trunks.length; u++) { var tu = trunks[u]; if (tu.x < camX - 20 || tu.x > camX + W + 20) continue; ctx.beginPath(); ctx.arc(tu.x, tu.y, tu.r, 0, Math.PI * 2); ctx.fill(); }

    // range rings
    ctx.strokeStyle = "rgba(94,234,212,0.07)"; ctx.lineWidth = 1;
    for (var rr = 1; rr <= 3; rr++) { ctx.beginPath(); ctx.arc(drone.x, drone.y, RANGE * rr / 3, 0, Math.PI * 2); ctx.stroke(); }

    // sweep wedge
    var grad = ctx.createRadialGradient(drone.x, drone.y, 0, drone.x, drone.y, RANGE);
    grad.addColorStop(0, "rgba(94,234,212,0.16)"); grad.addColorStop(1, "rgba(94,234,212,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(drone.x, drone.y); ctx.arc(drone.x, drone.y, RANGE, sweep - 0.55, sweep); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(153,246,228,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(drone.x, drone.y); ctx.lineTo(drone.x + Math.cos(sweep) * RANGE, drone.y + Math.sin(sweep) * RANGE); ctx.stroke();

    // map points (persist, slowly fading)
    for (var i = 0; i < points.length; i++) {
      var p = points[i]; if (p.x < camX - 5 || p.x > camX + W + 5) continue;
      var age = (time - p.b) / 1000;
      var fresh = Math.max(0, 1 - age * 2.2);
      var alpha = Math.max(0.14, 0.95 * p.s * Math.exp(-age / 16)) + fresh * 0.3;
      ctx.fillStyle = fresh > 0.05 ? "rgba(220,255,248," + Math.min(1, alpha) + ")" : "rgba(94,234,212," + alpha + ")";
      var sz = p.s < 0.5 ? 1 : 1.6;
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }

    // sampling targets
    for (var k = 0; k < targets.length; k++) {
      var g = targets[k], pulse = (time / 900) % 1;
      ctx.strokeStyle = g.done ? "rgba(245,185,66,0.35)" : "rgba(245,185,66,0.85)";
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(g.x, g.y, 14, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      if (!g.done) {
        ctx.strokeStyle = "rgba(245,185,66," + (0.5 * (1 - pulse)) + ")";
        ctx.beginPath(); ctx.arc(g.x, g.y, 14 + pulse * 18, 0, Math.PI * 2); ctx.stroke();
      } else if (time - g.at < 1400) {
        var q = (time - g.at) / 1400;
        ctx.strokeStyle = "rgba(245,185,66," + (0.9 * (1 - q)) + ")"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(g.x, g.y, 14 + q * 40, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = g.done ? "rgba(245,185,66,0.5)" : "#f5b942";
      ctx.beginPath(); ctx.arc(g.x, g.y, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    // trajectory
    if (trail.length > 2) {
      ctx.lineWidth = 1.6;
      for (var j = 1; j < trail.length; j++) {
        var a = j / trail.length;
        ctx.strokeStyle = "rgba(245,185,66," + (a * 0.75) + ")";
        ctx.beginPath(); ctx.moveTo(trail[j - 1].x, trail[j - 1].y); ctx.lineTo(trail[j].x, trail[j].y); ctx.stroke();
      }
    }

    // drone glyph
    ctx.translate(drone.x, drone.y); ctx.rotate(drone.heading);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(-7, 7); ctx.lineTo(7, -7); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.2;
    [[-7, -7], [7, 7], [-7, 7], [7, -7]].forEach(function (c) { ctx.beginPath(); ctx.arc(c[0], c[1], 4.2, 0, Math.PI * 2); ctx.stroke(); });
    ctx.fillStyle = "#5eead4"; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  var hudTick = 0;
  function hud() {
    if (++hudTick % 6) return;
    if (hudPts) hudPts.textContent = totalPts.toLocaleString("en-GB");
    if (hudPose) hudPose.textContent = (drone.x / 40).toFixed(1) + ", " + ((H - drone.y) / 40).toFixed(1) + " m";
  }

  function frame() {
    if (running && visible) { step(); draw(); hud(); }
    requestAnimationFrame(frame);
  }

  resize(); reset();
  window.addEventListener("resize", function () { var oldH = H; resize(); if (Math.abs(H - oldH) > 60) reset(); });

  if (reduce) {
    for (var i = 0; i < 520; i++) step();
    draw(); hud(); hudTick = 5; hud();
    return;
  }
  for (var w = 0; w < 260; w++) step(); // start with a partial map
  draw(); hudTick = 5; hud();
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(canvas);
  }
  document.addEventListener("visibilitychange", function () { running = !document.hidden; });
  requestAnimationFrame(frame);
})();
