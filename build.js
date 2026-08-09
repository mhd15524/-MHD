/* ============================================================
   build.js — create a single minified bundle (js/app.min.js)
   Run after editing source files:
       node build.js
   index.html loads the bundle; source files remain for editing.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = ['storage.js', 'sync.js', 'pdf.js', 'excel.js', 'app.js'];
const OUT = path.join(__dirname, 'js', 'app.min.js');

/* Conservative minifier: strips comments and collapses whitespace
   without renaming identifiers (inline onclick handlers depend on
   global function names). Tracks strings so content is preserved. */
function minify(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const q = ['"', "'", '`'];
  const regexPreceders = '=(!&|?:;,[{+->~^%*/'.split('');
  let lastNonSpace = '';

  function isRegexStart() {
    if (!lastNonSpace) return true;
    if (regexPreceders.indexOf(lastNonSpace) >= 0) return true;
    const keywords = ['return', 'typeof', 'void', 'delete', 'new', 'in', 'case', 'of'];
    const tail = out.replace(/\s+$/, '');
    for (var k = 0; k < keywords.length; k++) {
      if (tail.endsWith(keywords[k])) return true;
    }
    return false;
  }

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*' && isRegexStart()) {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    /* regex literal */
    if (ch === '/' && next !== '/' && next !== '*' && isRegexStart()) {
      out += ch;
      i++;
      while (i < n) {
        const c = src[i];
        out += c;
        if (c === '\\') { i++; if (i < n) { out += src[i]; i++; } continue; }
        if (c === '/') { i++; break; }
        i++;
      }
      /* skip flags */
      while (i < n && /[gimsuy]/.test(src[i])) { out += src[i]; i++; }
      lastNonSpace = '/';
      continue;
    }
    if (q.indexOf(ch) >= 0) {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i];
        out += c;
        if (c === '\\') { i++; if (i < n) { out += src[i]; i++; } continue; }
        if (c === quote) { i++; break; }
        i++;
      }
      lastNonSpace = quote;
      continue;
    }
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') lastNonSpace = ch;
    out += ch;
    i++;
  }

  /* collapse blank lines and trim trailing spaces */
  return out.split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .filter((l, idx, arr) => !(l === '' && (idx === 0 || arr[idx - 1] === '')))
    .join('\n')
    .replace(/\n{2,}/g, '\n');
}

let bundle = '';
SRC.forEach((f, idx) => {
  let code = fs.readFileSync(path.join(__dirname, 'js', f), 'utf8');
  if (idx > 0) code = code.replace(/^'use strict';?\s*/, '');
  bundle += code + '\n';
});

fs.writeFileSync(OUT, minify(bundle));
console.log('Built ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
