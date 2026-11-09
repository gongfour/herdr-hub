'use strict';
// The order someone gave the workspace cards and the rows in them (the hub keeps it, lib/order.js;
// state.order), and the moves of 순서 바꾸기. Pure: a plain script in the page (window.Order),
// required by the tests. Hosts come sorted from the hub (state.hosts).
(function (root) {
  // Things in the order given: the ones named in ids first, in that order, then the rest as they
  // came (stable). The same as lib/order.js sortBy.
  function sortBy(items, ids, idOf) {
    if (!ids || !ids.length) return items.slice();
    const at = new Map(ids.map((id, i) => [id, i]));
    const rank = (x) => (at.has(idOf(x)) ? at.get(idOf(x)) : ids.length);
    return items.map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x);
  }

  // The cards: { host, id }. In the hosts' order, then the stored order of that host's cards, then
  // as they came. A card's status never moves it (an agent turning 답 필요 or 작업 중 used to
  // lift its card to the top; the user found the list jumping around harder to read).
  // stored: { host: [wsId…] }, hostIds: the hosts in their order.
  function sortCards(cards, stored, hostIds) {
    const hostAt = new Map((hostIds || []).map((h, i) => [h, i]));
    const pos = (c) => {
      const ids = (stored && stored[c.host]) || [];
      const i = ids.indexOf(c.id);
      return i < 0 ? ids.length : i;
    };
    const ha = (c) => (hostAt.has(c.host) ? hostAt.get(c.host) : hostAt.size);
    return cards
      .map((c, i) => [c, i])
      .sort(([x, i], [y, j]) => ha(x) - ha(y) || pos(x) - pos(y) || i - j)
      .map(([c]) => c);
  }

  // ids with id one step up (dir -1) or down (1); null when it can't go that way.
  function move(ids, id, dir) {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const out = ids.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }
  // ids with id at index to (as the list reads after the move); null when nothing moves.
  function moveTo(ids, id, to) {
    const i = ids.indexOf(id);
    if (i < 0 || i === to) return null;
    const out = ids.slice();
    out.splice(i, 1);
    out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
    return out;
  }

  const api = { sortBy, sortCards, move, moveTo };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Order = api;
})(typeof self !== 'undefined' ? self : this);
