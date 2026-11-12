'use strict';
// 저장소 그래프 (docs/design.md 「저장소 그래프」): the repositories the agents work in (#/repos, a tab
// on the phone and a page on the right when split) and one repository's whole branch flow
// (#/h/<host>/repo/<id>): the graph, a commit or a worktree's uncommitted files, and one file's
// change, side by side as the view's width allows (gitgraph.js cols) — the address says the
// deepest one open, and a narrow view shows just that one. Each host reads its own repositories
// (lib/routes/repos.js); a peer's through the hub. Read-only.
// The agents on the graph are the hub's state: a worktree's panes (GET …/live) are drawn with
// the status the state has for them, and only those marks change as the state does.

const RG_POLL_MS = 10000;
const RG_STATUS_MAX = 8; // worktrees whose uncommitted files are read
const rp = {
  lists: new Map(), // host -> { at, repos, error, loading }
  g: null, // the open repository's graph: { key, host, id, sig, commits, refs, worktrees, more, … }
  live: {}, // worktree id -> [pane]
  status: new Map(), // worktree id -> its uncommitted files (lib/repos.js parseStatus)
  commits: new Map(), // `${key}|${sha}` -> a commit, or { error }
  diffs: new Map(), // `${key}|c|${sha}|${path}` or `${key}|w|${wt}|${path}` -> { text, cut } or { error }
  expanded: new Set(), // fold keys open (gitgraph.js fold)
  ro: null, // the ResizeObserver on the open page
};
const rgKey = (host, id) => `${host}|${id}`;
const repoHost = () => view.host || localId();
const repoHosts = () => {
  const on = hosts().filter((h) => h.online).map((h) => h.id);
  return on.length ? on : [localId()].filter(Boolean);
};
const shortSha = (h) => String(h || '').slice(0, 7);
// A graph row's height (style.css .rg-row): a finger's 44px, a mouse's 32px.
const rgRowH = () => (matchMedia('(hover: hover) and (pointer: fine)').matches ? 32 : 44);

// What a failed read says (the server's codes, lib/routes/repos.js).
function repoErrText(err) {
  const c = err && err.code;
  if (c === 'no_git') return T('이 호스트에 git 이 없습니다. 호스트 설정의 HERDR_HUB_GIT 로 git 의 경로를 줄 수 있습니다.');
  if (c === 'git_timeout' || c === 'timeout') return T('git 이 제때 답하지 않았습니다. 잠시 뒤 다시 시도해 주세요.');
  if (c === 'not_found' && err.status === 404) return T('이 호스트의 Hub 를 배포해야 저장소를 볼 수 있습니다.');
  if (c === 'repo_not_found') return T('이 저장소에서 일하는 에이전트·셸이 없습니다. 패널이 다른 폴더로 옮겼거나 끝났습니다.');
  if (c === 'commit_not_found') return T('이 커밋을 찾을 수 없습니다.');
  if (c === 'worktree_not_found') return T('이 worktree 를 찾을 수 없습니다.');
  if (c === 'unsafe_repo') return T('git 이 이 저장소의 소유자를 믿지 않아 읽지 않았습니다 (safe.directory).');
  if (c === 'not_here') return T('이 내용은 이 호스트에 없습니다 (부분 복제). Hub 는 받아 오지 않습니다.');
  if (c === 'peer_offline') return T('호스트가 오프라인입니다.');
  return errText(err);
}

// Where 닫기 goes from the list (split): what was open before it.
function reposBack() {
  const p = history.state && history.state.prev;
  return p && !/^#?\/(h\/[^/]+\/)?repos?(\/|$)/.test(normHash(p)) ? p : '#/';
}

// ---- the list (#/repos)

async function loadRepoLists({ force = false } = {}) {
  const jobs = repoHosts().map(async (h) => {
    const was = rp.lists.get(h);
    if (!force && was && (was.loading || Date.now() - was.at < 10000)) return;
    rp.lists.set(h, { ...(was || {}), loading: true });
    try {
      const r = await api(hp('/repos', h), {});
      rp.lists.set(h, { at: Date.now(), repos: r.repos || [], partial: r.partial });
    } catch (err) {
      rp.lists.set(h, { at: Date.now(), repos: (was && was.repos) || null, error: err });
    }
    if (view.name === 'repos') renderReposBody();
  });
  await Promise.all(jobs);
}

function reposHtml() {
  return `
    <header class="bar">
      <h1 id="rp-title">${T('저장소')}</h1>
      <button type="button" class="icon-btn" id="rp-reload" aria-label="${T('새로 읽기')}" title="${T('새로 읽기')}">${ICON.reload}</button>
      ${split ? `<a class="icon-btn close-detail" href="${reposBack()}" data-back aria-label="${T('닫기')}"${keyAttrs('back', T('닫기'))}>${ICON.x}</a>` : ''}
    </header>
    <main class="panel repos-page" tabindex="-1" aria-labelledby="rp-title">
      <p class="rp-note">${T('에이전트·셸이 일하는 폴더의 git 저장소입니다. 같은 저장소의 worktree 는 하나로 묶입니다.')}</p>
      <div class="rp-body"></div>
    </main>`;
}

function renderRepos({ focus = false } = {}) {
  if (!split) showTab('repos');
  const root = split ? detailRoot() : listRoot();
  let main = root.querySelector(':scope > main.repos-page');
  if (!main || main._split !== split) {
    for (const el of [...root.children]) if (!el.classList.contains('tabbar')) el.remove();
    root.insertAdjacentHTML('afterbegin', reposHtml());
    main = root.querySelector(':scope > main.repos-page');
    main._split = split;
    root.querySelector('#rp-reload').onclick = () => loadRepoLists({ force: true });
  }
  const close = root.querySelector(':scope > .bar .close-detail');
  if (close) close.setAttribute('href', reposBack());
  renderReposBody();
  if (!split) mountTabBar('repos');
  if (focus) main.focus({ preventScroll: true });
  loadRepoLists();
}

