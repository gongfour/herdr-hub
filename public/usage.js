'use strict';
// A Claude agent's model, context and the host's plan limits (the agent's `usage`, lib/usage.js),
// in words: the agent view's chip (「Opus 5.5 · 컨텍스트 42%」), the limits line (「5시간 31% · 주간
// 12% · 오후 3:10 초기화」) and the rows of the 사용량 sheet. Pure; loaded as a plain script in the
// page (window.Usage) and required by the tests.
(function (root) {
  const I18n = root.I18n || require('./i18n.js');
  const T = I18n.t;
  const num = (n) => Math.round(n).toLocaleString('en-US');
  // 42.4 -> '42%'; under 1 but not nothing -> '1% 미만'.
  function pctText(p, tokens = null) {
    if (p == null || !Number.isFinite(p)) return '';
    if (p > 0 && p < 1) return T('1% 미만');
    if (p === 0 && tokens > 0) return T('1% 미만');
    return `${Math.round(p)}%`;
  }
  const family = (model) => String(model || '').split(' ')[0];

  // The header chip: { full, short, title, warn } or null (no model known).
  function chip(u) {
    if (!u || !u.model) return null;
    const p = pctText(u.pct, u.tokens);
    const full = p ? T('{model} · 컨텍스트 {pct}', { model: u.model, pct: p }) : u.model;
    // The phone's header: the percentage alone (the model is a tap away, in the sheet).
    const short = p || family(u.model);
    return { full, short, title: contextTitle(u) || u.model, warn: u.pct != null && u.pct >= 80 };
  }

  // 「컨텍스트 420,000 / 1,000,000 토큰」
  function contextTitle(u) {
    if (!u || u.tokens == null || !u.window) return '';
    return T('컨텍스트 {used} / {total} 토큰', { used: num(u.tokens), total: num(u.window) });
  }

  // A reset time: today 「오후 3:10」, within a week 「금 오후 3:10」, else 「11월 14일 오후 3:10」.
  function resetText(ms, now = Date.now()) {
    const d = new Date(ms);
    const n = new Date(now);
    const time = d.toLocaleTimeString(I18n.locale, { hour: 'numeric', minute: '2-digit' });
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day0(d) - day0(n)) / 864e5);
    if (days === 0) return time;
    if (days === 1) return T('내일 {time}', { time });
    if (days > 1 && days < 7) return T('{day} {time}', { day: d.toLocaleDateString(I18n.locale, { weekday: 'short' }), time });
    return T('{month}월 {date}일 {time}', { month: d.getMonth() + 1, date: d.getDate(), time });
  }

  // Windows already reset are not shown (the host leaves them out too; this is for a page left open).
  const live = (w, now) => w && Number.isFinite(w.pct) && w.resetsAt > now;

  // 「5시간 31% · 주간 12% · 오후 3:10 초기화」 (the soonest reset), or '' without limits.
  function limitsLine(l, now = Date.now()) {
    if (!l) return '';
    const five = live(l.five, now) ? l.five : null;
    const week = live(l.week, now) ? l.week : null;
    if (!five && !week) return '';
    const parts = [];
    if (five) parts.push(T('5시간 {pct}', { pct: pctText(five.pct) }));
    if (week) parts.push(T('주간 {pct}', { pct: pctText(week.pct) }));
    parts.push(T('{when} 초기화', { when: resetText((five || week).resetsAt, now) }));
    return parts.join(' · ');
  }

  // The 사용량 sheet: [[name, value, note]] rows.
  function rows(u, now = Date.now()) {
    const out = [];
    if (u && u.model) out.push([T('모델'), u.model, u.modelId && u.modelId !== u.model ? u.modelId : '']);
    if (u && u.model) {
      const p = pctText(u.pct, u.tokens);
      out.push([T('컨텍스트'), p || T('알 수 없음'), p ? T('{used} / {total} 토큰', { used: num(u.tokens), total: num(u.window) }) : T('/compact 뒤 다음 답이 오면 보입니다')]);
    }
    const l = u && u.limits;
    const five = l && live(l.five, now) ? l.five : null;
    const week = l && live(l.week, now) ? l.week : null;
    if (five) out.push([T('5시간 한도'), pctText(five.pct), T('{when} 초기화', { when: resetText(five.resetsAt, now) })]);
    if (week) out.push([T('주간 한도'), pctText(week.pct), T('{when} 초기화', { when: resetText(week.resetsAt, now) })]);
    return out;
  }

  // Below the rows: where the limits come from, or why there are none.
  function limitsNote(u, now = Date.now()) {
    const l = u && u.limits;
    if (l && (live(l.five, now) || live(l.week, now))) {
      const min = Math.max(0, Math.round((now - l.at) / 60e3));
      const ago = min < 1 ? T('방금') : min < 60 ? T('{n}분 전', { n: min }) : T('{n}시간 전', { n: Math.round(min / 60) });
      return T('이 호스트의 계정 전체 사용량 · {ago} 답 기준', { ago });
    }
    return T('사용 한도는 이 호스트의 Claude Code 상태 줄이 Herdr Hub 것일 때 보입니다 (docs/design.md 「모델·컨텍스트·사용량」).');
  }

  const api = { chip, contextTitle, limitsLine, rows, limitsNote, resetText, pctText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Usage = api;
})(typeof self !== 'undefined' ? self : this);
