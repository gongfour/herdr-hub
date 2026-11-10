'use strict';
// The page's words in the language this device chose (설정 → 화면 → 언어; index.html sets <html
// lang> from it before any script runs). The Korean text is the key: T('답 필요') is that text
// in Korean, its English from i18n.en.js in English, and itself when no English is written yet.
// The page calls it T (a name no code uses for anything else: `t` is a local everywhere).
//   T(ko, vars)  (window.T, I18n.t) {name} in the text takes vars.name (the caller escapes what goes into HTML, as
//                before). An English entry may be { one, other }: vars.n === 1 picks one.
//   T('바꾸기@@edit')  one Korean word that wants different English by place: the @@ part names the
//                place (Korean shows the word without it; English looks up the whole key, then the
//                word alone).
//   lang         'ko' | 'en', fixed for the page's life: changing it reloads (core.js PREF_EFFECTS),
//                so a table built when a script loads (STATUS_LABEL, the keymap's names) is right.
// Pure: loaded as a plain script in the page (window.I18n, before every other script), required
// by the tests and by the server (notifications in the device's language, lib/notify.js).
(function (root) {
  const EN = root.I18N_EN || (typeof require === 'function' ? require('./i18n.en.js') : {});
  let lang = 'ko';
  try {
    if (root.document && root.document.documentElement.lang === 'en') lang = 'en';
  } catch {
    /* no document: the tests and the server pass the language */
  }
  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s);
  const CTX = /@@[\w-]+$/;
  function pick(ko, vars, l) {
    const plain = ko.replace(CTX, '');
    if (l !== 'en') return plain;
    const e = EN[ko] != null ? EN[ko] : EN[plain];
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') return (vars && Number(vars.n) === 1 ? e.one : e.other) || plain;
    return plain;
  }
  const t = (ko, vars) => fill(pick(ko, vars, lang), vars);
  // The same in a language given (the server, for each device's own).
  const tIn = (l, ko, vars) => fill(pick(ko, vars, l), vars);
  const api = {
    t,
    tIn,
    EN,
    get lang() {
      return lang;
    },
    // For toLocaleTimeString / toLocaleDateString: dates and times as this language writes them.
    get locale() {
      return lang === 'en' ? 'en-US' : 'ko-KR';
    },
    setLang(l) {
      lang = l === 'en' ? 'en' : 'ko';
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.I18n = api;
    root.T = t;
  }
})(typeof window !== 'undefined' ? window : globalThis);