// An agent's mark: its status dot and name (the state's), a link to it (plain inside a link: the list's rows).
function repoAgentChip(host, pane, { plain = false } = {}) {
  const a = state.agents.find((x) => same(x, host, pane));
  if (!a) {
    const t = (state.terminals || []).find((x) => same(x, host, pane));
    return t ? `<span class="rg-agent term" title="${esc(t.title)}">${ICON.term}<span>${esc(t.label || t.title || T('셸'))}</span></span>` : '';
  }
  const st = shownStatus(a);
  const name = a.name || a.title || a.agent;
  const tag = plain ? 'span' : 'a';
  const href = plain ? '' : ` href="${link(host, `/agent/${encodeURIComponent(pane)}`)}"`;
  return `<${tag} class="rg-agent st ${esc(needsAnswer(a) ? 'blocked' : st)}"${href} title="${esc(`${name} · ${statusText(a)}`)}"><i class="st-dot" aria-hidden="true"></i><span>${esc(name)}</span></${tag}>`;
}

function renderReposBody() {
  const root = split ? detailRoot() : listRoot();
  const body = root && root.querySelector(':scope > main.repos-page .rp-body');
  if (!body) return;
  const many = repoHosts().length > 1;
  const parts = repoHosts().map((h) => {
    const l = rp.lists.get(h);
    const head = many ? `<h2>${esc(hostLabel(h))}</h2>` : '';
    if (!l || (!l.repos && l.loading)) return `<section class="pgroup">${head}<div class="pcard"><p class="rp-empty">${T('불러오는 중…')}</p></div></section>`;
    if (!l.repos) return `<section class="pgroup">${head}<div class="pcard"><p class="rp-empty error">${esc(repoErrText(l.error))}</p></div></section>`;
    if (!l.repos.length) return `<section class="pgroup">${head}<div class="pcard"><p class="rp-empty">${T('에이전트·셸이 일하는 git 저장소가 없습니다.')}</p></div></section>`;
    const rows = l.repos.map((r) => {
      const panes = r.worktrees.flatMap((w) => w.panes);
      const chips = panes.map((p) => repoAgentChip(h, p, { plain: true })).filter(Boolean).slice(0, 4).join('');
      const more = panes.length > 4 ? `<span class="rg-more">+${panes.length - 4}</span>` : '';
      const wts = r.worktrees.length > 1 ? `<span class="rp-wts">${esc(T('worktree {n}개', { n: r.worktrees.length }))}</span>` : '';
      return `<a class="rp-row" href="${link(h, `/repo/${encodeURIComponent(r.id)}`)}">
        <span class="rp-ic" aria-hidden="true">${ICON.repo}</span>
        <span class="rp-main"><span class="rp-name">${esc(r.name)}</span><span class="rp-path" title="${esc(r.root)}">${esc(RowText.homePath(r.root, (hostCache.get(h) || {}).home || ''))}</span></span>
        <span class="rp-end">${wts}<span class="rp-agents">${chips}${more}</span><span aria-hidden="true">›</span></span>
      </a>`;
    });
    const note = l.error ? `<p class="rp-empty error">${esc(repoErrText(l.error))}</p>` : l.partial ? `<p class="rp-empty">${T('느린 폴더가 있어 일부만 찾았습니다.')}</p>` : '';
    return `<section class="pgroup">${head}<div class="pcard rp-rows">${rows.join('')}${note}</div></section>`;
  });
  const html = parts.join('');
  if (body._html !== html) body.innerHTML = body._html = html;
}

// ---- one repository (#/h/<host>/repo/<id>[/c/<sha>|/w/<wt>][/f/<path>])

const repoHref = (host, id, { c = null, w = null, f = null } = {}) =>
  link(host, `/repo/${encodeURIComponent(id)}${c ? `/c/${encodeURIComponent(c)}` : w ? `/w/${encodeURIComponent(w)}` : ''}${(c || w) && f ? `/f/${encodeURIComponent(f)}` : ''}`);
const repoDepth = () => (view.f ? 2 : view.c || view.w ? 1 : 0);
// One level up from what the address names: the file's commit, the commit's graph, the list.
function repoUp() {
  const host = repoHost();
  if (view.f) return repoHref(host, view.id, { c: view.c, w: view.w });
  if (view.c || view.w) return repoHref(host, view.id);
  return '#/repos';
}
const repoMain = () => detailRoot() && detailRoot().querySelector(':scope > main.repo-page');
const repoCols = () => {
  const m = repoMain();
  return GitGraph.cols(m && m.clientWidth ? m.clientWidth : innerWidth);
};

function repoShell() {
  const host = repoHost();
  const g = rp.g && rp.g.key === rgKey(host, view.id) ? rp.g : null;
  const name = (g && g.name) || T('저장소');
  return `
    <header class="bar rg-bar">
      ${backLink(repoUp(), T('뒤로'))}
      <h1><span class="t" id="rg-title">${esc(name)}</span><span class="sub" id="rg-sub"></span></h1>
      <button type="button" class="toggle rg-tog" id="rg-fold" aria-pressed="${Prefs.get('repoFold')}" title="${T('곧은 커밋을 「커밋 N개」 한 줄로 접기')}">${T('커밋 접기')}</button>
      <button type="button" class="toggle rg-tog" id="rg-remotes" aria-pressed="${Prefs.get('repoRemotes')}" title="${T('원격 브랜치 보이기')}">${T('원격 브랜치')}</button>
      <button type="button" class="icon-btn" id="rg-reload" aria-label="${T('새로 읽기')}" title="${T('새로 읽기')}">${ICON.reload}</button>
    </header>
    <main class="repo-page" aria-labelledby="rg-title">
      <div class="rg" id="rg" data-depth="0">
        <section class="rg-col rg-graph" aria-label="${T('커밋 그래프')}">
          <div class="rg-list" id="rg-list" role="listbox" tabindex="0" aria-label="${T('커밋')}"></div>
        </section>
        <section class="rg-col rg-side" id="rg-side" aria-label="${T('커밋 상세')}"></section>
        <section class="rg-col rg-diff" id="rg-diff" aria-label="${T('바뀐 내용')}"></section>
      </div>
    </main>`;
}

