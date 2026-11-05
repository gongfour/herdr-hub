'use strict';
// The API's route table: [method, pattern, run] rows tried in order, the first that matches runs.
// A pattern is the path after /api, already split and decoded: literal segments, ':name' (any
// segment, given to run as m.params.name), and a last '*' for any further segments or none.
// Without the '*' the path has exactly that many segments. method '*' is any method.
// run(req, res, m) may return NEXT: the row only checked something (a pane that exists, a body
// read) and the rows after it go on; whatever it put on m stays for them.
const NEXT = Symbol('next');

function route(method, pattern, run) {
  const segs = pattern.split('/').filter(Boolean);
  const rest = segs[segs.length - 1] === '*';
  if (rest) segs.pop();
  return { method, segs, rest, run, pattern };
}

// The params of parts against a row, or null.
function matchRoute(r, method, parts) {
  if (r.method !== '*' && r.method !== method) return null;
  if (parts.length < r.segs.length || (!r.rest && parts.length !== r.segs.length)) return null;
  const params = {};
  for (let i = 0; i < r.segs.length; i++) {
    const s = r.segs[i];
    if (s[0] === ':') params[s.slice(1)] = parts[i];
    else if (s !== parts[i]) return null;
  }
  return params;
}

// true when a row answered; false when none did (the caller's 404).
async function dispatch(routes, req, res, m) {
  for (const r of routes) {
    const params = matchRoute(r, m.method, m.parts);
    if (!params) continue;
    m.params = { ...m.params, ...params };
    if ((await r.run(req, res, m)) !== NEXT) return true;
  }
  return false;
}

module.exports = { NEXT, route, matchRoute, dispatch };
