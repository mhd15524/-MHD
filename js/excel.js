'use strict';

/* ============================================================
   Excel — luxury multi-sheet .xlsx export
   Pure-JS ZIP + OOXML — no dependencies.
   Sheets: Summary + Payments + per-customer tabs
   ============================================================ */

const Excel = (function () {

  /* ---------- CRC32 ---------- */
  const CRC = new Uint32Array(256);
  (function () {
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC[i] = c;
    }
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- Minimal ZIP (STORE method) ---------- */
  function zip(files) {
    let offset = 0;
    const entries = [];
    const encoder = new TextEncoder();
    files.forEach(function (f) {
      const nameBytes = encoder.encode(f.name);
      const dataBytes = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
      const crc = crc32(dataBytes);
      entries.push({ nameBytes, dataBytes, crc, offset, compressedSize: dataBytes.length, uncompressedSize: dataBytes.length });
      offset += 30 + nameBytes.length + dataBytes.length;
    });
    const cdStart = offset;
    entries.forEach(function (e) { offset += 46 + e.nameBytes.length; });
    const total = offset + 22;
    const out = new Uint8Array(total);
    let pos = 0;
    function w16(v) { out[pos] = v & 0xff; out[pos + 1] = (v >> 8) & 0xff; pos += 2; }
    function w32(v) { out[pos] = v & 0xff; out[pos + 1] = (v >> 8) & 0xff; out[pos + 2] = (v >> 16) & 0xff; out[pos + 3] = (v >> 24) & 0xff; pos += 4; }
    entries.forEach(function (e) {
      w32(0x04034b50); w16(20); w16(0); w16(0); w32(0); w32(e.crc); w32(e.compressedSize); w32(e.uncompressedSize); w16(e.nameBytes.length); w16(0);
      out.set(e.nameBytes, pos); pos += e.nameBytes.length;
      out.set(e.dataBytes, pos); pos += e.dataBytes.length;
    });
    entries.forEach(function (e) {
      w32(0x02014b50); w16(20); w16(20); w16(0); w16(0); w32(0); w32(e.crc); w32(e.compressedSize); w32(e.uncompressedSize); w16(e.nameBytes.length); w16(0); w16(0); w16(0); w16(0); w32(0); w32(e.offset);
      out.set(e.nameBytes, pos); pos += e.nameBytes.length;
    });
    w32(0x06054b50); w16(0); w16(0); w16(entries.length); w16(entries.length); w32(offset - cdStart); w32(cdStart); w16(0);
    return out;
  }

  /* ---------- OOXML helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colL(i) {
    if (i < 26) return String.fromCharCode(65 + i);
    return String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
  }
  function colRef(col, row) { return colL(col) + row; }

  /* ---------- Helpers ---------- */
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-').map(Number);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (p[2] < 10 ? '0' : '') + p[2] + ' ' + months[(p[1] || 1) - 1] + ' ' + p[0];
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function fmtMoney(n, cur) { return cur + round2(n).toFixed(2); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function addInterval(iso, freq, n) {
    var p = iso.split('-').map(Number), y = p[0], m = p[1] - 1, d = p[2];
    if (freq === 'weekly') { var dt = new Date(y, m, d + n * 7); return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
    var dt2 = new Date(y, m + n, Math.min(d, new Date(y, m + n + 1, 0).getDate()));
    return dt2.getFullYear() + '-' + pad(dt2.getMonth() + 1) + '-' + pad(dt2.getDate());
  }
  function installmentsOf(c) {
    var plan = c.plan;
    if (plan.type === 'cash') return [];
    if (Array.isArray(c.installments) && c.installments.length) return c.installments.map(function (x) { return { i: x.i, due: x.due, amount: round2(x.amount) }; });
    var list = [], remaining = round2(plan.total - (plan.down || 0)), per = round2(plan.amountPerInstallment);
    for (var i = 1; i <= plan.count; i++) list.push({ i: i, due: addInterval(plan.startDate, plan.frequency, i), amount: per });
    var sum = list.reduce(function (s, x) { return s + x.amount; }, 0);
    if (list.length && Math.abs(remaining - sum) > 0.001) list[list.length - 1].amount = round2(list[list.length - 1].amount + (remaining - sum));
    return list;
  }
  function instDiscount(it, c) {
    var insts = installmentsOf(c), totalBase = insts.reduce(function (s, x) { return s + x.amount; }, 0);
    var specific = (c.discounts || []).filter(function (d) { return d.instNum === it.i; }).reduce(function (s, d) { return s + d.amount; }, 0);
    var allTotal = (c.discounts || []).filter(function (d) { return d.instNum === 0; }).reduce(function (s, d) { return s + d.amount; }, 0);
    return round2(specific + (totalBase > 0 ? allTotal * (it.amount / totalBase) : 0));
  }
  function effectiveInstAmount(it, c) { return round2(Math.max(0, it.amount - instDiscount(it, c))); }
  function effectiveInstallments(c) { return installmentsOf(c).map(function (it) { return { i: it.i, due: it.due, amount: effectiveInstAmount(it, c), original: it.amount }; }); }
  function paidOf(c) { return (c.payments || []).reduce(function (s, p) { return s + p.amount; }, 0); }
  function totalDiscount(c) { return round2((c.discounts || []).reduce(function (s, d) { return s + d.amount; }, 0)); }
  function balanceOf(c) { return Math.max(0, round2(c.plan.total - totalDiscount(c) - paidOf(c))); }
  function weekdayOf(iso) {
    if (!iso) return '';
    var parts = iso.split('-').map(Number);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1).getDay()];
  }
  function instStatus(it, c) {
    var insts = effectiveInstallments(c), pays = (c.payments || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date) || a.id - b.id; });
    var notePaid = {}, manualTotal = 0;
    pays.forEach(function (p) {
      if (p.note && p.note.indexOf('Installment #') === 0) { var n = parseInt(p.note.slice(13), 10); if (n) notePaid[n] = (notePaid[n] || 0) + p.amount; }
      else manualTotal += p.amount;
    });
    var target = it.amount, covered = 0, manualUsed = 0;
    for (var k = 0; k < insts.length; k++) {
      var x = insts[k], noteCov = Math.min(x.amount, notePaid[x.i] || 0), needManual = Math.max(0, x.amount - noteCov), manualCov = Math.min(needManual, Math.max(0, manualTotal - manualUsed));
      manualUsed += manualCov;
      if (x.i === it.i) { target = x.amount; covered = noteCov + manualCov; break; }
    }
    var today = new Date().toISOString().slice(0, 10);
    return { covered: round2(covered), remaining: round2(target - covered), status: covered >= target - 0.005 ? 'Paid' : (it.due < today ? 'Overdue' : (it.due === today ? 'Due Today' : 'Upcoming')) };
  }
  function customerStatus(c) {
    if (c.plan.type === 'cash') return 'Cash - Paid in Full';
    if (balanceOf(c) <= 0.005) return 'Completed';
    var insts = installmentsOf(c);
    for (var i = 0; i < insts.length; i++) { if (instStatus(insts[i], c).status === 'Overdue') return 'Active - Overdue'; }
    return 'Active';
  }

  /* ---------- Style IDs ----------
     0 = normal
     1 = header (bold, gold bg, white text, border)
     2 = number right-aligned
     3 = money (currency format)
     4 = section title (bold, dark bg, white text)
     5 = paid (green bg)
     6 = overdue (red bg)
     7 = alt row (light gold)
     8 = bold normal
     9 = date (centered)
  ---------------------------------------------------------- */
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0.00"/>
    <numFmt numFmtId="165" formatCode="DD MMM YYYY"/>
  </numFmts>
  <fonts count="6">
    <font><sz val="11"/><name val="Calibri"/><color theme="1"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="12"/><name val="Calibri"/><color rgb="FF1A1005"/></font>
    <font><sz val="11"/><name val="Calibri"/><color rgb="FF1A1005"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1A6B1A"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF8B1A1A"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFB8860B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1A1A1A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD4F0D4"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFD4D4"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF5EDD0"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFB8860B"/></left>
      <right style="thin"><color rgb="FFB8860B"/></right>
      <top style="thin"><color rgb="FFB8860B"/></top>
      <bottom style="thin"><color rgb="FFB8860B"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFDDDDDD"/></left>
      <right style="thin"><color rgb="FFDDDDDD"/></right>
      <top style="thin"><color rgb="FFDDDDDD"/></top>
      <bottom style="thin"><color rgb="FFDDDDDD"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="10">
    <xf fontId="3" borderId="2" applyFont="1" applyBorder="1"/>
    <xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="3" borderId="2" applyNumberFormat="1" applyFont="1" applyBorder="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="164" fontId="3" borderId="2" applyNumberFormat="1" applyFont="1" applyBorder="1"><alignment horizontal="right"/></xf>
    <xf fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf fontId="4" fillId="4" borderId="2" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>
    <xf fontId="5" fillId="5" borderId="2" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf>
    <xf fontId="3" fillId="6" borderId="2" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf fontId="2" borderId="2" applyFont="1" applyBorder="1"/>
    <xf fontId="3" borderId="2" applyFont="1" applyBorder="1"><alignment horizontal="center"/></xf>
  </cellXfs>
</styleSheet>`;

  /* ---------- Build xlsx ---------- */
  function buildXlsx(data, settings) {
    var cur = (settings && settings.currency) || '$';
    var bizName = (settings && settings.businessName) || 'MHD ABO SALEM';
    var strings = [], strIdx = {};
    function addStr(s) {
      var key = String(s == null ? '' : s);
      if (strIdx[key] !== undefined) return strIdx[key];
      var idx = strings.length; strings.push(key); strIdx[key] = idx; return idx;
    }

    /* ---- Cell builders ---- */
    function sCell(col, row, si, style) { return '<c r="' + colRef(col, row) + '" t="s" s="' + (style || 0) + '"><v>' + si + '</v></c>'; }
    function nCell(col, row, val, style) { return '<c r="' + colRef(col, row) + '" s="' + (style || 0) + '"><v>' + val + '</v></c>'; }
    function eCell(col, row) { return '<c r="' + colRef(col, row) + '"/>'; }

    /* ---- Sheet builder ---- */
    function buildSheet(rows, opts) {
      opts = opts || {};
      var sheet = '<?xml version="1.0" encoding="UTF-8"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
      if (opts.freeze) sheet += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + opts.freeze + '" topLeftCell="A' + (opts.freeze + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
      if (opts.colWidths) {
        sheet += '<cols>';
        opts.colWidths.forEach(function (w, i) { sheet += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; });
        sheet += '</cols>';
      }
      sheet += '<sheetData>';
      rows.forEach(function (row, ri) {
        var rowH = (row._height) ? ' ht="' + row._height + '" customHeight="1"' : '';
        sheet += '<row r="' + (ri + 1) + '"' + rowH + '>';
        var cells = Array.isArray(row) ? row : row.cells;
        cells.forEach(function (cell, ci) {
          if (cell === null || cell === undefined || cell === '') { sheet += eCell(ci, ri + 1); return; }
          if (typeof cell === 'object' && cell.v !== undefined) {
            if (typeof cell.v === 'number') sheet += nCell(ci, ri + 1, cell.v, cell.s || 0);
            else sheet += sCell(ci, ri + 1, addStr(String(cell.v)), cell.s || 0);
          } else if (typeof cell === 'number') {
            sheet += nCell(ci, ri + 1, cell, 0);
          } else {
            sheet += sCell(ci, ri + 1, addStr(String(cell)), 0);
          }
        });
        sheet += '</row>';
      });
      sheet += '</sheetData>';
      if (opts.autoFilter) sheet += '<autoFilter ref="' + opts.autoFilter + '"/>';
      sheet += '</worksheet>';
      return sheet;
    }

    /* H = header cell, S = section header cell, N = number cell, M = money cell, P = paid cell, O = overdue cell, B = bold cell, C = centered cell */
    function H(v) { return { v: v, s: 1 }; }
    function SEC(v) { return { v: v, s: 4 }; }
    function N(v) { return { v: v, s: 2 }; }
    function M(v) { return typeof v === 'number' ? { v: v, s: 3 } : { v: v, s: 0 }; }
    function P(v) { return { v: v, s: 5 }; }
    function OV(v) { return { v: v, s: 6 }; }
    function B(v) { return { v: v, s: 8 }; }
    function C(v) { return { v: v, s: 9 }; }
    function statusCell(st, v) {
      if (st === 'Paid') return P(v);
      if (st === 'Overdue') return OV(v);
      return C(v);
    }

    /* ============================================================
       SHEET 1: Summary
    ============================================================ */
    var today = new Date().toISOString().slice(0, 10);
    var sumRows = [];
    sumRows.push([H('ID'), H('Customer Name'), H('Category'), H('Type'), H('Total'), H('Down'), H('Per Installment'), H('Freq'), H('Count'), H('Start Date'), H('Total Paid'), H('Balance'), H('Status'), H('Notes')]);
    data.customers.forEach(function (c) {
      var paid = paidOf(c), bal = balanceOf(c), st = customerStatus(c);
      var stCell = st.indexOf('Overdue') >= 0 ? OV(st) : (st === 'Completed' || st.indexOf('Cash') >= 0 ? P(st) : { v: st, s: 0 });
      sumRows.push([
        C(c.id), B(c.name), C(c.cat || 'gold'),
        C(c.plan.type === 'cash' ? 'Cash' : 'Installments'),
        M(c.plan.total), M(c.plan.down || 0),
        c.plan.type === 'cash' ? C('—') : M(c.plan.amountPerInstallment),
        C(c.plan.type === 'cash' ? '—' : (c.plan.frequency === 'weekly' ? 'Weekly' : 'Monthly')),
        C(c.plan.type === 'cash' ? 1 : c.plan.count),
        C(fmtDate(c.plan.startDate)),
        M(paid), M(bal),
        stCell, { v: c.notes || '', s: 0 }
      ]);
    });

    /* ============================================================
       SHEET 2: All Payments
    ============================================================ */
    var payRows = [];
    payRows.push([H('Customer ID'), H('Customer Name'), H('Payment Date'), H('Amount'), H('Note'), H('Running Total per Customer')]);
    data.customers.forEach(function (c) {
      var run = 0;
      (c.payments || []).forEach(function (p) {
        run += p.amount;
        payRows.push([C(c.id), B(c.name), C(fmtDate(p.date)), M(p.amount), { v: p.note || 'Payment', s: 0 }, M(run)]);
      });
    });

    /* ============================================================
       SHEET 3: All Installments
    ============================================================ */
    var instRows = [];
    instRows.push([H('Customer ID'), H('Customer Name'), H('Inst #'), H('Due Date'), H('Day'), H('Amount'), H('Discount'), H('Paid'), H('Remaining'), H('Status')]);
    data.customers.forEach(function (c) {
      if (c.plan.type === 'cash') return;
      var insts = effectiveInstallments(c);
      insts.forEach(function (it) {
        var s = instStatus(it, c), disc = instDiscount(it, c);
        instRows.push([
          C(c.id), B(c.name), C(it.i), C(fmtDate(it.due)), C(weekdayOf(it.due)),
          M(it.amount), disc > 0 ? M(disc) : C('—'),
          M(s.covered), M(s.remaining),
          statusCell(s.status, s.status)
        ]);
      });
    });

    /* ============================================================
       Per-customer sheets
    ============================================================ */
    var custSheets = [];
    data.customers.forEach(function (c) {
      var rows = [];
      var uTotal = (c.boxTotal != null && c.boxTotal !== '') ? c.boxTotal : c.plan.total;
      var uPaid = (c.boxPaid != null && c.boxPaid !== '') ? c.boxPaid : paidOf(c);
      var uRemaining = (c.boxRemaining != null && c.boxRemaining !== '') ? c.boxRemaining : balanceOf(c);

      /* Info header */
      rows.push([SEC(bizName + ' — Customer Statement')]);
      rows.push([B('Customer:'), B(c.name), '', B('ID:'), C(c.id)]);
      rows.push([B('Date:'), C(fmtDate(today)), '', B('Status:'), { v: customerStatus(c), s: 0 }]);
      rows.push([B('Category:'), C(c.cat || 'gold'), '', B('Notes:'), { v: c.notes || '', s: 0 }]);
      rows.push([]);
      /* Summary boxes */
      rows.push([SEC('FINANCIAL SUMMARY')]);
      rows.push([H('Car Total'), H('Cash Paid'), H('Remaining'), '', H('Plan Total'), H('Down Payment'), H('Per Installment'), H('Frequency'), H('Count')]);
      rows.push([
        M(uTotal), M(uPaid), M(uRemaining), '',
        M(c.plan.total), M(c.plan.down || 0),
        c.plan.type === 'cash' ? C('Cash') : M(c.plan.amountPerInstallment),
        C(c.plan.type === 'cash' ? '—' : (c.plan.frequency === 'weekly' ? 'Weekly' : 'Monthly')),
        C(c.plan.type === 'cash' ? 1 : c.plan.count)
      ]);
      rows.push([]);
      /* Installment schedule */
      rows.push([SEC('INSTALLMENT SCHEDULE')]);
      if (c.plan.type === 'cash') {
        rows.push([H('#'), H('Date'), H('Amount'), H('Status')]);
        rows.push([C(1), C(fmtDate(c.plan.startDate)), M(c.plan.total), P('Paid (Cash)')]);
      } else {
        rows.push([H('#'), H('Due Date'), H('Day'), H('Amount'), H('Discount'), H('Paid'), H('Remaining'), H('Status')]);
        var insts = effectiveInstallments(c);
        insts.forEach(function (it) {
          var s = instStatus(it, c), disc = instDiscount(it, c);
          rows.push([C(it.i), C(fmtDate(it.due)), C(weekdayOf(it.due)), M(it.amount), disc > 0 ? M(disc) : C('—'), M(s.covered), M(s.remaining), statusCell(s.status, s.status)]);
        });
      }
      rows.push([]);
      /* Discounts */
      rows.push([SEC('DISCOUNTS')]);
      rows.push([H('Date'), H('Applied To'), H('Amount')]);
      if (!(c.discounts || []).length) {
        rows.push([C('—'), C('No discounts'), C('—')]);
      } else {
        (c.discounts || []).forEach(function (d) {
          rows.push([C(fmtDate(d.date)), C(d.instNum === 0 ? 'All installments' : 'Installment #' + d.instNum), M(d.amount)]);
        });
      }
      rows.push([]);
      /* Payment history */
      rows.push([SEC('PAYMENT HISTORY')]);
      rows.push([H('Date'), H('Note'), H('Amount'), H('Running Total')]);
      var run = 0;
      if (!(c.payments || []).length) {
        rows.push([C('—'), C('No payments yet'), C('—'), C('—')]);
      } else {
        (c.payments || []).forEach(function (p) {
          run += p.amount;
          rows.push([C(fmtDate(p.date)), { v: p.note || 'Payment', s: 0 }, M(p.amount), M(run)]);
        });
      }

      custSheets.push({
        name: (c.name || 'Customer').substring(0, 31).replace(/[\x5c\x2f\x2a\x3f\x5b\x5d\x3a]/g, '_'),
        rows: rows
      });
    });

    /* --- Register all strings --- */
    function regRow(row) {
      var cells = Array.isArray(row) ? row : (row.cells || []);
      cells.forEach(function (cell) {
        if (!cell) return;
        var v = (typeof cell === 'object' && cell.v !== undefined) ? cell.v : cell;
        if (typeof v === 'string') addStr(v);
      });
    }
    sumRows.forEach(regRow);
    payRows.forEach(regRow);
    instRows.forEach(regRow);
    custSheets.forEach(function (cs) { cs.rows.forEach(regRow); });

    /* --- Assemble xlsx files --- */
    var allSheets = [
      { name: 'Summary', rows: sumRows, colWidths: [6, 26, 10, 14, 14, 12, 16, 10, 8, 14, 14, 14, 18, 28], freeze: 1, autoFilter: 'A1:N1' },
      { name: 'All Payments', rows: payRows, colWidths: [10, 24, 14, 14, 32, 16], freeze: 1, autoFilter: 'A1:F1' },
      { name: 'All Installments', rows: instRows, colWidths: [10, 24, 6, 14, 8, 12, 10, 12, 12, 12], freeze: 1, autoFilter: 'A1:J1' }
    ].concat(custSheets.map(function (cs) { return { name: cs.name, rows: cs.rows, colWidths: [14, 28, 10, 14, 14, 14, 14, 14, 14] }; }));

    var files = [];

    /* Content Types */
    var ctOverrides = allSheets.map(function (_, i) {
      return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }).join('');
    files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      ctOverrides + '</Types>' });

    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' });

    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + allSheets.map(function (s, i) { return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' });

    var wbRels = allSheets.map(function (_, i) {
      return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }).join('') +
      '<Relationship Id="rId' + (allSheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '<Relationship Id="rId' + (allSheets.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbRels + '</Relationships>' });

    var ss = '<?xml version="1.0" encoding="UTF-8"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + strings.length + '" uniqueCount="' + strings.length + '">';
    strings.forEach(function (s) { ss += '<si><t xml:space="preserve">' + esc(s) + '</t></si>'; });
    ss += '</sst>';
    files.push({ name: 'xl/sharedStrings.xml', data: ss });
    files.push({ name: 'xl/styles.xml', data: STYLES_XML });

    allSheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: buildSheet(s.rows, { colWidths: s.colWidths, freeze: s.freeze, autoFilter: s.autoFilter }) });
    });

    return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function exportAll(data, settings) {
    var biz = (settings && settings.businessName) || 'ledger';
    var today = new Date().toISOString().slice(0, 10);
    download(biz.replace(/\s+/g, '_') + '_' + today + '.xlsx', buildXlsx(data, settings));
  }

  return { exportAll: exportAll };
})();
