/**
 * parser.js — v2
 * PDF loading, page extraction, and Arabic text repair.
 *
 * Arabic-textbook parsing strategy (best practices):
 *
 *  1. Collect every text item with its exact (x, y, fontSize) from pdf.js.
 *
 *  2. GROUP into visual lines with Y-tolerance ±3 px.
 *     Arabic glyphs on the same baseline can differ by 1-2 px due to
 *     sub-pixel rendering; exact-Y grouping incorrectly splits one visual
 *     line into many fragments.
 *
 *  3. SORT items within each line by X DESCENDING (right-to-left).
 *     Arabic is read RTL, so the rightmost glyph cluster is logically first.
 *     This correctly orders Arabic words whether the PDF content stream
 *     stored them in visual order (right→left) or physical order (left→right).
 *
 *  4. JOIN items with a thin-space separator only when a gap between
 *     adjacent items is wider than the average glyph width, preventing
 *     words from running together while avoiding spurious spaces inside
 *     ligatures.
 *
 *  5. REBUILD rawText by joining lines TOP-TO-BOTTOM.
 *     Because PDF Y=0 is at the page bottom, lines are sorted by
 *     descending Y.  This guarantees rawText[0..N] is always the page
 *     header — the detector relies on this for lesson/chapter detection.
 *
 *  6. Apply Arabic repair (NFKC normalise → expand Arabic presentation
 *     forms → strip bidi controls → replace private-use glyphs).
 *
 * Depends on: pdfjsLib (loaded globally via CDN)
 */

const Parser = (() => {

  // ── Arabic Text Repair ────────────────────────────────────────────────────

  // Arabic presentation forms (FB50-FDFF, FE70-FEFF) are legacy encoding
  // artefacts; NFKC expands them to canonical Arabic base characters.
  function nfkcNormalize(str) {
    return str.normalize('NFKC');
  }

  function hasPrivateUseGlyphs(str) {
    return /[\uE000-\uF8FF]/.test(str);
  }

  /**
   * Replace private-use-area glyph runs with a visible [؟] placeholder
   * so users see where content was lost, instead of silent removal.
   */
  function replacePrivateGlyphs(str) {
    return str.replace(/[\uE000-\uF8FF]+/g, '[؟]');
  }

  // Arabic combining marks (tashkil/madd: 0610–061A, 064B–065F, 0670, 06D6–06ED) + tatweel (0640)
  const HARAKAT_RE = /[\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g;

  /**
   * Strip Arabic diacritics (tashkil), madd, and tatweel.
   * This yields plain text without vowel/elongation marks.
   */
  function stripHarakat(str) {
    return str.replace(HARAKAT_RE, '');
  }

  function cleanText(str) {
    return str
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // zero-width + bidi controls
      .replace(/\.{4,}/g, ' … ')                           // dotted leaders → ellipsis
      .replace(/[ \t]{2,}/g, ' ')                          // collapse horizontal whitespace
      .trim();
  }

  function repairArabic(rawText) {
    const flagged  = hasPrivateUseGlyphs(rawText);
    const replaced = replacePrivateGlyphs(rawText);
    const normalized = nfkcNormalize(replaced);
    const stripped = stripHarakat(normalized);
    const cleaned  = cleanText(stripped);
    return { text: cleaned, flagged };
  }

  // ── PDF Loading ───────────────────────────────────────────────────────────

  async function loadPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  }

  // ── Page Extraction ───────────────────────────────────────────────────────

  const ARABIC_LETTER_RE = /[\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FF]/;

  /**
   * Heuristically pick reading direction per band:
   * RTL when any Arabic letters are present, otherwise LTR (Latin/math).
   */
  function inferDirection(items) {
    const text = items.map(it => it.str).join('');
    return ARABIC_LETTER_RE.test(text) ? 'rtl' : 'ltr';
  }

  const spacingThreshold = item =>
    (item.str.length > 0 ? item.width / item.str.length : item.width) * 0.5;

  /**
   * Merge adjacent items in a band into a string.
   * Direction-aware to keep Arabic RTL ordering while preserving
   * the natural LTR order of mathematical equations and Latin text.
   * Inserts a space only when the gap between two items is larger than
   * half the current item's glyph width, avoiding both word-run-together
   * and spurious spaces inside Arabic ligatures.
   */
  function bandToText(items, direction = 'rtl') {
    if (items.length === 0) return '';
    let out = items[0].str;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur  = items[i];
      // Gap between adjacent items following the reading direction.
      const gap = direction === 'rtl'
        ? prev.x - (cur.x + cur.width)          // prev is to the right of cur
        : cur.x - (prev.x + prev.width);        // cur is to the right of prev
      const threshold = spacingThreshold(cur);
      if (gap > threshold) out += ' ';
      out += cur.str;
    }
    return out;
  }

  /**
   * Extract one page and return:
   *   lines    – [{text, fontSize, y}] sorted top-to-bottom
   *   rawText  – full page text rebuilt from lines (top→bottom, direction-aware per line)
   *   flagged  – true if private-use-area glyphs were found
   */
  async function extractPage(pdfPage) {
    const content = await pdfPage.getTextContent();

    // ── 1. Collect items with position ──
    const items = [];
    for (const item of content.items) {
      if (!item.str) continue;
      const w = item.width !== undefined ? Math.abs(item.width) : Math.abs(item.transform[0]);
      items.push({
        str:      item.str,
        x:        item.transform[4],
        y:        item.transform[5],
        width:    w,
        fontSize: Math.abs(item.transform[3]),
      });
    }
    if (items.length === 0) return { lines: [], rawText: '', flagged: false };

    // ── 2. Sort by Y descending (top of page first in PDF coordinate space) ──
    items.sort((a, b) => b.y - a.y);

    // ── 3. Group into lines with ±3 px Y-tolerance ──
    const Y_TOLERANCE = 3;
    const bands = []; // [{y, items[], fontSize}]
    for (const item of items) {
      const last = bands[bands.length - 1];
      if (last && Math.abs(item.y - last.y) <= Y_TOLERANCE) {
        last.items.push(item);
        last.fontSize = Math.max(last.fontSize, item.fontSize);
      } else {
        bands.push({ y: item.y, items: [item], fontSize: item.fontSize });
      }
    }

    // ── 4. Within each band, sort X descending (RTL: rightmost item first) ──
    const lines = [];
    for (const band of bands) {
      const direction = inferDirection(band.items);
      band.items.sort((a, b) => direction === 'rtl' ? b.x - a.x : a.x - b.x);
      const text = bandToText(band.items, direction);
      if (!text.trim()) continue;
      lines.push({ text, fontSize: band.fontSize, y: band.y });
    }

    // ── 5. Rebuild rawText top-to-bottom from sorted lines ──
    //    Joining with '\n' so rawText[0..N] always reflects the page header.
    const joined = lines.map(l => l.text).join('\n');
    const { text: rawText, flagged } = repairArabic(joined);

    return { lines, rawText, flagged };
  }

  async function extractAll(pdfDoc, onProgress) {
    const total = pdfDoc.numPages;
    const pages = [];
    for (let i = 1; i <= total; i++) {
      const pdfPage = await pdfDoc.getPage(i);
      const data    = await extractPage(pdfPage);
      pages.push({ pageNum: i, ...data });
      if (onProgress) onProgress(i, total);
    }
    return pages;
  }

  return { loadPDF, extractAll, repairArabic };

})();
