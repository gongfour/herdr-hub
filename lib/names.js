'use strict';
// Agent names. herdr wants /^[a-z][a-z0-9_-]{0,31}$/ and a name no other agent on the host has.
// A new agent with no name given is named after its folder or workspace (hub-pol-d1),
// made unique (hub-pol-d1-2), instead of a random one.

const RULE = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX = 32;

const trimEnds = (s) => s.replace(/^[-_]+/, '').replace(/[-_]+$/, '');

// "Hub Pol D1" -> "hub-pol-d1", "café_2" -> "cafe_2", "12-test" -> "test"; "프로젝트" -> "".
function slug(text) {
  const n = trimEnds(
    String(text || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // accents off: é -> e
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[^a-z]+/, '') // must start with a letter
      .slice(0, MAX)
  );
  return RULE.test(n) ? n : '';
}

const sanitize = (text, fallback = 'agent') => slug(text) || slug(fallback) || 'agent';

// base, else base-2, base-3 … cut so the whole stays within 32 characters.
function unique(base, taken) {
  const used = new Set(taken || []);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const name = trimEnds(base.slice(0, MAX - suffix.length)) + suffix;
    if (!used.has(name)) return name;
  }
}

// The first source that makes a usable name (workspace label, folder name …), else the fallback.
const defaultName = (sources, fallback, taken) => unique((sources || []).map(slug).find(Boolean) || sanitize(fallback), taken);

module.exports = { RULE, slug, sanitize, unique, defaultName };
