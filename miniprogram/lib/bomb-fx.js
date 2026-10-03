"use strict";

// One deterministic burst per queued bomb event; no timers or touch regions.
const DURATION = 2800;
const TAU = Math.PI * 2;
const COLORS = ["#ffba55", "#ff7768", "#ffd98a", "#ed5265", "#fff4d8"];
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
const seed = (i) => {
  const n = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const PARTICLES = Array.from({ length: 56 }, (_, i) => ({
  angle: i * 2.399963,
  delay: 70 + seed(i) * 210,
  speed: 0.58 + seed(i + 90) * 0.62,
  size: 3 + seed(i + 180) * 6,
  spin: (seed(i + 270) - 0.5) * 12,
  color: COLORS[i % COLORS.length],
  type: i % 3,
}));
function circle(c, x, y, radius, color, alpha) {
  if (radius <= 0 || alpha <= 0) return;
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, radius, 0, TAU);
  c.fill();
}
function star(c, x, y, r, color, alpha, angle = 0) {
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4,
      radius = i % 2 ? r * 0.28 : r;
    const px = Math.cos(a) * radius,
      py = Math.sin(a) * radius;
    if (i) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
  c.fill();
  c.restore();
}
function protect(c, rect, w, h) {
  if (!rect) return;
  const x = clamp(rect.x - 6, 0, w),
    y = clamp(rect.y - 6, 0, h),
    right = clamp(rect.x + rect.w + 6, x, w),
    bottom = clamp(rect.y + rect.h + 6, y, h);
  // Opposite winding makes a rounded hole using the standard nonzero clip.
  // Match the dialog corners rather than leaving a hard rectangular gap.
  const r = Math.min(30, (right - x) / 2, (bottom - y) / 2);
  c.beginPath();
  c.rect(0, 0, w, h);
  c.moveTo(x + r, y);
  c.quadraticCurveTo(x, y, x, y + r);
  c.lineTo(x, bottom - r);
  c.quadraticCurveTo(x, bottom, x + r, bottom);
  c.lineTo(right - r, bottom);
  c.quadraticCurveTo(right, bottom, right, bottom - r);
  c.lineTo(right, y + r);
  c.quadraticCurveTo(right, y, right - r, y);
  c.lineTo(x + r, y);
  c.closePath();
  c.clip();
}
function renderBombFX(ui, elapsed, protectedRect) {
  if (elapsed < 0 || elapsed >= DURATION) return null;
  const c = ui.ctx,
    w = ui.w,
    h = ui.h,
    cx = w / 2,
    cy = protectedRect ? protectedRect.y + protectedRect.h / 2 : h * 0.42,
    farthest = Math.hypot(w / 2, Math.max(cy, h - cy)),
    maxRadius = farthest * 1.12,
    fade = clamp((DURATION - elapsed) / 650),
    entrance = ease(elapsed / 160),
    envelope = fade * entrance;
  c.save();
  protect(c, protectedRect, w, h);

  // A single warm impact wash, rather than repeated full-screen flashes.
  const flash = Math.sin(Math.PI * clamp(elapsed / 520));
  c.globalAlpha = (0.035 + flash * 0.25) * envelope;
  c.fillStyle = "#ff7768";
  c.fillRect(0, 0, w, h);

  // Large cartoon fire petals spread beyond the central announcement.
  const bloom = ease((elapsed - 50) / 380),
    fireFade = clamp((1100 - elapsed) / 650) * envelope;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU,
      reach = bloom * Math.min(w * 0.34, h * 0.2),
      r = bloom * (50 + seed(i + 500) * 52);
    circle(
      c,
      cx + Math.cos(a) * reach,
      cy + Math.sin(a) * reach,
      r,
      i % 2 ? "#ffc96b" : "#ff8f69",
      0.34 * fireFade,
    );
    circle(
      c,
      cx + Math.cos(a) * reach,
      cy + Math.sin(a) * reach,
      r * 0.68,
      "#ffe8ac",
      0.38 * fireFade,
    );
  }

  // Warm radial wedges extend to the whole viewport.
  const rays = ease((elapsed - 60) / 650),
    rayFade = clamp((1550 - elapsed) / 1000) * envelope;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + 0.07,
      spread = 0.018 + seed(i + 400) * 0.02,
      start = 36 + rays * 55,
      end = maxRadius * rays;
    c.globalAlpha = rayFade * (0.2 + seed(i + 450) * 0.13);
    c.fillStyle = i % 3 ? "#ffc36a" : "#ff8977";
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * start, cy + Math.sin(a) * start);
    c.lineTo(cx + Math.cos(a - spread) * end, cy + Math.sin(a - spread) * end);
    c.lineTo(cx + Math.cos(a + spread) * end, cy + Math.sin(a + spread) * end);
    c.closePath();
    c.fill();
  }

  let outerRadius = 0;
  for (const [i, delay] of [80, 260, 480].entries()) {
    const t = (elapsed - delay) / 1400;
    if (t < 0 || t > 1.45) continue;
    const r = maxRadius * ease(t);
    outerRadius = Math.max(outerRadius, r);
    c.globalAlpha = clamp(1 - t / 1.45) * envelope * 0.72;
    c.strokeStyle = i === 1 ? "#ff8276" : "#ffc364";
    c.lineWidth = (1 - clamp(t)) * (i ? 12 : 20) + 2;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.stroke();
  }

  // Spark trails, rotating confetti and four-point stars use fixed seeds.
  PARTICLES.forEach((p) => {
    const t = (elapsed - p.delay) / 2000;
    if (t < 0 || t > 1) return;
    const travel = maxRadius * p.speed * ease(t),
      x = cx + Math.cos(p.angle) * travel,
      y = cy + Math.sin(p.angle) * travel + h * 0.13 * t * t,
      alpha = clamp((1 - t) * 1.65) * envelope;
    c.globalAlpha = alpha * 0.55;
    c.strokeStyle = p.color;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(
      x - Math.cos(p.angle) * (12 + t * 20),
      y - Math.sin(p.angle) * (12 + t * 20),
    );
    c.lineTo(x, y);
    c.stroke();
    if (p.type === 0) star(c, x, y, p.size, p.color, alpha, p.spin * t);
    else if (p.type === 1) circle(c, x, y, p.size * 0.55, p.color, alpha);
    else {
      c.save();
      c.translate(x, y);
      c.rotate(p.spin * t);
      c.globalAlpha = alpha;
      ui.box(-p.size / 2, -p.size, p.size, p.size * 2, p.color, null, 2);
      c.restore();
    }
  });

  // Soft, clustered smoke rises as the sharp blast settles.
  const smoke = clamp((elapsed - 280) / 2300);
  if (elapsed > 280)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU,
        travel = maxRadius * (0.23 + seed(i + 600) * 0.3) * ease(smoke),
        x = cx + Math.cos(a) * travel,
        y = cy + Math.sin(a) * travel - smoke * 55,
        size = 13 + smoke * (30 + seed(i + 650) * 32),
        alpha = Math.sin(smoke * Math.PI) * 0.21 * envelope;
      circle(c, x, y, size, "#d8c4b9", alpha);
      circle(c, x - size * 0.45, y - size * 0.2, size * 0.8, "#f9eadc", alpha);
      circle(c, x + size * 0.45, y - size * 0.4, size * 0.7, "#fff2de", alpha);
    }

  for (let i = 0; i < 18; i++) {
    const t = (elapsed - 400 - seed(i + 720) * 350) / 1500;
    if (t < 0 || t > 1) continue;
    star(
      c,
      w * seed(i + 800),
      h * seed(i + 900),
      (4 + seed(i + 980) * 7) * Math.sin(t * Math.PI),
      COLORS[i % 3],
      Math.sin(t * Math.PI) * envelope,
      0.2,
    );
  }
  c.restore();
  return {
    active: true,
    viewport: { x: 0, y: 0, w, h },
    protectedRect: protectedRect || null,
    origin: { x: cx, y: cy },
    outerRadius,
    duration: DURATION,
  };
}

module.exports = { renderBombFX };
