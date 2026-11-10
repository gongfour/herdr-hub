'use strict';
// A Claude agent's model, context and the host's plan limits (the agent's `usage`, lib/usage.js),
// in words: the agent view's chip (「Opus 5.5 · 컨텍스트 42%」), the limits line (「5시간 31% · 주간
// 12% · 오후 3:10 초기화」) and the rows of the 사용량 sheet. Pure; loaded as a plain script in the
// page (window.Usage) and required by the tests.
(function (root) {
  const num = (n) => Math.round(n).toLocaleString('en-US');
  // 42.4 -> '42%'; under 1 but not nothing -> '1% 미만'.
  function pctText(p, tokens = null) {
    if (p == null || !Number.isFinite(p)) return '';
    if (p > 0 && p < 1) return '1% 미만';
    if (p === 0 && tokens > 0) return '1% 미만';
    return `${Math.round(p)}%`;
  }
  const family = (model) => String(model || '').split(' ')[0];

  // The header chip: { full, short, title, warn } or null (no model known).
  function chip(u) {
    if (!u || !u.model) return null;
    const p = pctText(u.pct, u.tokens);
    const full = p ? `${u.model} · 컨텍스트 ${p}` : u.model;
    const short = p ? `${family(u.model)} ${p}` : family(u.model);
    return { full, short, title: contextTitle(u) || u.model, warn: u.pct != null && u.pct >= 80 };
  }

  // 「컨텍스트 420,000 / 1,000,000 토큰」
  function contextTitle(u) {
    if (!u || u.tokens == null || !u.window) return '';
    return `컨텍스트 ${num(u.tokens)} / ${num(u.window)} 토큰`;
  }

  // A reset time: today 「오후 3:10」, within a week 「금 오후 3:10」, else 「11월 14일 오후 3:10」.
  function resetText(ms, now = Date.now()) {
    const d = new Date(ms);
    const n = new Date(now);
    const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
    const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((day0(d) - day0(n)) / 864e5);
    if (days === 0) return time;
    if (days === 1) return `내일 ${time}`;
    if (days > 1 && days < 7) return `${'일월화수목금토'[d.getDay()]} ${time}`;
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
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
    if (five) parts.push(`5시간 ${pctText(five.pct)}`);
    if (week) parts.push(`주간 ${pctText(week.pct)}`);
    parts.push(`${resetText((five || week).resetsAt, now)} 초기화`);
    return parts.join(' · ');
  }

  // The 사용량 sheet: [[name, value, note]] rows.
  function rows(u, now = Date.now()) {
    const out = [];
    if (u && u.model) out.push(['모델', u.model, u.modelId && u.modelId !== u.model ? u.modelId : '']);
    if (u && u.model) {
      const p = pctText(u.pct, u.tokens);
      out.push(['컨텍스트', p || '알 수 없음', p ? contextTitle(u).replace(/^컨텍스트 /, '') : '/compact 뒤 다음 답이 오면 보입니다']);
    }
    const l = u && u.limits;
    const five = l && live(l.five, now) ? l.five : null;
    const week = l && live(l.week, now) ? l.week : null;
    if (five) out.push(['5시간 한도', pctText(five.pct), `${resetText(five.resetsAt, now)} 초기화`]);
    if (week) out.push(['주간 한도', pctText(week.pct), `${resetText(week.resetsAt, now)} 초기화`]);
    return out;
  }

  // Below the rows: where the limits come from, or why there are none.
  function limitsNote(u, now = Date.now()) {
    const l = u && u.limits;
    if (l && (live(l.five, now) || live(l.week, now))) {
      const min = Math.max(0, Math.round((now - l.at) / 60e3));
      return `이 호스트의 계정 전체 사용량 · ${min < 1 ? '방금' : min < 60 ? `${min}분 전` : `${Math.round(min / 60)}시간 전`} 답 기준`;
    }
    return '사용 한도는 이 호스트의 Claude Code 상태 줄이 Herdr Hub 것일 때 보입니다 (docs/design.md 「모델·컨텍스트·사용량」).';
  }

  const api = { chip, contextTitle, limitsLine, rows, limitsNote, resetText, pctText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Usage = api;
})(typeof self !== 'undefined' ? self : this);
