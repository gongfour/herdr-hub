'use strict';
// 저장소 그래프 (lib/repos.js): the repositories this host's panes work in, and their commit graph,
// a commit, a file's change, a worktree's uncommitted files. All GET, all read-only. A repository
// is named by its id only (found from the panes now); a worktree by its id in that repository.
// A git failure is a code (the page words it); git's own words (paths) never go out.
const { createGit } = require('../git');
const { createRepos, okPath } = require('../repos');
const { route, NEXT } = require('../router');
const { send } = require('../http');

const GIVE_UP = new Set(['git_timeout', 'git_stuck', 'git_jammed', 'git_busy']);

module.exports = (hub) => {
  const env = hub.env || process.env;
  const git = createGit({ bin: env.HERDR_HUB_GIT || 'git', env: process.env });
  const repos = createRepos(hub, git);

  // A git failure as an answer: 503 when git is missing or slow (try again), 422 otherwise.
  const failed = (res, err) => {
    if (!err || !err.gitError) throw err;
    if (err.code === 'no_git') return send(res, 503, { error: 'no_git' });
    if (GIVE_UP.has(err.code)) return send(res, 503, { error: 'git_timeout' });
    return send(res, 422, { error: err.code });
  };
  const guard = (fn) => async (req, res, m) => {
    try {
      return await fn(req, res, m);
    } catch (err) {
      return failed(res, err);
    }
  };

  return [
    route(
      'GET',
      'repos',
      guard(async (req, res) => {
        const b = require('../fsq').budget(6000);
        const list = await repos.list(b);
        return send(res, 200, { supported: true, repos: list, partial: b.partial || undefined });
      })
    ),
    // The repository (known from a pane now) before anything else under it.
    route(
      'GET',
      'repos/:id/*',
      guard(async (req, res, m) => {
        m.repo = await repos.get(m.params.id);
        if (!m.repo) return send(res, 404, { error: 'repo_not_found' });
        return NEXT;
      })
    ),
    route(
      'GET',
      'repos/:id',
      guard(async (req, res, { repo }) => send(res, 200, await repos.viewOf(repo)))
    ),
    route(
      'GET',
      'repos/:id/graph',
      guard(async (req, res, { repo, url }) => {
        const remotes = url.searchParams.get('remotes') !== '0';
        return send(res, 200, await repos.graph(repo, { remotes, after: url.searchParams.get('after') }));
      })
    ),
    route(
      'GET',
      'repos/:id/live',
      guard(async (req, res, { repo }) => send(res, 200, await repos.live(repo)))
    ),
    route(
      'GET',
      'repos/:id/branches',
      guard(async (req, res, { repo }) => send(res, 200, { branches: await repos.branches(repo) }))
    ),
    route(
      'GET',
      'repos/:id/commits/:sha',
      guard(async (req, res, { repo, params }) => {
        const h = await repos.commitSha(repo, params.sha);
        if (!h) return send(res, 404, { error: 'commit_not_found' });
        return send(res, 200, await repos.commit(repo, h));
      })
    ),
    // ?c=<sha>&path=<p>[&from=<old path>]: a file's change in a commit. ?wt=<id>&path=<p>: a
    // tracked file's uncommitted change in a worktree. Checked before git is asked anything.
    route(
      'GET',
      'repos/:id/diff',
      guard(async (req, res, { repo, url }) => {
        const q = url.searchParams;
        const file = q.get('path');
        const from = q.get('from');
        if (!okPath(file) || (from != null && !okPath(from))) return send(res, 400, { error: 'bad_path' });
        if (q.has('wt')) {
          const w = repos.worktree(repo, q.get('wt'));
          if (!w) return send(res, 404, { error: 'worktree_not_found' });
          return send(res, 200, await repos.worktreeDiff(repo, w, file));
        }
        const h = await repos.commitSha(repo, q.get('c'));
        if (!h) return send(res, 404, { error: 'commit_not_found' });
        return send(res, 200, await repos.commitDiff(repo, h, file, from));
      })
    ),
    route(
      'GET',
      'repos/:id/status',
      guard(async (req, res, { repo, url }) => {
        const w = repos.worktree(repo, url.searchParams.get('wt'));
        if (!w) return send(res, 404, { error: 'worktree_not_found' });
        return send(res, 200, await repos.status(repo, w));
      })
    ),
  ];
};