function renderRepo({ same = false } = {}) {
  const host = repoHost();
  const key = rgKey(host, view.id);
  let main = repoMain();
  if (!same || !main) {
    if (!rp.g || rp.g.key !== key) {
      rp.g = { key, host, id: view.id, loading: true, commits: [], refs: [], worktrees: [] };
      rp.live = {};
      rp.status = new Map();
      rp.expanded = new Set();
    }
    detailRoot().innerHTML = repoShell();
    main = repoMain();
    bindRepo(main);
    drawGraph();
    if (rp.g.loading && !rp.g.started) loadGraph();
  }
  const back = detailRoot().querySelector(':scope > .bar a[data-back]');
  if (back) back.setAttribute('href', repoUp());
  renderRepoSel();
}

async function loadGraph({ keep = false } = {}) {
  const g = rp.g;
  if (!g) return;
  g.started = true;
  const remotes = Prefs.get('repoRemotes') ? 1 : 0;
  try {
    const [r, info, br] = await Promise.all([
      api(hp(`/repos/${encodeURIComponent(g.id)}/graph?remotes=${remotes}`, g.host)),
      api(hp(`/repos/${encodeURIComponent(g.id)}`, g.host)).catch(() => null),
      api(hp(`/repos/${encodeURIComponent(g.id)}/branches`, g.host)).catch(() => null),
    ]);
    if (rp.g !== g) return;
    Object.assign(g, { loading: false, error: null, sig: r.sig, commits: r.commits, refs: r.refs, worktrees: r.worktrees, more: r.more, total: r.total, limited: r.limited, truncated: r.truncated, shallow: r.shallow, remotes });
    if (br) g.branches = br.branches;
    // A commit or a diff that failed (asked before the hosts were known, a slow git) is asked
    // again now that the repository answers.
    for (const m of [rp.commits, rp.diffs]) for (const [k, v] of m) if (v.error) m.delete(k);
    if (info) {
      g.name = info.name;
      g.root = info.root;
      g.fetchedAt = info.fetchedAt;
      for (const w of info.worktrees) if (w.panes.length) rp.live[w.id] = w.panes;
    }
  } catch (err) {
    if (rp.g !== g) return;
    g.loading = false;
    if (!keep) g.error = err;
  }
  if (view.name !== 'repo' || rp.g !== g) return;
  drawGraph();
  renderRepoSel();
  loadStatuses();
}

async function loadMore() {
  const g = rp.g;
  if (!g || !g.more || g.moreBusy) return;
  g.moreBusy = true;
  try {
    const r = await api(hp(`/repos/${encodeURIComponent(g.id)}/graph?remotes=${g.remotes}&after=${g.commits.length}`, g.host));
    if (rp.g !== g) return;
    if (r.sig !== g.sig) return void loadGraph(); // moved meanwhile: from the top again
    g.commits = g.commits.concat(r.commits);
    const seen = new Set(g.refs.map((x) => `${x.kind}:${x.name}`));
    g.refs = g.refs.concat(r.refs.filter((x) => !seen.has(`${x.kind}:${x.name}`)));
    g.more = r.more;
    g.truncated = r.truncated;
  } catch (err) {
    toastErr(repoErrText(err));
  } finally {
    g.moreBusy = false;
  }
  if (view.name === 'repo' && rp.g === g) drawGraph();
}

async function loadStatuses() {
  const g = rp.g;
  if (!g) return;
  const wts = g.worktrees.filter((w) => !w.prunable).slice(0, RG_STATUS_MAX);
  await Promise.all(
    wts.map(async (w) => {
      try {
        const s = await api(hp(`/repos/${encodeURIComponent(g.id)}/status?wt=${encodeURIComponent(w.id)}`, g.host));
        if (rp.g === g) rp.status.set(w.id, s);
      } catch {
        /* a slow worktree: no count this time */
      }
    })
  );
  if (view.name === 'repo' && rp.g === g) {
    drawGraph();
    renderSide();
  }
}

// Every RG_POLL_MS while the graph is open (app.js pollTimer): has anything moved, who is where.
async function repoPoll() {
  const g = rp.g;
  if (!g || document.visibilityState !== 'visible' || g.loading) return;
  try {
    const l = await api(hp(`/repos/${encodeURIComponent(g.id)}/live`, g.host));
    if (rp.g !== g) return;
    rp.live = l.panes || {};
    if (l.sig !== g.sig) return void loadGraph({ keep: true });
    drawAgents();
    loadStatuses();
  } catch {
    /* the next poll tries again */
  }
}

// The names on a commit: { sha: [names] } for gitgraph.js (a branch first, then tags and remotes).
function refsBySha(g) {
  const by = {};
  const order = { branch: 0, head: 1, tag: 2, remote: 3 };
  const refs = g.refs.filter((x) => g.remotes || x.kind !== 'remote').slice().sort((a, b) => order[a.kind] - order[b.kind]);
  for (const r of refs) (by[r.h] = by[r.h] || []).push(r.name);
  for (const w of g.worktrees) if (w.detached && w.head) (by[w.head] = by[w.head] || []).push('HEAD');
  return by;
}

// A long ref name keeps its start and its end (the end tells feature/… apart), the whole in its title.
const cutRef = (s, max = repoCols() === 1 ? 14 : 20) => (s.length <= max ? s : `${s.slice(0, 6)}…${s.slice(-(max - 7))}`);
const lineColor = (r, k) => (r && r.color && r.color[k]) || 0;

