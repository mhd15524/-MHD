'use strict';

/* ============================================================
   PDF — dependency-free PDF writer (core fonts, A4 portrait)
   + professional installment statement generator
   ============================================================ */

const PDF = (function () {
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;

  /* Approximate Helvetica glyph widths (in units of font size) */
  const W_TABLE = {
    ' ': 0.28, '!': 0.28, '"': 0.35, '#': 0.56, '$': 0.56, '%': 0.89, '&': 0.67,
    "'": 0.19, '(': 0.33, ')': 0.33, '*': 0.39, '+': 0.56, ',': 0.28, '-': 0.33,
    '.': 0.28, '/': 0.28, '0': 0.5, '1': 0.5, '2': 0.5, '3': 0.5, '4': 0.5,
    '5': 0.5, '6': 0.5, '7': 0.5, '8': 0.5, '9': 0.5, ':': 0.28, ';': 0.28,
    '<': 0.56, '=': 0.56, '>': 0.56, '?': 0.44, '@': 0.93,
    'A': 0.67, 'B': 0.67, 'C': 0.72, 'D': 0.72, 'E': 0.67, 'F': 0.61, 'G': 0.78,
    'H': 0.72, 'I': 0.28, 'J': 0.5, 'K': 0.67, 'L': 0.56, 'M': 0.83, 'N': 0.72,
    'O': 0.78, 'P': 0.67, 'Q': 0.78, 'R': 0.72, 'S': 0.67, 'T': 0.61, 'U': 0.72,
    'V': 0.67, 'W': 0.94, 'X': 0.67, 'Y': 0.67, 'Z': 0.61,
    '[': 0.28, '\\': 0.28, ']': 0.28, '^': 0.47, '_': 0.5, '`': 0.33,
    'a': 0.5, 'b': 0.5, 'c': 0.44, 'd': 0.5, 'e': 0.5, 'f': 0.28, 'g': 0.5,
    'h': 0.5, 'i': 0.22, 'j': 0.22, 'k': 0.5, 'l': 0.22, 'm': 0.78, 'n': 0.5,
    'o': 0.5, 'p': 0.5, 'q': 0.5, 'r': 0.33, 's': 0.44, 't': 0.28, 'u': 0.5,
    'v': 0.5, 'w': 0.72, 'x': 0.5, 'y': 0.5, 'z': 0.44,
    '{': 0.33, '|': 0.28, '}': 0.33, '~': 0.56
  };

  /* Unicode chars that map directly to Windows-1252 (WinAnsi) bytes so
     PDF output preserves them instead of turning them into '?'. */
  const WIN1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F
  };

  function clean(t) {
    return String(t == null ? '' : t)
      .split('')
      .map(function (ch) {
        const code = ch.charCodeAt(0);
        if (code >= 32 && code <= 255) return ch;
        const mapped = WIN1252[code];
        return mapped !== undefined ? String.fromCharCode(mapped) : '?';
      })
      .join('');
  }

  function esc(t) {
    return clean(t)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function textW(str, size) {
    if (str && typeof ArabicFont !== 'undefined' && ArabicFont.hasArabic(str)) {
      return ArabicFont.widthOf(str, size);
    }
    let units = 0;
    for (const ch of String(str)) {
      const w = W_TABLE[ch];
      units += (w !== undefined ? w : 0.5);
    }
    return units * size;
  }

  let arabicUsed = false;

  function create() {
    const lines = [];

    function yp(y) { return PAGE_H - y; }

    return {
      text(x, y, size, str, opt) {
        opt = opt || {};
        let font = '/F1';
        if (opt.font === 'serif') font = '/F3';
        else if (opt.font === 'serifBold') font = '/F4';
        else if (opt.font === 'bold') font = '/F2';
        else if (opt.bold) font = '/F2';
        const isArabic = str && typeof ArabicFont !== 'undefined' && ArabicFont.hasArabic(str);
        if (isArabic) { font = '/F5'; arabicUsed = true; }
        let xx = x;
        if (opt.align === 'right') xx = x - textW(str, size);
        else if (opt.align === 'center') xx = x - textW(str, size) / 2;
        const content = isArabic ? '<' + ArabicFont.shapedToHex(str) + '>' : '(' + esc(str) + ')';
        if (opt.color) lines.push(opt.color[0] + ' ' + opt.color[1] + ' ' + opt.color[2] + ' rg');
        lines.push('BT ' + font + ' ' + size + ' Tf 1 0 0 1 ' + xx.toFixed(2) + ' ' + yp(y).toFixed(2) + ' Tm ' + content + ' Tj ET');
      },
      line(x1, y1, x2, y2, opt) {
        opt = opt || {};
        if (opt.color) lines.push(opt.color[0] + ' ' + opt.color[1] + ' ' + opt.color[2] + ' RG');
        if (opt.width) lines.push(opt.width + ' w');
        lines.push(x1.toFixed(2) + ' ' + yp(y1).toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + yp(y2).toFixed(2) + ' l S');
      },
      rect(x, y, w, h, opt) {
        opt = opt || {};
        const py = yp(y) - h;
        if (opt.fill) {
          if (opt.fillColor) lines.push(opt.fillColor[0] + ' ' + opt.fillColor[1] + ' ' + opt.fillColor[2] + ' rg');
          lines.push(x.toFixed(2) + ' ' + py.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f');
        } else {
          if (opt.color) lines.push(opt.color[0] + ' ' + opt.color[1] + ' ' + opt.color[2] + ' RG');
          if (opt.width) lines.push(opt.width + ' w');
          lines.push(x.toFixed(2) + ' ' + py.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re S');
        }
      },
      content() {
        return lines.join('\n');
      }
    };
  }

  /* Build the raw PDF bytes for a set of pages */
  function render(pages) {
    const n = pages.length;
    const base = 3 + 2 * n;
    const F1 = base;
    const F2 = F1 + 1;
    const F3 = F2 + 1;
    const F4 = F3 + 1;
    const hasArabic = arabicUsed;
    let F5, F6, F7, F8, F9;
    if (hasArabic) {
      F5 = F4 + 1;   /* Type0 (Arabic) */
      F6 = F5 + 1;   /* CIDFontType2 */
      F7 = F6 + 1;   /* FontDescriptor */
      F8 = F7 + 1;   /* FontFile2 */
      F9 = F8 + 1;   /* ToUnicode CMap */
    }
    const lastObj = hasArabic ? F9 : F4;
    const kids = [];
    for (let i = 0; i < n; i++) kids.push(3 + i + ' 0 R');

    const parts = [];
    const offsets = {};
    let offset = 0;
    function push(s) {
      parts.push(s);
      offset += s.length;
    }
    function obj(num, body) {
      offsets[num] = offset;
      push(num + ' 0 obj\n' + body + '\nendobj\n');
    }

    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
    const encF1 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    const encF2 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    const encF3 = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>';
    const encF4 = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-BoldItalic /Encoding /WinAnsiEncoding >>';
    const pageFonts = hasArabic
      ? '/F1 ' + F1 + ' 0 R /F2 ' + F2 + ' 0 R /F3 ' + F3 + ' 0 R /F4 ' + F4 + ' 0 R /F5 ' + F5 + ' 0 R'
      : '/F1 ' + F1 + ' 0 R /F2 ' + F2 + ' 0 R /F3 ' + F3 + ' 0 R /F4 ' + F4 + ' 0 R';
    for (let i = 0; i < n; i++) {
      obj(3 + i,
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
        '/Resources << /Font << ' + pageFonts + ' >> >> ' +
        '/Contents ' + (3 + n + i) + ' 0 R >>');
    }
    for (let i = 0; i < n; i++) {
      const content = pages[i].content;
      obj(3 + n + i, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
    }
    obj(F1, encF1);
    obj(F2, encF2);
    obj(F3, encF3);
    obj(F4, encF4);

    if (hasArabic && typeof ArabicFont !== 'undefined') {
      const m = ArabicFont.metrics();
      const raw = ArabicFont.getBytes();
      /* Scale design units (upem is 2048 for this font) to 1000-unit PDF text space. */
      const ws = 1000 / (m.unitsPerEm || 1000);
      const sc = function (v) { return Math.round((v || 0) * ws); };
      const bbox = m.bbox.map(sc);
      const ascent = sc(m.ascent);
      const descent = sc(m.descent);
      const capHeight = sc(m.capHeight);
      /* /W widths for used glyphs */
      const used = collectUsedGlyphs(pages);
      const wOf = function (g) { return sc(m.advWidths[g]); };
      let wArr = '/W [';
      if (used.length) {
        let start = used[0], prev = used[0], group = [wOf(used[0])];
        function flush() {
          wArr += ' ' + start + ' [' + group.join(' ') + ']';
        }
        for (let i = 1; i < used.length; i++) {
          if (used[i] === prev + 1) {
            group.push(wOf(used[i])); prev = used[i];
          } else {
            flush();
            start = used[i]; prev = used[i]; group = [wOf(used[i])];
          }
        }
        flush();
      }
      wArr += ']';

      const toUnicode = buildToUnicode(used);
      obj(F5,
        '<< /Type /Font /Subtype /Type0 /BaseFont /TradBdo /Encoding /Identity-H ' +
        '/DescendantFonts [' + F6 + ' 0 R] /ToUnicode ' + F9 + ' 0 R >>');
      obj(F6,
        '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TradBdo ' +
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
        '/FontDescriptor ' + F7 + ' 0 R /DW 1000 ' + wArr + ' /CIDToGIDMap /Identity >>');
      obj(F7,
        '<< /Type /FontDescriptor /FontName /TradBdo /Flags 4 ' +
        '/FontBBox [' + bbox.join(' ') + '] /ItalicAngle 0 /Ascent ' + ascent +
        ' /Descent ' + descent + ' /CapHeight ' + capHeight + ' /StemV 80 /FontFile2 ' + F8 + ' 0 R >>');
      obj(F8,
        '<< /Length1 ' + raw.length + ' /Length ' + raw.length + ' >>\nstream\n' +
        bytesToBinary(raw) + '\nendstream');
      obj(F9, toUnicode);
    }

    const xrefStart = offset;
    let xref = 'xref\n0 ' + (lastObj + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= lastObj; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (lastObj + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');

    const all = parts.join('');
    const bytes = new Uint8Array(all.length);
    for (let i = 0; i < all.length; i++) bytes[i] = all.charCodeAt(i) & 0xff;
    arabicUsed = false;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* Collect glyph IDs used by <...> hex strings in page content. */
  function collectUsedGlyphs(pages) {
    const set = {};
    pages.forEach(function (p) {
      const m = p.content.match(/<([0-9A-Fa-f]+)>/g);
      if (!m) return;
      m.forEach(function (tok) {
        const hex = tok.slice(1, -1);
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          set[parseInt(hex.substr(i, 4), 16)] = true;
        }
      });
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  function buildToUnicode(used) {
    let s = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    const n = Math.min(used.length, 100);
    s += n + ' beginbfchar\n';
    used.forEach(function (g) {
      const unicode = glyphToUnicode(g);
      s += '<' + padHex(g, 4) + '> <' + unicode + '>\n';
    });
    s += 'endbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    return '<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream';
  }

  function glyphToUnicode(g) {
    const m = (typeof ArabicFont !== 'undefined') ? ArabicFont.glyphToUnicode(g) : null;
    return m ? m : padHex(g, 4);
  }

  function padHex(n, len) {
    let h = n.toString(16).toUpperCase();
    while (h.length < len) h = '0' + h;
    return h;
  }

  function bytesToBinary(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  /* ---------------- Statement builder ---------------- */

  const NAVY = [0.09, 0.08, 0.05];
  const GOLD = [0.72, 0.53, 0.2];
  const GOLD_DARK = [0.55, 0.4, 0.12];
  const GOLD_SOFT = [0.985, 0.963, 0.91];
  const GOLD_LINE = [0.86, 0.73, 0.42];
  const CREAM = [0.988, 0.975, 0.93];
  const GRAY = [0.63, 0.57, 0.43];
  const LIGHT = [0.955, 0.958, 0.96];
  const WHITE = [1, 1, 1];
  const DARK = [0.11, 0.09, 0.06];
  const GREEN = [0.85, 0.70, 0.29];
  const RED = [0.76, 0.55, 0.22];
  const BLACK = [0.07, 0.06, 0.04];
  const GOLD_BRIGHT = [0.94, 0.82, 0.53];
  const GREEN_BRIGHT = [0.96, 0.87, 0.58];
  const RED_BRIGHT = [0.90, 0.72, 0.42];

  function letterspaced(str, step) {
    const s = String(str == null ? '' : str);
    if (s.length < 2) return s;
    if (typeof ArabicFont !== 'undefined' && ArabicFont.hasArabic(s)) return s;
    return s.split('').join(new Array(step + 1).join(' '));
  }

  function fit(str, size, maxW) {
    let s = String(str == null ? '' : str);
    while (s.length > 1 && textW(s, size) > maxW) {
      s = s.slice(0, -1);
    }
    if (textW(s, size) > maxW) s = s.slice(0, Math.max(1, Math.floor(s.length * maxW / textW(s, size))));
    return s;
  }

  function wrap(str, size, maxW) {
    const words = String(str == null ? '' : str).split(/\s+/);
    const lines = [];
    let cur = '';
    words.forEach(function (w) {
      const t = cur ? cur + ' ' + w : w;
      if (textW(t, size) <= maxW) { cur = t; return; }
      if (cur) lines.push(cur);
      cur = w;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /* Wrap text preserving newlines and never truncating characters.
     Each '\n' starts a new line; long lines wrap at word boundaries.
     Original whitespace (spaces/tabs) inside a line is kept intact. */
  function wrapExact(str, size, maxW) {
    const out = [];
    String(str == null ? '' : str).split('\n').forEach(function (para) {
      if (para === '') { out.push(''); return; }
      const toks = para.match(/\s+|\S+/g) || [];
      let cur = '';
      toks.forEach(function (tok) {
        const t = cur + tok;
        if (textW(t, size) <= maxW) { cur = t; return; }
        if (cur) out.push(cur);
        cur = tok;
      });
      if (cur) out.push(cur);
    });
    return out;
  }

  function money(n, cur) {
    return cur + n.toFixed(2);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const parts = iso.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (parts[2] < 10 ? '0' : '') + parts[2] + ' ' + months[(parts[1] || 1) - 1] + ' ' + parts[0];
  }

  function weekdayOf(iso) {
    if (!iso) return '';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const parts = iso.split('-').map(Number);
    return days[new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1).getDay()];
  }

  function buildStatement(c, settings) {
    const cur = settings.currency || '$';
    const ML = 48;
    const MR = 48;
    const CW = PAGE_W - ML - MR;
    const pages = [];
    let c2 = create();
    let y = 0;
    const MAX_Y = PAGE_H - 104;
    const biz = settings.businessName || 'My Business';
    const today = c.statementDate || new Date().toISOString().slice(0, 10);
    const plan = c.plan;
    const paid = (c.payments || []).reduce((s, p) => s + p.amount, 0);
    const discTotal = (c.discounts || []).reduce((s, d) => s + d.amount, 0);
    const balance = Math.max(0, plan.total - paid - discTotal);
    const isCash = plan.type === 'cash';
    const count = isCash ? 1 : plan.count;

    /* Remaining owed from installments: what's left of the financed total after the paid installments. */
    let paidInstSum = 0;
    if (!isCash) {
      const insts = c.installments || [];
      const notePaid = {};
      let manualTotal = 0;
      (c.payments || []).forEach(function (p) {
        if (p.note && p.note.indexOf('Installment #') === 0) {
          const n = parseInt(p.note.slice('Installment #'.length), 10);
          if (n) notePaid[n] = (notePaid[n] || 0) + p.amount;
        } else {
          manualTotal += p.amount;
        }
      });
      let manualUsed = 0;
      insts.forEach(function (it) {
        const noteCov = Math.min(it.amount, notePaid[it.i] || 0);
        const needManual = Math.max(0, it.amount - noteCov);
        const manualCov = Math.min(needManual, Math.max(0, manualTotal - manualUsed));
        manualUsed += manualCov;
        if (noteCov + manualCov >= it.amount - 0.005) paidInstSum += it.amount;
      });
    } else {
      paidInstSum = Math.min(plan.total, paid);
    }
    const remainingFromInst = Math.max(0, Math.round(((plan.total - (plan.down || 0)) - paidInstSum) * 100) / 100);

    function drawPageFooter() {
      const fy = PAGE_H - 44;
      c2.line(ML, fy - 8, PAGE_W - MR, fy - 8, { color: GOLD, width: 0.6 });
      c2.line(PAGE_W / 2 - 50, fy - 10, PAGE_W / 2 + 50, fy - 10, { color: GOLD, width: 0.4 });
      c2.text(PAGE_W / 2, fy - 14, 7, letterspaced(biz.toUpperCase(), 1), { font: 'serif', align: 'center', color: GOLD_DARK });
      c2.text(ML, fy + 2, 7.5, 'Prepared on ' + fmtDate(today), { color: GRAY });
      c2.text(PAGE_W - MR, fy - 2, 9, 'Authorized Signature', { color: GRAY, align: 'right' });
      c2.line(PAGE_W - MR - 96, fy - 4, PAGE_W - MR, fy - 4, { color: GRAY, width: 0.6 });
      c2.text(PAGE_W / 2, PAGE_H - 22, 7.5, '__PAGENUM__', { color: GRAY, align: 'center' });
      c2.text(PAGE_W / 2, PAGE_H - 32, 6.5, letterspaced('This document is computer-generated and valid without a signature.', 1), { color: GRAY, align: 'center' });
    }

    function newPage() {
      drawPageFooter();
      pages.push(c2.content());
      c2 = create();
      y = 40;
      /* thin gold rule at top of continuation pages */
      c2.line(ML, 30, PAGE_W - MR, 30, { color: GOLD_LINE, width: 0.6 });
      c2.text(PAGE_W / 2, 34, 7, letterspaced(fit(biz, 7, CW * 0.8), 2), { color: GRAY, align: 'center' });
      y = 48;
    }
    function ensure(h) {
      if (y + h > MAX_Y) newPage();
    }

    /* --- Elegant gold frame (page 1) --- */
    c2.rect(22, 22, PAGE_W - 44, PAGE_H - 44, { color: GOLD_LINE, width: 0.7 });
    c2.rect(26, 26, PAGE_W - 52, PAGE_H - 52, { color: GOLD_LINE, width: 0.3 });

    /* --- Branding header (first page) --- */
    c2.rect(0, 0, PAGE_W, 2.4, { fill: true, fillColor: GOLD });
    c2.rect(0, 2.4, PAGE_W, 1, { fill: true, fillColor: GOLD_SOFT });

    /* Monogram medallion */
    const medX = PAGE_W / 2;
    const medY = 54;
    const medR = 26;
    const medText = biz.split(/\s+/).filter(Boolean).slice(0, 2).map(w => (w[0] || '')).join('').toUpperCase() || 'MS';
    c2.rect(medX - medR, medY - medR, medR * 2, medR * 2, { fill: true, fillColor: CREAM });
    c2.rect(medX - medR, medY - medR, medR * 2, medR * 2, { color: GOLD, width: 1.2 });
    c2.rect(medX - medR + 3, medY - medR + 3, medR * 2 - 6, medR * 2 - 6, { color: GOLD, width: 0.4 });
    c2.text(medX, medY + 1, 16, medText, { font: 'serifBold', align: 'center', color: GOLD_DARK });

    c2.text(PAGE_W / 2, 106, 21, fit(biz, 21, CW * 0.8), { font: 'serifBold', align: 'center', color: NAVY });
    const tag = [settings.businessPhone, settings.businessAddress].filter(Boolean).join('    •    ');
    if (tag) c2.text(PAGE_W / 2, 124, 9, fit(tag, 9, CW * 0.9), { color: GRAY, align: 'center' });
    c2.line(ML + 40, 134, PAGE_W - MR - 40, 134, { color: GOLD_LINE, width: 0.8 });
    c2.text(PAGE_W / 2, 150, 11, letterspaced('INSTALLMENT PAYMENT STATEMENT', 2), { font: 'serif', align: 'center', color: GOLD_DARK });
    c2.line(ML + 40, 158, PAGE_W - MR - 40, 158, { color: GOLD_LINE, width: 0.4 });
    c2.line(PAGE_W / 2 - 60, 164, PAGE_W / 2 + 60, 164, { color: GOLD, width: 0.5 });
    c2.line(PAGE_W / 2 - 4, 162, PAGE_W / 2 + 4, 162, { fill: true, fillColor: GOLD });
    y = 174;

    /* --- Customer line (compact) + note under name --- */
    /* Arabic text is rendered RTL — align from the right edge */
    const nameIsArabic = typeof ArabicFont !== 'undefined' && ArabicFont.hasArabic(c.name);
    c2.text(ML, y, 10, 'Customer:', { font: 'serifBold', color: GRAY });
    if (nameIsArabic) {
      /* RTL: anchor to right side of the name area */
      const nameLines = wrapExact(c.name, 12, CW * 0.55);
      nameLines.forEach(function (ln, li) {
        c2.text(PAGE_W - MR, y + li * 15, 12, ln, { font: 'serifBold', color: NAVY, align: 'right' });
      });
      c2.text(ML + 62, y, 9, 'ID: ' + c.id + '   ·   ' + fmtDate(today), { color: GRAY });
      y += 20 + (nameLines.length - 1) * 15;
      if (c.notes) {
        const notesIsArabic = typeof ArabicFont !== 'undefined' && ArabicFont.hasArabic(c.notes);
        wrapExact(c.notes, 9, CW - 62 - 10).forEach(function (ln) {
          if (notesIsArabic) c2.text(PAGE_W - MR, y, 9, ln, { color: DARK, align: 'right' });
          else c2.text(ML + 62, y, 9, ln, { color: DARK });
          y += 12;
        });
        y += 4;
      }
    } else {
      const nameLines = wrapExact(c.name, 12, CW * 0.55);
      nameLines.forEach(function (ln, li) {
        c2.text(ML + 62, y + li * 15, 12, ln, { font: 'serifBold', color: NAVY });
      });
      c2.text(PAGE_W - MR, y, 9, 'ID: ' + c.id + '   ·   ' + fmtDate(today), { color: GRAY, align: 'right' });
      y += 20 + (nameLines.length - 1) * 15;
      if (c.notes) {
        const notesIsArabic = typeof ArabicFont !== 'undefined' && ArabicFont.hasArabic(c.notes);
        wrapExact(c.notes, 9, CW - 62 - 10).forEach(function (ln) {
          if (notesIsArabic) c2.text(PAGE_W - MR, y, 9, ln, { color: DARK, align: 'right' });
          else c2.text(ML + 62, y, 9, ln, { color: DARK });
          y += 12;
        });
        y += 4;
      }
    }

    /* --- Top: user-written boxes (Car Total / Cash Paid / Remaining) in black --- */
    const gap = 10;
    const sumBoxW = (CW - gap * 2) / 3;
    const sumBoxH = 52;
    function summaryBox(x, yy, label, value, accentClr, valClr) {
      c2.rect(x, yy, sumBoxW, sumBoxH, { fill: true, fillColor: BLACK });
      c2.rect(x, yy, sumBoxW, 3, { fill: true, fillColor: accentClr });
      c2.rect(x, yy, sumBoxW, sumBoxH, { color: GOLD, width: 0.5 });
      c2.text(x + sumBoxW / 2, yy + 14, 7, letterspaced(label, 1), { color: GOLD_BRIGHT, align: 'center' });
      c2.text(x + sumBoxW / 2, yy + 38, 18, money(value, cur), { font: 'serifBold', align: 'center', color: valClr });
    }
    const uTotal = (c.boxTotal != null && c.boxTotal !== '') ? c.boxTotal : plan.total;
    const uPaid = (c.boxPaid != null && c.boxPaid !== '') ? c.boxPaid : paid;
    const uRemaining = (c.boxRemaining != null && c.boxRemaining !== '') ? c.boxRemaining : balance;

    function paidDetailFor(it, cc) {
      const pays = (cc.payments || []).slice().sort(function (a, b) { return a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date); });
      const insts = cc.installments || [];
      const matched = (cc.payments || []).filter(function (p) { return p.note === 'Installment #' + it.i; });
      if (matched.length) {
        let mTot = 0;
        for (const p of matched) {
          mTot += p.amount;
          if (mTot >= it.amount - 0.005) {
            return { date: p.date, paidAmount: it.amount, remainingAfter: 0 };
          }
        }
      }
      let cumBefore = 0, found = false;
      for (let k = 0; k < insts.length; k++) {
        if (insts[k].i === it.i) { found = true; break; }
        cumBefore += insts[k].amount;
      }
      if (!found) return { date: '', paidAmount: 0, remainingAfter: it.amount };
      const target = cumBefore + it.amount;
      let totalPaid = 0;
      for (const p of pays) {
        totalPaid += p.amount;
        if (totalPaid >= target - 0.005) {
          return { date: p.date, paidAmount: it.amount, remainingAfter: 0 };
        }
      }
      const applied = Math.max(0, Math.min(it.amount, totalPaid - cumBefore));
      return { date: '', paidAmount: applied, remainingAfter: Math.max(0, it.amount - applied) };
    }
    summaryBox(ML, y, 'CAR TOTAL', uTotal, GOLD, GOLD_BRIGHT);
    summaryBox(ML + sumBoxW + gap, y, 'CASH PAID', uPaid, GREEN, GREEN_BRIGHT);
    summaryBox(ML + (sumBoxW + gap) * 2, y, 'REMAINING', uRemaining, RED, RED_BRIGHT);
    y += sumBoxH + 16;

    /* --- Below: plan boxes (Total Amount / Down Payment / Remaining from installments) --- */
    const infoBoxW = (CW - gap * 2) / 3;
    const infoBoxH = 46;
    function infoBox(x, yy, label, value, lsStep) {
      c2.rect(x, yy, infoBoxW, infoBoxH, { fill: true, fillColor: GOLD_SOFT });
      c2.rect(x, yy, infoBoxW, 2, { fill: true, fillColor: GOLD });
      c2.rect(x, yy, infoBoxW, infoBoxH, { color: GOLD, width: 0.6 });
      c2.text(x + 11, yy + 9, 6.3, letterspaced(label, lsStep === undefined ? 1 : lsStep), { color: GOLD_DARK });
      c2.text(x + 11, yy + 30, 12, fit(value, 12, infoBoxW - 22), { font: 'serifBold', color: NAVY });
    }
    infoBox(ML, y, 'TOTAL AMOUNT', money(plan.total, cur));
    infoBox(ML + infoBoxW + gap, y, 'DOWN PAYMENT', money(plan.down || 0, cur));
    infoBox(ML + (infoBoxW + gap) * 2, y, 'REMAINING FROM INSTALLMENTS', money(remainingFromInst, cur), 0);
    y += infoBoxH + 16;

    function sectionTitle(txt) {
      c2.text(ML, y, 11.5, txt, { font: 'serifBold', color: NAVY });
      y += 5;
      c2.line(ML, y, ML + 150, y, { color: GOLD, width: 0.9 });
      y += 16;
    }

    /* Paginated table drawer (light + gold). Cell text is wrapped, never
       truncated, so notes/descriptions appear exactly as entered. */
    function drawTable(x, colWidths, headers, rows, opt) {
      opt = opt || {};
      const baseH = opt.rowH || 20;
      const headH = opt.headH || 22;
      const headSize = opt.headSize || 8;
      const pad = opt.pad || 6;
      const totalW = colWidths.reduce(function (s, w) { return s + w; }, 0);
      const zebra = opt.zebra !== false;
      const aligns = opt.aligns || [];
      const cellSize = opt.cellSize || 8.5;
      const grid = opt.grid === true;
      const strongCols = opt.strong || [];
      const strongFont = opt.strongFont || 'serifBold';
      const lineH = opt.lineH || cellSize + 4;
      let ri = 0;
      let first = true;
      function colDividers(yy, hh) {
        let gx = x;
        for (let i = 1; i < colWidths.length; i++) {
          gx += colWidths[i - 1];
          c2.line(gx, yy, gx, yy + hh, { color: GOLD_LINE, width: 0.25 });
        }
      }
      function cellLines(cell, ci) {
        if (cell === '✓' || cell === '✗') return null;
        return wrapExact(String(cell == null ? '' : cell), cellSize, colWidths[ci] - pad * 2);
      }
      function rowHeight(row) {
        let lines = 1;
        row.forEach(function (cell, ci) {
          const ln = cellLines(cell, ci);
          if (ln && ln.length > lines) lines = ln.length;
        });
        return Math.max(baseH, Math.ceil(lines * lineH) + 4);
      }
      function drawRow(row, rh) {
        if (zebra && ri % 2 === 1) c2.rect(x, y, totalW, rh, { fill: true, fillColor: GOLD_SOFT });
        let cx = x;
        row.forEach(function (cell, ci) {
          const align = aligns[ci] === 'r' ? 'right' : 'left';
          const w = colWidths[ci];
          if (cell === '✓' || cell === '✗') {
            const cxm = cx + w / 2;
            const cym = y + rh / 2;
            if (cell === '✓') {
              c2.line(cxm - 3.2, cym - 2.2, cxm - 1, cym + 1.6, { color: GREEN, width: 1.5 });
              c2.line(cxm - 1, cym + 1.6, cxm + 3.6, cym - 3, { color: GREEN, width: 1.5 });
            } else {
              c2.line(cxm - 2.8, cym - 2.8, cxm + 2.8, cym + 2.8, { color: RED, width: 1.4 });
              c2.line(cxm - 2.8, cym + 2.8, cxm + 2.8, cym - 2.8, { color: RED, width: 1.4 });
            }
            cx += w;
            return;
          }
          const lines = cellLines(cell, ci);
          const strong = strongCols.indexOf(ci) >= 0;
          const topts = { color: strong ? NAVY : DARK };
          if (strong) topts.font = strongFont;
          const startY = y + rh - 7 - (lines.length - 1) * lineH;
          lines.forEach(function (txt, li) {
          const isArab = typeof ArabicFont !== 'undefined' && ArabicFont.hasArabic(String(txt));
            if (align === 'right' || isArab) { topts.align = 'right'; c2.text(cx + w - pad, startY + li * lineH, cellSize, txt, topts); }
            else c2.text(cx + pad, startY + li * lineH, cellSize, txt, topts);
          });
          cx += w;
        });
        if (grid) {
          colDividers(y, rh);
          c2.line(x, y + rh, x + totalW, y + rh, { color: GOLD_LINE, width: 0.25 });
        }
      }
      while (ri < rows.length) {
        const rh = rowHeight(rows[ri]);
        if (first) {
          if (y + headH + rh > MAX_Y) { newPage(); continue; }
          c2.rect(x, y, totalW, headH, { fill: true, fillColor: CREAM });
          c2.rect(x, y, totalW, headH, { color: GOLD, width: 0.6 });
          if (grid) {
            colDividers(y, headH);
            c2.line(x, y + headH, x + totalW, y + headH, { color: GOLD_LINE, width: 0.25 });
          }
          let cx = x;
          headers.forEach(function (h, i) {
            c2.text(cx + pad, y + headH - 7, headSize, letterspaced(fit(h, headSize, colWidths[i] - pad * 2), 1), { font: 'serifBold', color: NAVY });
            cx += colWidths[i];
          });
          y += headH;
          first = false;
        }
        /* If one row is taller than a whole page, draw it anyway to avoid an
           endless page loop (long unbroken notes may wrap to many lines). */
        if (y + rh > MAX_Y) {
          if (rh >= MAX_Y) { drawRow(rows[ri], Math.min(rh, MAX_Y - y + baseH)); y += rh; ri++; continue; }
          newPage(); first = true; continue;
        }
        drawRow(rows[ri], rh);
        y += rh;
        ri++;
      }
      c2.line(x, y, x + totalW, y, { color: GOLD, width: 0.5 });
    }

    /* --- Installment schedule --- */
    ensure(30);
    sectionTitle('Installment Schedule');
    const sHeaders = ['No.', 'Due Date', 'Amount', 'Status', 'Paid Detail', 'Remaining'];
    const sRows = [];
    if (isCash) {
      sRows.push(['1', fmtDate(plan.startDate), money(plan.total, cur), '✓', '', money(0, cur)]);
    } else {
      let cum = 0;
      const insts = c.installments || [];
      const instOrig = (c.installments && c.installments.length) ? {} : null;
      const notePaid = {};
      let manualTotal = 0;
      (c.payments || []).forEach(function (p) {
        if (p.note && p.note.indexOf('Installment #') === 0) {
          const n = parseInt(p.note.slice('Installment #'.length), 10);
          if (n) notePaid[n] = (notePaid[n] || 0) + p.amount;
        } else {
          manualTotal += p.amount;
        }
      });
      let manualUsed = 0;
      insts.forEach(function (it) {
        cum += it.amount;
        const noteCov = Math.min(it.amount, notePaid[it.i] || 0);
        const needManual = Math.max(0, it.amount - noteCov);
        const manualCov = Math.min(needManual, Math.max(0, manualTotal - manualUsed));
        manualUsed += manualCov;
        const covered = noteCov + manualCov;
        const status = (covered >= it.amount - 0.005) ? '✓' : '✗';
        const remAfter = money(Math.max(0, (plan.total - (plan.down || 0)) - cum), cur);
        let detail = '';
        if (status === '✓') {
          detail = 'Paid ' + fmtDate(paidDetailFor(it, c).date) + ' · ' + money(paidDetailFor(it, c).paidAmount, cur);
        }
        const hasDisc = it.original != null && it.amount < it.original - 0.005;
        sRows.push([String(it.i), weekdayOf(it.due) + ' ' + fmtDate(it.due), money(it.amount, cur) + (hasDisc ? '  (disc −' + money(it.original - it.amount, cur) + ')' : ''), status, detail, remAfter]);
      });
    }
    drawTable(ML, [30, 84, 88, 54, 147, 96], sHeaders, sRows, { rowH: 24, headH: 26, headSize: 8.5, aligns: ['l', 'l', 'r', 'l', 'l', 'r'], cellSize: 8.5, grid: true, strong: [2, 5], strongFont: 'bold' });
    y += 16;

    /* --- Payment history --- */
    ensure(30);
    sectionTitle('Payment History');
    const pays = (c.payments || []).slice();
    if (pays.length === 0) {
      c2.rect(ML, y, CW, 26, { color: GOLD, width: 0.7 });
      c2.text(ML + 10, y + 10, 9, 'No payments recorded yet.', { color: GRAY });
      y += 42;
    } else {
      const pH = [['Date', 'Description', 'Amount', 'Running Total']];
      const pRows = [];
      let run = 0;
      pays.forEach(function (p) {
        run += p.amount;
        pRows.push([fmtDate(p.date), p.note || 'Payment received', money(p.amount, cur), money(run, cur)]);
      });
      drawTable(ML, [130, 150, 115, 115], pH, pRows, { rowH: 20, headH: 22, aligns: ['l', 'l', 'r', 'r'], cellSize: 8.5 });
      y += 16;
    }

    /* Finalize: add footer to last page, then number all pages */
    drawPageFooter();
    pages.push(c2.content());
    const total = pages.length;
    for (let i = 0; i < total; i++) {
      pages[i] = { content: pages[i].split('__PAGENUM__').join('Page ' + (i + 1) + ' of ' + total) };
    }
    return render(pages);
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  return {
    buildStatement: buildStatement,
    download: download
  };
})();
