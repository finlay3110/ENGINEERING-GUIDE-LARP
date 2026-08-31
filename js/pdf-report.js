// ============================================================================
// UCN PDF REPORT — house style shared with the Mission Companion's exporter.
//
// The layout model is a single vertical write head: `pdfCursorY`, in mm. Every
// helper draws at the cursor and advances it. Nothing here measures a whole
// page ahead of time; call pdfEnsureSpace before a block that must not split.
//
// The table of contents uses reserve-and-backfill: page 2 is added blank up
// front, every section records the page it started on, and the TOC is written
// onto page 2 at the very end. That gets correct page numbers from one pass.
// ============================================================================

// ------------------------------------------------------------- palette -----
const NAVY = [27, 42, 94];
const ORANGE = [221, 122, 43];
const TEXT = [22, 32, 74];
const MUTED = [140, 152, 191];
const LINE = [222, 226, 240];
const WHITE = [255, 255, 255];

// ------------------------------------------------------------ geometry -----
const PAGE = { w: 210, h: 297 };
const MARGIN = { left: 18, right: 18, top: 24, bottom: 20 };
const CONTENT_W = PAGE.w - MARGIN.left - MARGIN.right; // 174

// The vertical write head. Module-level by design.
let pdfCursorY = MARGIN.top;

// --------------------------------------------------------------- fonts -----
let fontsRegistered = false;

function pdfBodyFont() {
  return fontsRegistered ? 'Exo2' : 'helvetica';
}

function pdfHeadingFont() {
  return fontsRegistered ? 'Orbitron' : 'helvetica';
}

/** Base64 of a fetched binary, chunked so large fonts do not blow the stack. */
async function fetchBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch failed: ' + url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Register Exo 2 and Orbitron into jsPDF's virtual file system.
 *
 * The house spec inlines these as base64 string literals. Here they are
 * fetched from the fonts the site already serves and converted at export
 * time: identical bytes in the PDF, without adding ~600KB of base64 to a page
 * that gets opened on phone data. A failure falls back to helvetica rather
 * than breaking the export.
 */
async function registerFonts(doc) {
  fontsRegistered = false;
  const faces = [
    ['fonts/Exo2-Regular.ttf', 'Exo2-Regular.ttf', 'Exo2', 'normal'],
    ['fonts/Exo2-Bold.ttf', 'Exo2-Bold.ttf', 'Exo2', 'bold'],
    ['fonts/Exo2-Italic.ttf', 'Exo2-Italic.ttf', 'Exo2', 'italic'],
    ['fonts/Orbitron-Bold.ttf', 'Orbitron-Bold.ttf', 'Orbitron', 'bold'],
  ];
  try {
    for (const [url, vfsName, family, style] of faces) {
      doc.addFileToVFS(vfsName, await fetchBase64(url));
      doc.addFont(vfsName, family, style);
    }
    fontsRegistered = true;
  } catch {
    fontsRegistered = false;
  }
}

// ---------------------------------------------------------- primitives -----

