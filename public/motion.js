'use strict';
// The sideways gestures' motion (backswipe.js, tabswipe.js): how hard the page pulls back past
// an end (rubber band), how fast the finger was going when it lifted, and the spring that
// carries the page on from there to where it settles (off the screen, or back into place).
// Pure but for run(), which drives a spring with requestAnimationFrame: loaded as a plain
// script in the page (window.Motion), required by the tests.
(function (root) {
  // Past an end the page gives less the further it is pulled, as iOS does: x * c * d / (d + c * x).
  // d is the page's size (it never goes past it), c how stiff the band is.
  function rubber(x, d, c = 0.55) {
    if (!x || !(d > 0)) return 0;
    const a = Math.abs(x);
    return (Math.sign(x) * (a * c * d)) / (d + c * a);
  }

  // The finger's speed (px/ms) over the last `win` ms of [{ t, x }] samples; 0 when it had
  // stopped (no sample in the last `still` ms before `now`, the moment it lifted).
  function velocity(samples, now, win = 100, still = 80) {
    if (!samples || samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    if (now != null && now - last.t > still) return 0;
    let first = last;
    for (let i = samples.length - 2; i >= 0 && last.t - samples[i].t <= win; i--) first = samples[i];
    if (first === last) first = samples[samples.length - 2];
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }

  // One step of a critically damped spring (no bounce), exact for any dt: position x (px),
  // velocity v (px/s) toward target `to`, dt in s, w the stiffness (rad/s; settles in about 5/w s).
  function springStep(x, v, to, dt, w) {
    const d = x - to;
    const e = Math.exp(-w * dt);
    const b = v + w * d;
    return { x: to + (d + b * dt) * e, v: (v - w * b * dt) * e };
  }
  // Settled: it reached or crossed the target (it stops there, never past the edge), or it is
  // within eps px (and nearly still, for the last pixel of a page settling back in sight).
  // A page leaving the screen is done a few px short: the rest would be off the screen.
  const settled = (prev, x, v, to, eps = 1) => (prev - to) * (x - to) <= 0 || (Math.abs(x - to) < eps && (eps > 1 || Math.abs(v) < 60));
  // A quicker spring for a quicker finger: a flick finishes fast, a slow release settles gently.
  const stiffness = (v, base) => Math.min(base * 1.7, base + 5 * Math.abs(v || 0));

  // The positions a spring passes through at fixed steps until it settles (for the tests and
  // to know how long a finish takes). v in px/ms, as velocity() gives it.
  function frames(from, v, to, w, eps = 1, dt = 1 / 60, max = 600) {
    const out = [];
    let x = from;
    let vel = v * 1000;
    for (let i = 0; i < max; i++) {
      const n = springStep(x, vel, to, dt, w);
      if (settled(x, n.x, n.v, to, eps)) {
        out.push(to);
        return out;
      }
      x = n.x;
      vel = n.v;
      out.push(x);
    }
    out.push(to);
    return out;
  }

  // Drive a spring on the screen: frame(x) once per animation frame (the caller's one style
  // write), done() after the last. Returns a cancel function.
  function run(from, v, to, w, frame, done, eps = 1) {
    let x = from;
    let vel = v * 1000;
    let last = null;
    let id = 0;
    const step = (t) => {
      const dt = last == null ? 1 / 60 : Math.min(0.064, Math.max(0, (t - last) / 1000));
      last = t;
      const n = springStep(x, vel, to, dt, w);
      if (settled(x, n.x, n.v, to, eps)) {
        id = 0;
        frame(to);
        return done();
      }
      x = n.x;
      vel = n.v;
      frame(x);
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => id && cancelAnimationFrame(id);
  }

  // Stiffness (rad/s): a finish that leaves (commit) is a little quicker than one that settles
  // back; GO_EPS is how short of the edge a leaving page may stop.
  const W_GO = 26;
  const W_BACK = 20;
  const GO_EPS = 4;

  const api = { rubber, velocity, springStep, settled, stiffness, frames, run, W_GO, W_BACK, GO_EPS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Motion = api;
})(typeof self !== 'undefined' ? self : this);
