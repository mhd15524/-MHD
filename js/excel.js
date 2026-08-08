'use strict';

/* ============================================================
   Excel — export all customer & installment data as .xlsx
   (multi-sheet: Summary + one tab per customer)
   Pure-JS ZIP + OOXML — no dependencies.
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

  /* ---------- Minimal ZIP (STORE method, no compression) ---------- */
  function zip(files) {
    let offset = 0;
    const entries = [];
    const encoder = new TextEncoder();

    files.forEach(function (f) {
      const nameBytes = encoder.encode(f.name);
      const dataBytes = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
      const crc = crc32(dataBytes);

      /* local file header */
      const header = new Uint8Array(30 + nameBytes.length);
      const hv = new DataView(header.buffer);
      hv.setUint32(0, 0x04034b50, true);   /* signature */
      hv.setUint16(4, 20, true);            /* version needed */
      hv.setUint16(6, 0, true);             /* flags */
      hv.setUint16(8, 0, true);             /* method: stored */
      hv.setUint32(14, crc, true);
      hv.setUint32(18, dataBytes.length, true);
      hv.setUint32(22, dataBytes.length, true);
      hv.setUint16(26, nameBytes.length, true);
      header.set(nameBytes, 30);

      entries.push({ nameBytes: nameBytes, dataBytes: dataBytes, crc: crc, offset: offset, compressedSize: dataBytes.length, uncompressedSize: dataBytes.length });
      offset += header.length + dataBytes.length;
    });

    /* central directory */
    const cdStart = offset;
    entries.forEach(function (e) {
      const cd = new Uint8Array(46 + e.nameBytes.length);
      const dv = new DataView(cd.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.compressedSize, true);
      dv.setUint32(24, e.uncompressedSize, true);
      dv.setUint16(28, e.nameBytes.length, true);
      dv.setUint32(42, e.offset, true);
      cd.set(e.nameBytes, 46);
      offset += cd.length;
    });

    /* end of central directory */
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, offset - cdStart, true);
    ev.setUint32(16, cdStart, true);

    /* assemble */
    const total = offset + eocd.length;
    const out = new Uint8Array(total);
    let pos = 0;
    entries.forEach(function (e) {
      const hdr = new Uint8Array(30 + e.nameBytes.length);
      const hv2 = new DataView(hdr.buffer);
      hv2.setUint32(0, 0x04034b50, true);
      hv2.setUint16(4, 20, true);
      hv2.setUint16(6, 0, true);
      hv2.setUint16(8, 0, true);
      hv2.setUint32(14, e.crc, true);
      hv2.setUint32(18, e.compressedSize, true);
      hv2.setUint32(22, e.uncompressedSize, true);
      hv2.setUint16(26, e.nameBytes.length, true);
      hdr.set(e.nameBytes, 30);
      out.set(hdr, pos); pos += hdr.length;
      out.set(e.dataBytes, pos); pos += e.dataBytes.length;
    });
    /* central directory */
    entries.forEach(function (e) {
      const cd = new Uint8Array(46 + e.nameBytes.length);
      const dv = new DataView(cd.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.compressedSize, true);
      dv.setUint32(24, e.uncompressedSize, true);
      dv.setUint16(28, e.nameBytes.length, true);
      dv.setUint32(42, e.offset, true);
      cd.set(e.nameBytes, 46);
      out.set(cd, pos); pos += cd.length;
    });
    out.set(eocd, pos);
    return out;
  }

  /* ---------- OOXML helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colL(i) { return String.fromCharCode(65 + (i % 26)); }
  function colRef(col, row) { return colL(col) + row; }
  function sCell(col, row, si) {
    return '<c r="' + colRef(col, row) + '" t="s"><v>' + si + '</v></c>';
  }
  function nCell(col, row, val) {
    return '<c r="' + colRef(col, row) + '"><v>' + val + '</v></c>';
  }

  /* ---------- date formatter ---------- */
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-').map(Number);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (p[2] < 10 ? '0' : '') + p[2] + ' ' + months[(p[1] || 1) - 1] + ' ' + p[0];
  }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function fmtMoney(n, cur) { return cur + round2(n).toFixed(2); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* ---------- Installments ---------- */
  function addInterval(iso, freq, n) {
    var p = iso.split('-').map(Number);
    var y = p[0], m = p[1] - 1, d = p[2];
    if (freq === 'weekly') { var dt = new Date(y, m, d + n * 7); return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
    var dt2 = new Date(y, m + n, Math.min(d, new Date(y, m + n + 1, 0).getDate()));
    return dt2.getFullYear() + '-' + pad(dt2.getMonth() + 1) + '-' + pad(dt2.getDate());
  }
  function installmentsOf(c) {
    var plan = c.plan;
    if (plan.type === 'cash') return [];
    if (Array.isArray(c.installments) && c.installments.length) {
      return c.installments.map(function (x) { return { i: x.i, due: x.due, amount: round2(x.amount) }; });
    }
    var list = [];
    var remaining = round2(plan.total - (plan.down || 0));
    var per = round2(plan.amountPerInstallment);
    for (var i = 1; i <= plan.count; i++) list.push({ i: i, due: addInterval(plan.startDate, plan.frequency, i), amount: per });
    var sum = list.reduce(function (s, x) { return s + x.amount; }, 0);
    if (list.length && Math.abs(remaining - sum) > 0.001) {
      list[list.length - 1].amount = round2(list[list.length - 1].amount + (remaining - sum));
    }
    return list;
  }
  function instStatus(it, c) {
    var insts = effectiveInstallments(c);
    var pays = (c.payments || []).slice().sort(function (a, b) { return a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date); });
    var notePaid = {};
    var manualTotal = 0;
    pays.forEach(function (p) {
      if (p.note && p.note.indexOf('Installment #') === 0) {
        var n = parseInt(p.note.slice('Installment #'.length), 10);
        if (n) notePaid[n] = (notePaid[n] || 0) + p.amount;
      } else {
        manualTotal += p.amount;
      }
    });
    var target = it.amount, covered = 0, manualUsed = 0;
    for (var k = 0; k < insts.length; k++) {
      var x = insts[k];
      var noteCov = Math.min(x.amount, notePaid[x.i] || 0);
      var needManual = Math.max(0, x.amount - noteCov);
      var manualCov = Math.min(needManual, Math.max(0, manualTotal - manualUsed));
      manualUsed += manualCov;
      if (x.i === it.i) { target = x.amount; covered = noteCov + manualCov; break; }
    }
    var today = new Date().toISOString().slice(0, 10);
    var status = covered >= target - 0.005 ? 'Paid' : (it.due < today ? 'Overdue' : (it.due === today ? 'Due Today' : 'Upcoming'));
    return { covered: round2(covered), remaining: round2(target - covered), status: status };
  }
  function instPaymentDetail(it, c) {
    var pays = (c.payments || []).slice().sort(function (a, b) { return a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date); });
    var insts = effectiveInstallments(c);
    var instAmt = it.amount;
    var matched = pays.filter(function (p) { return p.note === 'Installment #' + it.i; });
    if (matched.length) {
      var mTot = 0;
      for (var m = 0; m < matched.length; m++) {
        mTot += matched[m].amount;
        if (mTot >= instAmt - 0.005) {
          return { date: matched[m].date, paidAmount: instAmt, remainingAfter: 0 };
        }
      }
    }
    var cumBefore = 0, found = false;
    for (var k = 0; k < insts.length; k++) {
      if (insts[k].i === it.i) { found = true; break; }
      cumBefore += insts[k].amount;
    }
    if (!found) return { date: '', paidAmount: 0, remainingAfter: it.amount };
    var target = cumBefore + it.amount;
    var totalPaid = 0;
    for (var i = 0; i < pays.length; i++) {
      totalPaid += pays[i].amount;
      if (totalPaid >= target - 0.005) {
        return { date: pays[i].date, paidAmount: it.amount, remainingAfter: 0 };
      }
    }
    var applied = Math.max(0, Math.min(it.amount, totalPaid - cumBefore));
    return { date: '', paidAmount: round2(applied), remainingAfter: round2(it.amount - applied) };
  }
  function paidOf(c) { return (c.payments || []).reduce(function (s, p) { return s + p.amount; }, 0); }
  function discountsOf(c) { return (c.discounts || []).slice(); }
  function totalDiscount(c) { return round2(discountsOf(c).reduce(function (s, d) { return s + d.amount; }, 0)); }
  function balanceOf(c) { return Math.max(0, round2(c.plan.total - totalDiscount(c) - paidOf(c))); }
  function instDiscount(it, c) {
    var insts = installmentsOf(c);
    var totalBase = insts.reduce(function (s, x) { return s + x.amount; }, 0);
    var specific = discountsOf(c).filter(function (d) { return d.instNum === it.i; }).reduce(function (s, d) { return s + d.amount; }, 0);
    var allTotal = discountsOf(c).filter(function (d) { return d.instNum === 0; }).reduce(function (s, d) { return s + d.amount; }, 0);
    var share = totalBase > 0 ? allTotal * (it.amount / totalBase) : 0;
    return round2(specific + share);
  }
  function effectiveInstAmount(it, c) { return round2(Math.max(0, it.amount - instDiscount(it, c))); }
  function effectiveInstallments(c) {
    return installmentsOf(c).map(function (it) {
      return { i: it.i, due: it.due, amount: effectiveInstAmount(it, c), original: it.amount };
    });
  }
  function weekdayOf(iso) {
    if (!iso) return '';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var parts = iso.split('-').map(Number);
    return days[new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1).getDay()];
  }
  function customerStatus(c) {
    if (c.plan.type === 'cash') return 'Paid in full (Cash)';
    if (balanceOf(c) <= 0.005) return 'Completed';
    var insts = installmentsOf(c);
    var hasOverdue = false;
    for (var i = 0; i < insts.length; i++) { var s = instStatus(insts[i], c); if (s.status === 'Overdue') { hasOverdue = true; break; } }
    return hasOverdue ? 'Active - Overdue' : 'Active';
  }

  /* ---------- Build xlsx ---------- */
  function buildXlsx(data, settings) {
    var cur = (settings && settings.currency) || '$';
    var strings = [];
    var strIdx = {};

    function addStr(s) {
      var key = String(s);
      if (strIdx[key] !== undefined) return strIdx[key];
      var idx = strings.length;
      strings.push(key);
      strIdx[key] = idx;
      return idx;
    }

    /* --- Summary sheet rows --- */
    var sumRows = [];
    sumRows.push(['ID', 'Name', 'Plan Type', 'Total Amount', 'Down Payment', 'Per Installment', 'Frequency', 'Installments', 'Start Date', 'Total Paid', 'Balance Due', 'Status', 'Notes']);
    data.customers.forEach(function (c) {
      var paid = paidOf(c);
      var bal = balanceOf(c);
      var status = customerStatus(c);
      sumRows.push([
        c.id, c.name, c.plan.type === 'cash' ? 'Cash' : 'Installments',
        c.plan.total, c.plan.down,
        c.plan.type === 'cash' ? '' : c.plan.amountPerInstallment,
        c.plan.type === 'cash' ? '' : c.plan.frequency,
        c.plan.type === 'cash' ? 1 : c.plan.count,
        c.plan.startDate, paid, bal, status, c.notes || ''
      ]);
    });

    /* --- Per-customer sheets --- */
    var custSheets = [];
    data.customers.forEach(function (c) {
      var rows = [];
      var uTotal = (c.boxTotal != null && c.boxTotal !== '') ? c.boxTotal : c.plan.total;
      var uPaid = (c.boxPaid != null && c.boxPaid !== '') ? c.boxPaid : paidOf(c);
      var uRemaining = (c.boxRemaining != null && c.boxRemaining !== '') ? c.boxRemaining : balanceOf(c);
      rows.push(['Customer', c.name]);
      rows.push(['Car Total', fmtMoney(uTotal, cur)]);
      rows.push(['Cash Paid', fmtMoney(uPaid, cur)]);
      rows.push(['Remaining', fmtMoney(uRemaining, cur)]);
      rows.push(['Plan Type', c.plan.type === 'cash' ? 'Cash' : 'Installments']);
      rows.push(['Total Amount', fmtMoney(c.plan.total, cur)]);
      rows.push(['Down Payment', fmtMoney(c.plan.down, cur)]);
      rows.push(['Per Installment', c.plan.type === 'cash' ? '—' : fmtMoney(c.plan.amountPerInstallment, cur)]);
      rows.push(['Frequency', c.plan.type === 'cash' ? '—' : (c.plan.frequency === 'weekly' ? 'Weekly' : 'Monthly')]);
      rows.push(['Installments', c.plan.type === 'cash' ? '1' : String(c.plan.count)]);
      rows.push(['Start Date', c.plan.startDate]);
      rows.push(['Status', customerStatus(c)]);
      rows.push([]);
      rows.push(['Installment Schedule']);
      rows.push(['#', 'Due Date', 'Day', 'Amount', 'Discount', 'Paid', 'Status', 'Paid Detail']);
      var insts = effectiveInstallments(c);
      insts.forEach(function (it) {
        var s = instStatus(it, c);
        var disc = instDiscount(it, c);
        var detail = '';
        if (s.status === 'Paid') {
          var pd = instPaymentDetail(it, c);
          detail = 'Paid ' + (pd.date || '') + ' ' + fmtMoney(pd.paidAmount, cur) + ' rem ' + fmtMoney(pd.remainingAfter, cur);
        }
        rows.push([it.i, it.due, weekdayOf(it.due), fmtMoney(it.amount, cur), disc > 0 ? fmtMoney(disc, cur) : '', fmtMoney(s.covered, cur), s.status, detail]);
      });
      rows.push([]);
      rows.push(['Discounts']);
      rows.push(['Date', 'Applied to', 'Amount']);
      if ((c.discounts || []).length === 0) {
        rows.push(['', '', '']);
      } else {
        (c.discounts || []).forEach(function (d) {
          rows.push([d.date, d.instNum === 0 ? 'All installments' : 'Installment #' + d.instNum, fmtMoney(d.amount, cur)]);
        });
      }
      rows.push([]);
      rows.push(['Payment History']);
      rows.push(['Date', 'Note', 'Amount']);
      var run = 0;
      (c.payments || []).forEach(function (p) {
        run += p.amount;
        rows.push([p.date, p.note || 'Payment', fmtMoney(p.amount, cur)]);
      });
      custSheets.push({ name: (c.name || 'Customer').substring(0, 31).replace(/[\x5c\x2f\x2a\x3f\x5b\x5d\x3a]/g, '_'), rows: rows });
    });

    /* --- Shared strings --- */
    sumRows.forEach(function (row) { row.forEach(function (cell) { if (typeof cell === 'string') addStr(cell); }); });
    custSheets.forEach(function (cs) { cs.rows.forEach(function (row) { row.forEach(function (cell) { if (typeof cell === 'string') addStr(cell); }); }); });

    /* --- Build sheet XML --- */
    function buildSheet(rows, opts) {
      opts = opts || {};
      var headerRows = opts.headerRows || 1;
      var sheet = '<?xml version="1.0" encoding="UTF-8"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
      if (opts.colWidths) {
        sheet += '<cols>';
        opts.colWidths.forEach(function (w, i) {
          sheet += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
        });
        sheet += '</cols>';
      }
      sheet += '<sheetData>';
      rows.forEach(function (row, ri) {
        sheet += '<row r="' + (ri + 1) + '">';
        row.forEach(function (cell, ci) {
          if (cell === '' || cell == null) { sheet += '<c r="' + colRef(ci, ri + 1) + '"/>'; return; }
          var sty = ri < headerRows ? '1' : '0';
          if (typeof cell === 'number') {
            sheet += '<c r="' + colRef(ci, ri + 1) + '" s="' + (ri < headerRows ? '1' : '2') + '"><v>' + cell + '</v></c>';
          } else {
            sheet += '<c r="' + colRef(ci, ri + 1) + '" t="s" s="' + sty + '"><v>' + addStr(String(cell)) + '</v></c>';
          }
        });
        sheet += '</row>';
      });
      sheet += '</sheetData></worksheet>';
      return sheet;
    }

    var files = [];
    files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      custSheets.map(function (cs, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 2) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>' });

    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' });

    var sheetNames = ['Summary'].concat(custSheets.map(function (cs) { return cs.name; }));
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetNames.map(function (name, i) {
        return '<sheet name="' + esc(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>' });

    var rels = sheetNames.map(function (_, i) {
      return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }).join('') + '<Relationship Id="rId' + (sheetNames.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '<Relationship Id="rId' + (sheetNames.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>' });

    /* shared strings */
    var ss = '<?xml version="1.0" encoding="UTF-8"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + strings.length + '" uniqueCount="' + strings.length + '">';
    strings.forEach(function (s) { ss += '<si><t>' + esc(s) + '</t></si>'; });
    ss += '</sst>';
    files.push({ name: 'xl/sharedStrings.xml', data: ss });

    /* styles: s0=normal, s1=header(bold+gold bg), s2=currency number */
    files.push({ name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF221703"/><name val="Calibri"/></font><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD4A843"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A1A1A"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF2A2720"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="4"><xf/><xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf/></cellXfs></styleSheet>' });

    /* summary sheet */
    files.push({ name: 'xl/worksheets/sheet1.xml', data: buildSheet(sumRows, {
      headerRows: 1,
      colWidths: [6, 22, 14, 14, 14, 14, 12, 14, 12, 14, 14, 18, 20]
    }) });

    /* customer sheets */
    custSheets.forEach(function (cs, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 2) + '.xml', data: buildSheet(cs.rows, {
        headerRows: 1,
        colWidths: [14, 16, 14, 18, 18, 18, 18, 34]
      }) });
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
    download('installments_ledger.xlsx', buildXlsx(data, settings));
  }

  return { exportAll: exportAll };
})();