// A commit's names as chips: local branches in their lane's colour (a remote of the same name on
// the same commit joins it), then tags, then at most one remote (its remote's name dropped) and +N.
function refChips(g, h, color = 0) {
  const here = g.refs.filter((r) => r.h === h && (r.kind !== 'remote' || g.remotes));
  const wtBranches = new Set(g.worktrees.map((w) => w.branch).filter(Boolean));
  const local = new Set(here.filter((r) => r.kind === 'branch').map((r) => r.name));
  const tail = (name) => name.replace(/^[^/]+\//, '');
  const chip = (cls, name, title) => `<span class="rg-ref ${cls}" title="${esc(title)}">${esc(cutRef(name))}</span>`;
  const out = [];
  for (const r of here) {
    if (r.kind !== 'branch') continue;
    const wt = wtBranches.has(r.name);
    const synced = here.some((x) => x.kind === 'remote' && tail(x.name) === r.name);
    out.push(chip(`branch gg-c${color}${wt ? ' wt' : ''}`, r.name, [r.name, wt && T('worktree 에서 체크아웃됨'), synced && T('원격과 같음')].filter(Boolean).join(' · ')));
  }
  for (const r of here) if (r.kind === 'tag') out.push(chip('tag', r.name, r.name));
  for (const w of g.worktrees) if (w.detached && w.head === h) out.push(chip('head', 'HEAD', w.path));
  const remotes = here.filter((r) => r.kind === 'remote' && !local.has(tail(r.name)) && !/\/HEAD$/.test(r.name));
  if (remotes.length) out.push(chip('remote', `↗ ${tail(remotes[0].name)}`, remotes.map((r) => r.name).join('\n')));
  if (remotes.length > 1) out.push(`<span class="rg-more" title="${esc(remotes.slice(1).map((r) => r.name).join('\n'))}">+${remotes.length - 1}</span>`);
  return out.join('');
}

// Agents' marks, two at most and +N (all of them in its title).
function agentChips(g, panes) {
  const chips = panes.map((p) => repoAgentChip(g.host, p)).filter(Boolean);
  if (chips.length <= 2) return chips.join('');
  const rest = panes
    .slice(2)
    .map((p) => {
      const a = state.agents.find((x) => same(x, g.host, p));
      return a ? a.name || a.title || a.agent : '';
    })
    .filter(Boolean);
  return `${chips.slice(0, 2).join('')}<span class="rg-more" title="${esc(rest.join('\n'))}">+${chips.length - 2}</span>`;
}

// The agents of the worktrees whose head is this commit (a worktree with uncommitted changes
// carries its agents on its own row, just above).
function agentsAt(g, h) {
  const panes = [];
  for (const w of g.worktrees) if (w.head === h && !(g.wipAt && g.wipAt.has(w.id))) panes.push(...(rp.live[w.id] || []));
  return agentChips(g, panes);
}

const wipCount = (w) => {
  const s = rp.status.get(w.id);
  const n = s ? s.staged + s.unstaged + s.untracked + s.conflicted : 0;
  return n && s.files.length < n ? n : n && s.files.length;
};

// Commits reached from a local branch or a worktree's head: the rest are only on a remote.
function nearSet(g) {
  const by = new Map(g.commits.map((c) => [c.h, c]));
  const seen = new Set();
  const todo = [...g.refs.filter((r) => r.kind === 'branch').map((r) => r.h), ...g.worktrees.map((w) => w.head)].filter(Boolean);
  while (todo.length) {
    const h = todo.pop();
    if (seen.has(h) || !by.has(h)) continue;
    seen.add(h);
    for (const p of by.get(h).p || []) todo.push(p);
  }
  return seen;
}

function drawGraph() {
  const g = rp.g;
  const list = document.getElementById('rg-list');
  if (!g || !list) return;
  const title = document.getElementById('rg-title');
  if (title && g.name) title.textContent = g.name;
  const sub = document.getElementById('rg-sub');
  if (sub) {
    const bits = [multi() ? hostLabel(g.host) : '', g.fetchedAt ? T('마지막 fetch {ago}', { ago: agoKo(g.fetchedAt) }) : g.loading ? '' : T('fetch 한 적 없음')].filter(Boolean);
    sub.textContent = bits.join(' · ');
  }
  const put = (html) => {
    if (list._html !== html) list.innerHTML = list._html = html;
  };
  if (g.loading && !g.commits.length) return void put(`<p class="rg-empty">${T('불러오는 중…')}</p>`);
  if (g.error && !g.commits.length) return void put(`<p class="rg-empty error">${esc(repoErrText(g.error))}</p>`);
  if (!g.commits.length) return void put(`<div class="rg-wts" id="rg-wts"></div><p class="rg-empty">${T('아직 커밋이 없습니다.')}</p>`);
  const refs = refsBySha(g);
  const rows = GitGraph.layout(g.commits, refs);
  const keep = view.c ? (g.commits.find((c) => c.h.startsWith(view.c)) || {}).h : null;
  const shown = Prefs.get('repoFold') ? GitGraph.fold(rows, g.commits, { refs, expanded: rp.expanded, keep }) : rows;
  const by = new Map(g.commits.map((c) => [c.h, c]));
  const near = nearSet(g);
  const heads = new Set(g.worktrees.map((w) => w.head).filter(Boolean));
  const lane = { maxLanes: { 1: 5, 2: 6, 3: 8 }[repoCols()], hgt: rgRowH(), w: rgRowH() === 32 ? 12 : 14 };
  // A worktree with uncommitted changes: a row just above its HEAD, in its lane.
  const shownAt = new Map(shown.filter((r) => !r.fold).map((r) => [r.h, r]));
  const wips = new Map(); // head sha -> [worktree]
  g.wipAt = new Set();
  for (const w of g.worktrees) {
    if (!wipCount(w) || !shownAt.has(w.head)) continue;
    (wips.get(w.head) || wips.set(w.head, []).get(w.head)).push(w);
    g.wipAt.add(w.id);
  }
  const wipRow = (w, r) => {
    const across = [...new Set([...(r.pass || []), ...(r.up || [])])];
    let col = r.col;
    if (across.includes(col)) for (col = 0; across.includes(col); col++);
    const row = { wip: true, col, to: r.col, pass: across.filter((k) => k !== col), color: { ...r.color }, width: Math.max(r.width, col + 1) };
    const label = T('커밋 안 한 변경 {n}', { n: wipCount(w) });
    return {
      width: row.width,
      html: `<div class="rg-row rg-wt" role="option" id="rg-w-${esc(w.id)}" data-w="${esc(w.id)}" aria-selected="false" tabindex="-1" title="${esc(w.path)}">
        <span class="rg-lanes">${GitGraph.rowSvg(row, lane)}</span>
        <span class="rg-text"><span class="rg-ags" data-agw="${esc(w.id)}">${agentChips(g, rp.live[w.id] || [])}</span><span class="rg-s">${esc(label)}</span></span>
        <span class="rg-meta"><span class="rg-a">${esc(w.branch || (w.detached ? `HEAD ${shortSha(w.head)}` : basename(w.path)))}</span><span class="rg-t"></span></span>
      </div>`,
    };
  };
  const out = [];
  for (const r of shown) {
    if (r.fold) {
      const newest = by.get(r.from);
      out.push({
        width: r.width,
        html: `<button type="button" class="rg-row rg-foldrow" data-fold="${esc(r.key)}" tabindex="-1" title="${esc(T('펼치기'))}"><span class="rg-lanes">${GitGraph.rowSvg(r, { ...lane, hgt: rgRowH() === 32 ? 24 : 36 })}</span><span class="rg-text"><span class="rg-chev" aria-hidden="true">▸</span><span class="rg-fn">${esc(T('커밋 {n}개', { n: r.n }))}</span>${newest ? `<span class="rg-s">${esc(newest.s)}</span>` : ''}</span></button>`,
      });
      continue;
    }
    for (const w of wips.get(r.h) || []) out.push(wipRow(w, r));
    const c = by.get(r.h);
    const cls = [(c.p || []).length > 1 && 'rg-merge', !near.has(c.h) && 'rg-far'].filter(Boolean).join(' ');
    const when = new Date(c.t * 1000).toLocaleString(I18n.locale);
    out.push({
      width: r.width,
      html: `<div class="rg-row${cls ? ` ${cls}` : ''}" role="option" id="rg-${esc(c.h)}" data-h="${esc(c.h)}" aria-selected="false" tabindex="-1">
      <span class="rg-lanes">${GitGraph.rowSvg(r, { ...lane, head: heads.has(c.h) })}</span>
      <span class="rg-text"><span class="rg-refs">${refChips(g, c.h, lineColor(r, r.col))}</span><span class="rg-ags" data-ag="${esc(c.h)}">${agentsAt(g, c.h)}</span><span class="rg-s">${esc(c.s)}</span></span>
      <span class="rg-meta"><span class="rg-a" title="${esc(c.a)}">${esc(c.a)}</span><span class="rg-t" title="${esc(when)}">${esc(agoKo(c.t * 1000))}</span></span>
    </div>`,
    });
  }
  // One lane column for every row, so the text starts at one x down the whole graph.
  const gw = Math.min(Math.max(1, ...out.map((o) => o.width || 1)), lane.maxLanes) * lane.w;
  list.style.setProperty('--rg-gw', `${gw}px`);
  const end = g.more
    ? `<button type="button" class="btn secondary rg-moreb" id="rg-more">${T('더 보기')}</button>`
    : g.truncated
      ? `<p class="rg-empty">${T('커밋 {n}개까지 읽었습니다.', { n: g.commits.length })}</p>`
      : g.shallow
        ? `<p class="rg-empty">${T('얕은 복제: 여기서 기록이 끊깁니다.')}</p>`
        : '';
  const limited = g.limited ? `<p class="rg-empty">${T('저장소가 커서 최근 커밋만 읽었습니다.')}</p>` : '';
  const html = `<div class="rg-wts" id="rg-wts"></div>${limited}${out.map((o) => o.html).join('')}${end}`;
  if (list._html === html) return void drawWorktrees();
  const focusH = document.activeElement && document.activeElement.closest && document.activeElement.closest('#rg-list') ? document.activeElement.dataset.h || document.activeElement.dataset.fold || document.activeElement.dataset.w : null;
  const top = list.scrollTop;
  list.innerHTML = list._html = html;
  list.scrollTop = top;
  drawWorktrees();
  markSel();
  if (focusH) {
    const el = list.querySelector(`[data-h="${CSS.escape(focusH)}"], [data-fold="${CSS.escape(focusH)}"], [data-w="${CSS.escape(focusH)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  // Opened on nothing in particular: the first agent's place in sight.
  if (!g.placed && !view.c && !view.w && !g.loading) {
    g.placed = true;
    const w = g.worktrees.find((x) => (rp.live[x.id] || []).length && x.head);
    const el = w && (list.querySelector(`[data-w="${CSS.escape(w.id)}"]`) || list.querySelector(`[data-h="${CSS.escape(w.head)}"]`));
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  const more = document.getElementById('rg-more');
  if (more) more.onclick = loadMore;
}

// A worktree with uncommitted changes whose HEAD is not in the graph drawn (not read yet): a row
// on top, its agents beside it.
function drawWorktrees() {
  const g = rp.g;
  const box = document.getElementById('rg-wts');
  if (!g || !box) return;
  const html = g.worktrees
    .map((w) => {
      const n = wipCount(w);
      if (!n || (g.wipAt && g.wipAt.has(w.id))) return '';
      const where = w.branch || (w.detached ? `HEAD ${shortSha(w.head)}` : basename(w.path));
      return `<div class="rg-row rg-wt" role="option" id="rg-w-${esc(w.id)}" data-w="${esc(w.id)}" aria-selected="false" tabindex="-1" title="${esc(w.path)}">
        <span class="rg-lanes"><span class="rg-wt-dot" aria-hidden="true"></span></span>
        <span class="rg-text"><span class="rg-ags" data-agw="${esc(w.id)}">${agentChips(g, rp.live[w.id] || [])}</span><span class="rg-s">${esc(T('커밋 안 한 변경 {n}', { n }))}</span></span>
        <span class="rg-meta"><span class="rg-a">${esc(where)}</span><span class="rg-t"></span></span>
      </div>`;
    })
    .join('');
  if (box._html !== html) {
    box.innerHTML = box._html = html;
    markSel();
  }
}

// Only the agents' marks, as the state changes (onState).
function drawAgents() {
  const g = rp.g;
  const list = document.getElementById('rg-list');
  if (!g || !list) return;
  for (const el of list.querySelectorAll('[data-ag]')) {
    const html = agentsAt(g, el.dataset.ag);
    if (el._html !== html) el.innerHTML = el._html = html;
  }
  for (const el of list.querySelectorAll('[data-agw]')) {
    const html = agentChips(g, rp.live[el.dataset.agw] || []);
    if (el._html !== html) el.innerHTML = el._html = html;
  }
  if (view.c || view.w) return;
  renderSide();
}

function markSel() {
  const list = document.getElementById('rg-list');
  if (!list) return;
  const g = rp.g;
  const full = view.c && g ? (g.commits.find((c) => c.h.startsWith(view.c)) || {}).h : null;
  let cur = null;
  for (const el of list.querySelectorAll('[aria-selected]')) {
    const on = (full && el.dataset.h === full) || (view.w && el.dataset.w === view.w);
    el.setAttribute('aria-selected', String(Boolean(on)));
    if (on) cur = el;
  }
  // The roving tab stop: the selected row, else the first.
  for (const el of list.querySelectorAll('.rg-row')) el.tabIndex = -1;
  const stop = cur || list.querySelector('.rg-row');
  if (stop) stop.tabIndex = 0;
  list.tabIndex = stop ? -1 : 0;
  if (cur && !cur._shown) {
    cur._shown = true;
    cur.scrollIntoView({ block: 'nearest' });
  }
}

// What the address names: the side column (a commit, a worktree) and the diff.
function renderRepoSel() {
  const rg = document.getElementById('rg');
  if (!rg) return;
  rg.dataset.depth = String(repoDepth());
  rg.dataset.cols = String(repoCols());
  markSel();
  renderSide();
  renderDiff();
}

async function loadCommit(g, sha) {
  const k = `${g.key}|${sha}`;
  if (rp.commits.has(k)) return rp.commits.get(k);
  rp.commits.set(k, { loading: true });
  try {
    rp.commits.set(k, await api(hp(`/repos/${encodeURIComponent(g.id)}/commits/${encodeURIComponent(sha)}`, g.host)));
  } catch (err) {
    rp.commits.set(k, { error: err });
  }
  if (view.name === 'repo' && rp.g === g) renderRepoSel();
  return rp.commits.get(k);
}

// Nothing chosen: each worktree — its branch against its upstream, its agents by name and
// state, its uncommitted changes, its HEAD commit. Each opens in place.
function overviewHtml(g) {
  const host = g.host;
  const by = new Map(g.commits.map((c) => [c.h, c]));
  const home = (hostCache.get(host) || {}).home || '';
  const blocks = g.worktrees
    .filter((w) => !w.prunable)
    .map((w) => {
      const t = (g.branches && w.branch && g.branches[w.branch]) || null;
      const track = t
        ? t.gone
          ? `<span class="rg-track" title="${esc(t.upstream)}">${T('원격 브랜치 없어짐')}</span>`
          : t.ahead || t.behind
            ? `<span class="rg-track" title="${esc(T('{up} 보다 {a}개 앞, {b}개 뒤', { up: t.upstream, a: t.ahead || 0, b: t.behind || 0 }))}">${t.ahead ? `↑${t.ahead}` : ''}${t.behind ? ` ↓${t.behind}` : ''}</span>`
            : `<span class="rg-track" title="${esc(t.upstream)}">${T('원격과 같음')}</span>`
        : '';
      const agents = (rp.live[w.id] || [])
        .map((p) => {
          const a = state.agents.find((x) => same(x, host, p));
          if (!a) return repoAgentChip(host, p) ? `<li>${repoAgentChip(host, p)}</li>` : '';
          return `<li><a class="rg-ov-ag" href="${link(host, `/agent/${encodeURIComponent(p)}`)}"><i class="st-dot st ${esc(needsAnswer(a) ? 'blocked' : shownStatus(a))}" aria-hidden="true"></i><span class="rg-ov-n">${esc(a.name || a.title || a.agent)}</span><span class="rg-ov-s">${esc(statusText(a))}</span></a></li>`;
        })
        .join('');
      const n = wipCount(w);
      const head = by.get(w.head);
      return `<section class="rg-ov">
        <p class="rg-ov-top"><span class="rg-ov-b">${esc(w.branch || (w.detached ? 'HEAD' : basename(w.path)))}</span>${track}</p>
        <p class="rg-ov-path" title="${esc(w.path)}">${esc(RowText.homePath(w.path, home))}</p>
        ${agents ? `<ul class="rg-ov-ags">${agents}</ul>` : ''}
        ${n ? `<a class="rg-ov-link rg-ov-wip" href="${repoHref(host, g.id, { w: w.id })}">${esc(T('커밋 안 한 변경 {n}', { n }))}</a>` : ''}
        ${w.head ? `<a class="rg-ov-link" href="${repoHref(host, g.id, { c: w.head })}"><span class="rg-sha">${esc(shortSha(w.head))}</span> ${esc(head ? head.s : '')}</a>` : ''}
      </section>`;
    })
    .join('');
  return `<h3 class="rg-h3">${esc(T('worktree {n}개', { n: g.worktrees.length }))}</h3>${blocks}<p class="rg-empty rg-hint">${T('커밋을 고르면 여기에 나옵니다.')}</p>`;
}

const fileStat = (f) =>
  f.bin ? `<span class="rg-bin">${T('이진')}</span>` : f.sub ? `<span class="rg-bin">${T('서브모듈')}</span>` : `${f.add ? `<span class="rg-add">+${f.add}</span>` : ''}${f.del ? `<span class="rg-del">−${f.del}</span>` : ''}`;

function renderSide() {
  const side = document.getElementById('rg-side');
  const g = rp.g;
  if (!side || !g) return;
  const host = repoHost();
  let html = '';
  if (view.c) {
    const c = rp.commits.get(`${g.key}|${view.c}`);
    if (!c) loadCommit(g, view.c);
    if (!c || c.loading) html = `<p class="rg-empty">${T('불러오는 중…')}</p>`;
    else if (c.error) html = `<p class="rg-empty error">${esc(repoErrText(c.error))}</p>`;
    else {
      const [subj, ...rest] = c.msg.split('\n');
      const body = rest.join('\n').replace(/^\n+/, '');
      const parents = c.p.map((p) => `<a href="${repoHref(host, g.id, { c: p })}" class="rg-sha">${esc(shortSha(p))}</a>`).join(' ');
      const files = c.files
        .map(
          (f) =>
            `<li><a class="rg-file${view.f === f.path ? ' on' : ''}" href="${repoHref(host, g.id, { c: view.c, f: f.path })}"${view.f === f.path ? ' aria-current="true"' : ''}><span class="rg-st st-${esc(f.st)}">${esc(f.st)}</span><span class="rg-fp">${f.from ? `<span class="rg-from">${esc(f.from)} → </span>` : ''}${esc(f.path)}</span><span class="rg-fn">${fileStat(f)}</span></a></li>`
        )
        .join('');
      html = `
        <div class="rg-head"><h2 class="rg-subj">${esc(subj)}</h2>
          <p class="rg-who">${esc(c.a)} · ${esc(new Date(c.t * 1000).toLocaleString(I18n.locale))}</p>
          <p class="rg-shas"><button type="button" class="rg-sha rg-copy" data-copy="${esc(c.h)}" title="${T('커밋 해시 복사')}">${esc(shortSha(c.h))}</button>${parents ? ` ← ${parents}` : ''}</p>
        </div>
        ${body ? `<pre class="rg-body">${esc(body)}</pre>` : ''}
        <h3 class="rg-h3">${esc(T('바뀐 파일 {n}', { n: c.files.length }))}${c.p.length > 1 ? ` <span class="rg-note">${T('첫 부모와 비교')}</span>` : ''}</h3>
        <ul class="rg-files">${files}</ul>
        ${c.cut ? `<p class="rg-empty">${T('파일이 많아 일부만 보입니다.')}</p>` : ''}`;
    }
  } else if (view.w) {
    const w = g.worktrees.find((x) => x.id === view.w);
    const s = rp.status.get(view.w);
    if (!w) html = `<p class="rg-empty error">${esc(repoErrText({ code: 'worktree_not_found' }))}</p>`;
    else if (!s) html = `<p class="rg-empty">${T('불러오는 중…')}</p>`;
    else {
      const files = s.files
        .map((f) => {
          const st = f.untracked ? '?' : f.conflict ? 'U' : f.x !== '.' ? f.x : f.y;
          const inner = `<span class="rg-st st-${esc(st === '?' ? 'N' : st)}">${esc(st)}</span><span class="rg-fp">${f.from ? `<span class="rg-from">${esc(f.from)} → </span>` : ''}${esc(f.path)}</span>${f.untracked ? `<span class="rg-fn rg-note">${T('새 파일 — 내용은 보이지 않습니다')}</span>` : ''}`;
          return f.untracked
            ? `<li><span class="rg-file off">${inner}</span></li>`
            : `<li><a class="rg-file${view.f === f.path ? ' on' : ''}" href="${repoHref(host, g.id, { w: view.w, f: f.path })}">${inner}</a></li>`;
        })
        .join('');
      html = `
        <div class="rg-head"><h2 class="rg-subj">${T('커밋 안 한 변경')}</h2>
          <p class="rg-who" title="${esc(w.path)}">${esc(w.branch || 'HEAD')} · ${esc(RowText.homePath(w.path, (hostCache.get(host) || {}).home || ''))}</p>
          <p class="rg-who">${esc([s.staged && T('스테이지 {n}', { n: s.staged }), s.unstaged && T('수정 {n}', { n: s.unstaged }), s.untracked && T('새 파일 {n}', { n: s.untracked }), s.conflicted && T('충돌 {n}', { n: s.conflicted })].filter(Boolean).join(' · '))}</p>
        </div>
        <ul class="rg-files">${files}</ul>
        ${s.cut ? `<p class="rg-empty">${T('파일이 많아 일부만 보입니다.')}</p>` : ''}`;
    }
  } else html = overviewHtml(g);
  if (side._html !== html) {
    side.innerHTML = side._html = html;
    const cur = side.querySelector('.rg-file.on');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
}

// A unified diff, a line a span: hunk heads, additions, deletions, git's own lines. Control
// characters show as ␛-like marks, never as what they do.
function diffHtml(text) {
  const vis = (s) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (ch) => String.fromCharCode(0x2400 + (ch === '\x7f' ? 0x21 : ch.charCodeAt(0))));
  return String(text)
    .split('\n')
    .map((l) => {
      const cls = /^@@/.test(l) ? 'dh' : /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary files)/.test(l) ? 'dm' : l[0] === '+' ? 'da' : l[0] === '-' ? 'dd' : '';
      return `<span${cls ? ` class="${cls}"` : ''}>${esc(vis(l))}\n</span>`;
    })
    .join('');
}

async function loadDiff(g, k, path) {
  rp.diffs.set(k, { loading: true });
  try {
    rp.diffs.set(k, await api(hp(`/repos/${encodeURIComponent(g.id)}/diff?${path}`, g.host)));
  } catch (err) {
    rp.diffs.set(k, { error: err });
  }
  if (view.name === 'repo' && rp.g === g) renderDiff();
}

function renderDiff() {
  const box = document.getElementById('rg-diff');
  const g = rp.g;
  if (!box || !g) return;
  let html = '';
  if (!view.f) html = `<p class="rg-empty rg-hint">${T('파일을 고르면 바뀐 내용이 나옵니다.')}</p>`;
  else {
    let k;
    let q;
    if (view.c) {
      const c = rp.commits.get(`${g.key}|${view.c}`);
      const f = c && c.files ? c.files.find((x) => x.path === view.f) : null;
      k = `${g.key}|c|${view.c}|${view.f}`;
      q = `c=${encodeURIComponent(view.c)}&path=${encodeURIComponent(view.f)}${f && f.from ? `&from=${encodeURIComponent(f.from)}` : ''}`;
      if (!c || c.loading) q = null; // its old name comes with the commit
    } else {
      k = `${g.key}|w|${view.w}|${view.f}`;
      q = `wt=${encodeURIComponent(view.w)}&path=${encodeURIComponent(view.f)}`;
    }
    const d = rp.diffs.get(k);
    if (!d && q) loadDiff(g, k, q);
    const head = `<div class="rg-head"><h2 class="rg-fpath">${esc(view.f)}</h2></div>`;
    if (!d || d.loading) html = `${head}<p class="rg-empty">${T('불러오는 중…')}</p>`;
    else if (d.error) html = `${head}<p class="rg-empty error">${esc(repoErrText(d.error))}</p>`;
    else if (!d.text) html = `${head}<p class="rg-empty">${T('바뀐 내용이 없습니다.')}</p>`;
    else html = `${head}<pre class="rg-dtext">${diffHtml(d.text)}</pre>${d.cut ? `<p class="rg-empty">${T('길어서 앞부분만 보입니다.')}</p>` : ''}`;
  }
  if (box._html !== html) {
    box.innerHTML = box._html = html;
    box.scrollTop = 0;
  }
}

// To another commit, worktree or file: pushed (뒤로 comes back to it) when the view shows one
// column, put in place when the graph stays beside it (a step with the arrows is no history).
function repoGo(href, { push = repoCols() === 1 } = {}) {
  if (push) location.hash = href;
  else {
    history.replaceState(history.state, '', href);
    route();
  }
}

function rowHref(el) {
  const host = repoHost();
  if (el.dataset.h) return repoHref(host, view.id, { c: el.dataset.h });
  if (el.dataset.w) return repoHref(host, view.id, { w: el.dataset.w });
  return null;
}

function bindRepo(main) {
  const list = main.querySelector('#rg-list');
  list.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // an agent's mark
    const fold = e.target.closest('[data-fold]');
    if (fold) {
      rp.expanded.add(fold.dataset.fold);
      drawGraph();
      return;
    }
    const row = e.target.closest('.rg-row');
    const href = row && rowHref(row);
    if (href) repoGo(href, { push: true });
  });
  // ↑↓ (j k) along the rows, Return or → opens, Home/End. With the graph beside the commit, a
  // step shows that commit at once; alone, Return opens it.
  list.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const rows = [...list.querySelectorAll('.rg-row')];
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement);
    const step = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
    let to = null;
    if (step) to = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? -step : at) + step))];
    else if (e.key === 'Home') to = rows[0];
    else if (e.key === 'End') to = rows[rows.length - 1];
    if (to) {
      e.preventDefault();
      for (const r of rows) r.tabIndex = -1;
      to.tabIndex = 0;
      to.focus();
      to.scrollIntoView({ block: 'nearest' });
      const href = rowHref(to);
      if (href && repoCols() > 1) repoGo(href, { push: false });
      return;
    }
    if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') {
      const row = at >= 0 ? rows[at] : null;
      if (!row) return;
      e.preventDefault();
      if (row.dataset.fold) {
        rp.expanded.add(row.dataset.fold);
        drawGraph();
        return;
      }
      const href = rowHref(row);
      if (repoCols() === 1) return void repoGo(href, { push: true });
      if (location.hash !== href) repoGo(href, { push: false });
      const first = document.querySelector('#rg-side a.rg-file') || document.querySelector('#rg-side a, #rg-side button');
      if (first) first.focus();
    }
  });
  // ← from the side or the diff: back to the graph (or the side) beside it.
  main.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' || e.altKey || e.ctrlKey || e.metaKey || editable(e.target)) return;
    const col = e.target.closest && e.target.closest('.rg-col');
    if (!col || col.classList.contains('rg-graph') || repoCols() === 1) return;
    e.preventDefault();
    const back = col.classList.contains('rg-diff') && repoCols() < 3 ? null : col.classList.contains('rg-diff') ? document.querySelector('#rg-side .rg-file.on') : null;
    (back || list.querySelector('.rg-row[tabindex="0"]') || list).focus();
  });
  main.querySelector('#rg-side').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copyText(b.dataset.copy, T('커밋 해시를 복사했습니다'));
  });
  // A file in the side column with the diff beside it: put in place, not pushed.
  main.addEventListener('click', (e) => {
    const a = e.target.closest('a.rg-file, a.rg-sha, a.rg-ov-link');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    repoGo(a.getAttribute('href'), { push: repoCols() === 1 || !a.classList.contains('rg-file') });
  });
  const bar = detailRoot().querySelector(':scope > .rg-bar');
  bar.querySelector('#rg-fold').onclick = (e) => {
    setPref('repoFold', !Prefs.get('repoFold'));
    e.currentTarget.setAttribute('aria-pressed', String(Prefs.get('repoFold')));
    drawGraph();
  };
  bar.querySelector('#rg-remotes').onclick = (e) => {
    setPref('repoRemotes', !Prefs.get('repoRemotes'));
    e.currentTarget.setAttribute('aria-pressed', String(Prefs.get('repoRemotes')));
    if (rp.g) rp.g.loading = true;
    drawGraph();
    loadGraph();
  };
  bar.querySelector('#rg-reload').onclick = () => {
    rp.commits.clear();
    rp.diffs.clear();
    loadGraph({ keep: true });
  };
  // The view's width decides its columns: drawn again as it crosses one.
  if (rp.ro) rp.ro.disconnect();
  if (window.ResizeObserver) {
    let cols = repoCols();
    rp.ro = new ResizeObserver(() => {
      const n = repoCols();
      if (n === cols) return;
      cols = n;
      drawGraph();
      renderRepoSel();
    });
    rp.ro.observe(main);
  }
}

// The repository an agent or shell works in: its graph, with that worktree's row chosen.
async function openRepoOf(host, pane) {
  try {
    const r = await api(hp('/repos', host));
    for (const repo of r.repos || [])
      for (const w of repo.worktrees)
        if (w.panes.includes(pane)) {
          location.hash = repoHref(host, repo.id);
          return true;
        }
    toast(T('이 폴더는 git 저장소가 아닙니다.'));
  } catch (err) {
    toastErr(repoErrText(err));
  }
  return false;
}

// The rail's and the key's 저장소: open or close it, as 설정's ⚙ does.
function toggleRepos() {
  if (view.name === 'repos') return goBack(split ? reposBack() : '#/');
  if (view.name === 'repo') return goBack(reposBack()); // out of the repository too, to what was open before
  if (view.name === 'agent' || view.name === 'term') return void openRepoOf(curHost(), view.name === 'agent' ? detail.pane : view.pane);
  history.pushState(null, '', '#/repos');
  route();
}
