'use strict';
// 저장소 그래프: the commit graph's layout, folding and drawing, and how many columns the view
// shows. No page needed: loaded as a plain script (window.GitGraph), required by the tests.
//   layout(commits) -> rows: commits in topological order (children first, as git log
//     --topo-order gives them) placed in lanes. Each row: { h, col, up: [cols into the node from
//     above], down: [cols out of the node below], pass: [cols going by], color: { col: n } }.
//     A lane keeps its column while it lives (no shifting): lines are straight down unless they
//     join or leave this row's node. A lane's colour is chosen when it starts.
//   fold(rows, commits, { refs, expanded, keep }) -> the rows to show: a straight run (one parent,
//     one child in the window, no ref) of two or more commits becomes one { fold: true, n, key,
//     pass } row; key is its oldest commit, so a new commit above it keeps it open or shut.
//   rowSvg(row, opts) -> the row's lanes as SVG.
//   cols(width) -> 1, 2 or 3 columns for the view's width.
(function (root) {
  const COLORS = 8; // --gg-0 … --gg-7 in style.css

  function hashName(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // refs: { sha: [names] } — a lane that starts at a named commit takes the name's colour, so a
  // branch keeps its colour as commits come; others count on.
  function layout(commits, refs = {}) {
    const lanes = []; // col -> the sha expected next in it, or null
    const laneColor = [];
    const rows = [];
    let next = 0;
    const free = (from = 0) => {
      for (let i = from; i < lanes.length; i++) if (lanes[i] == null) return i;
      return lanes.length;
    };
    const colorFor = (h) => {
      const names = refs[h];
      if (names && names.length) return hashName(names[0]) % COLORS;
      return next++ % COLORS;
    };
    for (const c of commits) {
      const before = lanes.slice();
      let col = lanes.indexOf(c.h);
      if (col < 0) {
        col = free();
        lanes[col] = c.h;
        laneColor[col] = colorFor(c.h);
      }
      const up = [];
      for (let k = 0; k < before.length; k++) if (before[k] === c.h) up.push(k);
      // Every lane waiting for this commit ends here; its own goes on to the first parent.
      for (const k of up) if (k !== col) lanes[k] = null;
      const color = {};
      for (let k = 0; k < before.length; k++) if (before[k] != null) color[k] = laneColor[k];
      color[col] = laneColor[col];
      const down = [];
      const parents = c.p || [];
      lanes[col] = null;
      parents.forEach((p, i) => {
        const at = lanes.indexOf(p);
        if (at >= 0) {
          // Already awaited in another lane: join it.
          down.push(at);
          return;
        }
        // The first parent goes on in this lane (its colour); another starts a lane of its own.
        const k = i === 0 ? col : free(col + 1);
        lanes[k] = p;
        if (k !== col) laneColor[k] = colorFor(p);
        down.push(k);
      });
      for (const k of down) if (color[k] == null) color[k] = laneColor[k];
      const pass = [];
      for (let k = 0; k < before.length; k++) if (before[k] != null && before[k] !== c.h && lanes[k] === before[k]) pass.push(k);
      while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
      rows.push({ h: c.h, col, up, down, pass, color, width: Math.max(before.length, lanes.length, col + 1) });
    }
    return rows;
  }

  // The rows to show, with straight runs folded. refs: { sha: [names] }; expanded: Set of fold
  // keys open; keep: a sha that must stay visible (the one the address names).
  function fold(rows, commits, { refs = {}, expanded = new Set(), keep = null } = {}) {
    const kids = new Map();
    for (const c of commits) for (const p of c.p || []) kids.set(p, (kids.get(p) || 0) + 1);
    const straight = (c, i) => i > 0 && i < commits.length - 1 && (c.p || []).length === 1 && kids.get(c.h) === 1 && !(refs[c.h] && refs[c.h].length) && c.h !== keep;
    const out = [];
    let i = 0;
    while (i < rows.length) {
      if (!straight(commits[i], i)) {
        out.push(rows[i]);
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && straight(commits[j], j)) j++;
      const key = commits[j - 1].h;
      if (j - i < 2 || expanded.has(key)) {
        for (let k = i; k < j; k++) out.push(rows[k]);
      } else {
        // Every lane alive through the run goes by the fold row; the run's own among them.
        const pass = new Set(rows[i].pass);
        pass.add(rows[i].col);
        const color = { ...rows[i].color };
        out.push({ fold: true, n: j - i, key, from: commits[i].h, pass: [...pass].sort((a, b) => a - b), color, width: rows[i].width });
      }
      i = j;
    }
    return out;
  }

  // One row's lanes as SVG: w a lane's width, hgt the row's height, r the dot. A fold row's lanes
  // are dashed. Colours are classes (gg-c0 …), so the theme sets them.
  function rowSvg(row, { w = 14, hgt = 32, r = 4, maxLanes = Infinity } = {}) {
    const lanesShown = Math.min(row.width || 1, maxLanes);
    const x = (k) => Math.min(k, maxLanes - 1) * w + w / 2;
    const mid = hgt / 2;
    const cls = (k) => `gg-c${(row.color && row.color[k]) || 0}`;
    const parts = [];
    const line = (d, k, extra = '') => parts.push(`<path d="${d}" class="gg-l ${cls(k)}${extra}"/>`);
    for (const k of row.pass || []) line(`M${x(k)} 0V${hgt}`, k, row.fold ? ' gg-fold' : '');
    if (!row.fold) {
      for (const k of row.up) line(k === row.col ? `M${x(k)} 0V${mid}` : `M${x(k)} 0C${x(k)} ${mid} ${x(row.col)} ${mid / 2} ${x(row.col)} ${mid}`, k);
      for (const k of row.down) line(k === row.col ? `M${x(k)} ${mid}V${hgt}` : `M${x(row.col)} ${mid}C${x(row.col)} ${mid * 1.5} ${x(k)} ${mid} ${x(k)} ${hgt}`, k);
      parts.push(`<circle cx="${x(row.col)}" cy="${mid}" r="${r}" class="gg-n ${cls(row.col)}"/>`);
    }
    const width = lanesShown * w;
    return `<svg class="gg" width="${width}" height="${hgt}" viewBox="0 0 ${width} ${hgt}" aria-hidden="true">${parts.join('')}</svg>`;
  }

  // Columns for the view's width (CSS px of the view itself, not the window): the graph alone,
  // graph | commit, or graph | commit | diff.
  const COLS_2 = 720;
  const COLS_3 = 1180;
  const cols = (width) => (width >= COLS_3 ? 3 : width >= COLS_2 ? 2 : 1);

  const api = { layout, fold, rowSvg, cols, COLORS, COLS_2, COLS_3 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GitGraph = api;
})(typeof self !== 'undefined' ? self : this);
