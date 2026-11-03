'use strict';
// Read a pane's text. source: visible | recent | recent_unwrapped (default recent).
// An agent that is working can't give its scrollback ("agent_not_idle"): read what is visible
// instead. A herdr without recent_unwrapped gets plain recent from then on. The answer says
// which source was actually read.
// format "ansi" keeps the colours (SGR codes only) for the screen box; plain text stays the
// default for everyone else (choice parsing, the blocked prompt). A herdr that doesn't know
// the format gets plain text from then on, and the answer says which format came back.

const READ_SOURCES = ['visible', 'recent', 'recent_unwrapped'];
const READ_FATAL = ['pane_not_found', 'agent_not_found', 'unreachable', 'timeout', 'empty_response', 'bad_response'];
const badFormat = (err) => err.code === 'invalid_request' && /format|ansi/i.test(err.message || '');
const notIdle = (err) => /not_idle/.test(err.code || '') || /while .* is working|--source visible/i.test(err.message || '');

// call: herdr.call. Returns readScreen(method, target, wanted, lines, wantedFormat); what the
// herdr turned out not to support is remembered by that reader.
function screenReader(call, log = console.log) {
  let unwrappedOk = true;
  let ansiOk = true;
  return async function readScreen(method, target, wanted, lines, wantedFormat) {
    let source = READ_SOURCES.includes(wanted) ? wanted : 'recent';
    if (source === 'recent_unwrapped' && !unwrappedOk) source = 'recent';
    let ansi = wantedFormat === 'ansi' && ansiOk;
    for (;;) {
      try {
        const params = ansi ? { format: 'ansi', strip_ansi: false } : { strip_ansi: true };
        const r = await call(method, { ...target, source, lines, ...params });
        return { text: r.read.text, truncated: r.read.truncated, source, format: ansi && r.read.format === 'ansi' ? 'ansi' : 'text' };
      } catch (err) {
        if (ansi && badFormat(err)) {
          ansiOk = ansi = false;
          log(`${method}: format ansi not supported (${err.message}); using plain text`);
        } else if (source !== 'visible' && notIdle(err)) source = 'visible';
        else if (source === 'recent_unwrapped' && !READ_FATAL.includes(err.code)) {
          unwrappedOk = false;
          log(`${method}: recent_unwrapped not supported (${err.code}: ${err.message}); using recent`);
          source = 'recent';
        } else throw err;
      }
    }
  };
}

module.exports = { screenReader };