function setFill(doc, rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setDraw(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
function setText(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

/** Trim to fit a column, with an ellipsis. Assumes the font is already set. */
function truncate(doc, text, maxWidth) {
  const s = String(text == null ? '' : text);
  if (doc.getTextWidth(s) <= maxWidth) return s;
  let cut = s;
  while (cut.length > 1 && doc.getTextWidth(cut + '…') > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + '…';
}

// ----------------------------------------------------------- structure -----

/** Navy frame, corner blocks and orange corner dots. Drawn on every page. */
function pdfDrawFrame(doc) {
  const inset = 8;
  const w = PAGE.w - inset * 2;
  const h = PAGE.h - inset * 2;

  setDraw(doc, NAVY);
  doc.setLineWidth(0.5);
  doc.rect(inset, inset, w, h);

  const bw = 16;
  const bh = 4;
  setFill(doc, NAVY);
  doc.rect(inset, inset, bw, bh, 'F');
  doc.rect(PAGE.w - inset - bw, inset, bw, bh, 'F');
  doc.rect(inset, PAGE.h - inset - bh, bw, bh, 'F');
  doc.rect(PAGE.w - inset - bw, PAGE.h - inset - bh, bw, bh, 'F');

  setFill(doc, ORANGE);
  for (const [cx, cy] of [
    [inset, inset],
    [PAGE.w - inset, inset],
    [inset, PAGE.h - inset],
    [PAGE.w - inset, PAGE.h - inset],
  ]) {
    doc.circle(cx, cy, 1.6, 'F');
  }
}

function pdfNewPage(doc) {
  doc.addPage();
  pdfDrawFrame(doc);
  pdfCursorY = MARGIN.top;
}

function pdfEnsureSpace(doc, mm) {
  if (pdfCursorY + mm > PAGE.h - MARGIN.bottom) pdfNewPage(doc);
}

function pdfHeading(doc, text) {
  pdfEnsureSpace(doc, 14);
  doc.setFont(pdfHeadingFont(), 'bold');
  doc.setFontSize(13);
  setText(doc, NAVY);
  doc.text(String(text).toUpperCase(), MARGIN.left, pdfCursorY);
  pdfCursorY += 3.2;

  setDraw(doc, ORANGE);
  doc.setLineWidth(0.6);
  doc.line(MARGIN.left, pdfCursorY, MARGIN.left + CONTENT_W, pdfCursorY);
  pdfCursorY += 5.8;
}

function pdfSubHeading(doc, text) {
  pdfEnsureSpace(doc, 10);
  doc.setFont(pdfHeadingFont(), 'bold');
  doc.setFontSize(10.5);
  setText(doc, NAVY);
  doc.text(String(text).toUpperCase(), MARGIN.left, pdfCursorY);
  pdfCursorY += 6;
}

function pdfParagraph(doc, text, opts) {
  const o = opts || {};
  const size = o.fontSize || 10;
  const lineHeight = size * 0.5;
  const style = o.italic ? 'italic' : 'normal';

  doc.setFont(pdfBodyFont(), style);
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(String(text), CONTENT_W);

  for (const line of lines) {
    pdfEnsureSpace(doc, lineHeight);
    // Re-assert after any page break: drawing the frame changes colours.
    doc.setFont(pdfBodyFont(), style);
    doc.setFontSize(size);
    setText(doc, o.color || TEXT);
    doc.text(line, MARGIN.left, pdfCursorY);
    pdfCursorY += lineHeight;
  }
  pdfCursorY += 2;
}

function pdfEmptyState(doc, text) {
  pdfParagraph(doc, text || 'None recorded.', {
    italic: true, color: MUTED, fontSize: 9.5,
  });
}

const ROW_H = 7;

function pdfTable(doc, headers, rows, colWidths) {
  if (!rows || !rows.length) {
    pdfEmptyState(doc);
    return;
  }

  function drawHeaderBand() {
    setFill(doc, NAVY);
    doc.rect(MARGIN.left, pdfCursorY, CONTENT_W, ROW_H, 'F');
    doc.setFont(pdfBodyFont(), 'bold');
    doc.setFontSize(8);
    setText(doc, WHITE);
    let x = MARGIN.left;
    headers.forEach(function (h, i) {
      doc.text(
        truncate(doc, String(h).toUpperCase(), colWidths[i] - 5),
        x + 2.5, pdfCursorY + 4.7
      );
      x += colWidths[i];
    });
    pdfCursorY += ROW_H;
  }

  // Header plus at least one row, so a band never ends a page alone.
  pdfEnsureSpace(doc, ROW_H * 2);
  drawHeaderBand();

  rows.forEach(function (row) {
    if (pdfCursorY + ROW_H > PAGE.h - MARGIN.bottom) {
      pdfNewPage(doc);
      drawHeaderBand();
    }
    doc.setFont(pdfBodyFont(), 'normal');
    doc.setFontSize(9);
    setText(doc, TEXT);

    let x = MARGIN.left;
    row.forEach(function (cell, i) {
      doc.text(truncate(doc, cell, colWidths[i] - 5), x + 2.5, pdfCursorY + 4.7);
      x += colWidths[i];
    });
    pdfCursorY += ROW_H;

    setDraw(doc, LINE);
    doc.setLineWidth(0.1);
    doc.line(MARGIN.left, pdfCursorY, MARGIN.left + CONTENT_W, pdfCursorY);
  });

  pdfCursorY += 4;
}

function pdfBlockNote(doc, title, text) {
  doc.setFont(pdfBodyFont(), 'normal');
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(String(text), CONTENT_W - 9);
  const boxH = 10 + lines.length * 4.4;

  pdfEnsureSpace(doc, boxH + 3);

  setFill(doc, [248, 249, 252]);
  setDraw(doc, LINE);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN.left, pdfCursorY, CONTENT_W, boxH, 'FD');

  doc.setFont(pdfBodyFont(), 'bold');
  doc.setFontSize(8);
  setText(doc, NAVY);
  doc.text(String(title).toUpperCase(), MARGIN.left + 4.5, pdfCursorY + 5.5);

  doc.setFont(pdfBodyFont(), 'normal');
  doc.setFontSize(9.5);
  setText(doc, TEXT);
  let y = pdfCursorY + 10.5;
  for (const line of lines) {
    doc.text(line, MARGIN.left + 4.5, y);
    y += 4.4;
  }

  pdfCursorY += boxH + 3;
}

function pdfSectionStart(doc, title, tocEntries) {
  pdfNewPage(doc);
  tocEntries.push({ title: title, page: doc.internal.getNumberOfPages() });
  pdfHeading(doc, title);
}

function pdfDrawToc(doc, tocEntries) {
  const saved = pdfCursorY;

  doc.setPage(2);
  pdfCursorY = MARGIN.top;
  pdfHeading(doc, 'Table of Contents');

  const rightX = MARGIN.left + CONTENT_W;

  tocEntries.forEach(function (entry) {
    const y = pdfCursorY;

    doc.setFont(pdfBodyFont(), 'normal');
    doc.setFontSize(10);
    setText(doc, TEXT);
    doc.text(entry.title, MARGIN.left, y);
    const titleW = doc.getTextWidth(entry.title);

    doc.setFont(pdfBodyFont(), 'bold');
    setText(doc, NAVY);
    const label = String(entry.page);
    const labelW = doc.getTextWidth(label);
    doc.text(label, rightX - labelW, y);

    setDraw(doc, LINE);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([0.6, 1.2], 0);
    doc.line(MARGIN.left + titleW + 2, y - 1, rightX - labelW - 2, y - 1);
    doc.setLineDashPattern([], 0);

    doc.link(MARGIN.left, y - 4.5, CONTENT_W, 7, { pageNumber: entry.page });

    pdfCursorY += 9;
  });

  pdfCursorY = saved;
}

// ---------------------------------------------------------------- chart ----

/**
 * Fixed-range line chart, drawn as vector rather than an embedded bitmap.
 *
 * House rules applied here: the y-axis is pinned to yMin..yMax so two reports
 * are directly comparable, points are spaced by index because hull readings
 * are taken ad hoc and are never evenly spaced in time, only the first and
 * last x values are labelled, gridlines are LINE and the series is ORANGE.
 */
function pdfChart(doc, points, opts) {
  const o = opts || {};
  const height = o.height || 62;
  const yMin = o.yMin == null ? 0 : o.yMin;
  const yMax = o.yMax == null ? 100 : o.yMax;
  const ticks = o.ticks || [0, 25, 50, 75, 100];

  if (!points.length) {
    pdfEmptyState(doc);
    return;
  }

  pdfEnsureSpace(doc, height + 4);

  const padL = 13;
  const padR = 2;
  const padT = 3;
  const padB = 9;
  const plotX = MARGIN.left + padL;
  const plotY = pdfCursorY + padT;
  const plotW = CONTENT_W - padL - padR;
  const plotH = height - padT - padB;

  const xAt = function (i) {
    return points.length === 1
      ? plotX + plotW / 2
      : plotX + (i / (points.length - 1)) * plotW;
  };
  const yAt = function (v) {
    const clamped = Math.max(yMin, Math.min(yMax, v));
    return plotY + (1 - (clamped - yMin) / (yMax - yMin)) * plotH;
  };

  // Gridlines and y labels
  doc.setFont(pdfBodyFont(), 'normal');
  doc.setFontSize(7.5);
  for (const t of ticks) {
    const gy = yAt(t);
    setDraw(doc, LINE);
    doc.setLineWidth(0.2);
    doc.line(plotX, gy, plotX + plotW, gy);
    setText(doc, MUTED);
    const label = t + '%';
    doc.text(label, plotX - 2 - doc.getTextWidth(label), gy + 1);
  }

  // Series
  setDraw(doc, ORANGE);
  doc.setLineWidth(0.7);
  for (let i = 1; i < points.length; i++) {
    doc.line(xAt(i - 1), yAt(points[i - 1].value), xAt(i), yAt(points[i].value));
  }
  setFill(doc, ORANGE);
  const dot = points.length > 40 ? 0.5 : 0.9;
  points.forEach(function (p, i) {
    doc.circle(xAt(i), yAt(p.value), dot, 'F');
  });

  // First and last x labels only
  setText(doc, MUTED);
  doc.setFontSize(7.5);
  const baseline = pdfCursorY + height - 2;
  doc.text(points[0].label, plotX, baseline);
  if (points.length > 1) {
    const lastLabel = points[points.length - 1].label;
    doc.text(lastLabel, plotX + plotW - doc.getTextWidth(lastLabel), baseline);
  }

  // The x labels sit 2mm above the block's end, so leave enough clearance for
  // whatever follows to start on its own line rather than beside them.
  pdfCursorY += height + 6;
}

// ---------------------------------------------------------------- cover ----

async function pdfCover(doc, data, logoUrl) {
  pdfDrawFrame(doc);

  // The brand mark is white on transparent, so on a white page it needs the
  // same navy disc the app puts behind it or it would be invisible.
  const cx = PAGE.w / 2;
  const logoSize = 32;
  const discR = logoSize / 2;
  const discY = 42 + discR;
  setFill(doc, NAVY);
  doc.circle(cx, discY, discR, 'F');

  if (logoUrl) {
    try {
      const b64 = await fetchBase64(logoUrl);
      const inner = logoSize * 0.72;
      doc.addImage(
        'data:image/png;base64,' + b64, 'PNG',
        cx - inner / 2, discY - inner / 2, inner, inner,
        undefined, 'FAST'
      );
    } catch {
      // The disc alone still reads as a brand mark.
    }
  }

  doc.setFont(pdfHeadingFont(), 'bold');
  doc.setFontSize(21);
  setText(doc, NAVY);
  const title = 'ENGINEERING LOG';
  doc.text(title, cx - doc.getTextWidth(title) / 2, 84);

  doc.setFont(pdfBodyFont(), 'bold');
  doc.setFontSize(9);
  setText(doc, ORANGE);
  const subtitle = 'M I S S I O N   R E P O R T';
  doc.text(subtitle, cx - doc.getTextWidth(subtitle) / 2, 91);

  // Centred meta table: 120mm wide, 40mm navy key cells, 8.5mm rows.
  const tableW = 120;
  const keyW = 40;
  const rowH = 8.5;
  const tx = cx - tableW / 2;
  let ty = 108;

  for (const [key, value] of data.meta) {
    setFill(doc, NAVY);
    doc.rect(tx, ty, keyW, rowH, 'F');
    doc.setFont(pdfBodyFont(), 'bold');
    doc.setFontSize(8);
    setText(doc, WHITE);
    doc.text(truncate(doc, key.toUpperCase(), keyW - 5), tx + 2.5, ty + 5.6);

    setDraw(doc, LINE);
    doc.setLineWidth(0.2);
    doc.rect(tx + keyW, ty, tableW - keyW, rowH);
    doc.setFont(pdfBodyFont(), 'normal');
    doc.setFontSize(9.5);
    setText(doc, TEXT);
    doc.text(
      truncate(doc, value || '—', tableW - keyW - 5),
      tx + keyW + 2.5, ty + 5.6
    );

    ty += rowH;
  }
}

// ------------------------------------------------------------- document ----

/**
 * Build the mission report.
 *
 * `data` is the shape produced by the app's export payload, plus a `meta`
 * array of [key, value] pairs for the cover.
 */
export async function buildMissionReport(jsPDF, data, opts) {
  const o = opts || {};
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

  await registerFonts(doc);
  pdfCursorY = MARGIN.top;

  // 1. Cover.
  await pdfCover(doc, data, o.logoUrl);

  // 2. Page 2 is reserved for the table of contents and left blank for now.
  doc.addPage();
  pdfDrawFrame(doc);

  const toc = [];

  // 3. Sections.
  pdfSectionStart(doc, 'Summary', toc);
  pdfSubHeading(doc, 'Actions logged');
  pdfTable(doc, ['Action', 'Count'], data.totals, [124, 50]);
  pdfSubHeading(doc, 'OCP spares');
  pdfParagraph(doc, data.sparesLine);

  pdfSectionStart(doc, 'Hull Integrity', toc);
  if (data.hullPoints.length) {
    pdfParagraph(doc, data.hullSummary);
    pdfChart(doc, data.hullPoints, { height: 62, yMin: 0, yMax: 100 });
    pdfSubHeading(doc, 'Readings');
    pdfTable(doc, ['Time', 'Integrity'], data.hullRows, [124, 50]);
  } else {
    pdfEmptyState(doc);
  }

  pdfSectionStart(doc, 'Action Log', toc);
  // Action needs 38mm: "Power cell swapped" is the longest label and truncated
  // at 34. Detail gives up the difference and still truncates the longest
  // location strings — the full text is in the JSON export.
  pdfTable(
    doc,
    ['Started', 'Ended', 'Action', 'Detail', 'Duration'],
    data.logRows,
    [22, 22, 38, 70, 22]
  );

  pdfSectionStart(doc, 'Notes', toc);
  if (data.notes.length) {
    for (const note of data.notes) pdfBlockNote(doc, note.title, note.text);
  } else {
    pdfEmptyState(doc);
  }

  // 4. Backfill the reserved page.
  pdfDrawToc(doc, toc);

  return doc;
}
