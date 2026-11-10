'use strict';
// English for the page (public/i18n.js): { 'Korean text': 'English' } or { one, other } where
// the text counts something ({n}). Grouped by the file that says it. A new Korean text in the
// page gets its English here in the same change (test/i18n.test.js checks every t() has one).
(function (root) {
  const EN = {
    // rowtext
    "셸": "Shell",
    "오프라인": "offline",
    "API 버전 다름, 배포 필요": "API version differs, deploy needed",
    "어제": "yesterday",
    "{when} {time} 기준": "as of {when} {time}",
    "{time} 기준": "as of {time}",
    "답 필요": "Needs answer",
    "완료": "Done",
    "작업 중": "Working",
    "쉬는 중": "Idle",
    "마지막: 메뉴 열림": "Last: menu open",
    "마지막: {status}": "Last: {status}",
    "마지막 모습": "Last seen",
    "옆으로 밀어 호스트 바꾸기 · 길게 눌러 메뉴": "Swipe sideways to change host · Long-press for the menu",
    "줄을 길게 누르면 메뉴가 나옵니다": "Long-press a row for its menu",
  };
  if (typeof module === 'object' && module.exports) module.exports = EN;
  else root.I18N_EN = EN;
})(typeof window !== 'undefined' ? window : globalThis);
