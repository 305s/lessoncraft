/**
 * parser.js — v3
 * PDF loading, page extraction, and Arabic text repair.
 *
 * Arabic-textbook parsing strategy (best practices):
 *
 *  1. Collect every text item with its exact (x, y, fontSize) from pdf.js.
 *
 *  2. GROUP into visual lines with dynamic Y-tolerance based on fontSize.
 *     Large fonts need a wider tolerance (up to fontSize × 0.35);
 *     small fonts use a minimum of 2 px.  This prevents both under-grouping
 *     (splitting one headline into many fragments) and over-grouping
 *     (merging items from adjacent lines in dense body text).
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
 *  5. ANNOTATE each line with an isPageNumber flag (standalone 1-4 digit
 *     number) and an isHeader flag (y > 88 % of page height → near the top).
 *     The detector uses these to avoid treating page folios as lesson numbers.
 *
 *  6. REBUILD rawText by joining lines TOP-TO-BOTTOM, skipping pure
 *     page-number lines at the very top/bottom of the page.
 *     Because PDF Y=0 is at the page bottom, lines are sorted by
 *     descending Y.  This guarantees rawText[0..N] is always the page
 *     header — the detector relies on this for lesson/chapter detection.
 *
 *  7. Apply Arabic repair (NFKC normalise → expand Arabic presentation
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
    const flagged    = hasPrivateUseGlyphs(rawText);
    const replaced   = replacePrivateGlyphs(rawText);
    const normalized = nfkcNormalize(replaced);
    const stripped   = stripHarakat(normalized);
    const cleaned    = cleanText(stripped);
    return { text: cleaned, flagged };
  }

  // ── PDF Loading ───────────────────────────────────────────────────────────

  // Base URL of the pdf.js release used in index.html — keep in sync with the CDN version there.
  const PDFJS_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  async function loadPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    return pdfjsLib.getDocument({
      data: arrayBuffer,
      // CMap files let pdf.js decode character codes in PDFs that rely on
      // Adobe standard CMaps (common in Arabic and other non-Latin textbooks).
      // Without these, pdf.js cannot map glyph IDs to Unicode and falls back
      // to Private-Use-Area placeholders, causing garbled / missing text.
      cMapUrl:             PDFJS_CDN_BASE + 'cmaps/',
      cMapPacked:          true,
      // Standard font data lets pdf.js measure/render PDFs that reference
      // built-in PostScript fonts (Courier, Helvetica, Times, Symbol …)
      // without embedding them, improving layout fidelity.
      standardFontDataUrl: PDFJS_CDN_BASE + 'standard_fonts/',
    }).promise;
  }

  // ── Page Extraction ───────────────────────────────────────────────────────

  // Arabic letters only (excludes digits): basic Arabic + Arabic Extended-A/B + presentation forms (ligatures such as "لا")
  const ARABIC_LETTER_PATTERN = /[\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const SPACING_THRESHOLD_MULTIPLIER = 0.5; // empirically: half glyph width keeps words separated without breaking ligatures in tested textbooks
  const MIN_GLYPH_WIDTH = 0.1; // px — prevents zero-width glyphs from eliminating inter-item spacing

  // Dynamic Y-tolerance constants
  // Y_TOLERANCE_FACTOR = 0.35: empirically, a same-line item at fontSize F can
  // be placed up to ~35% of F away from the band baseline due to super/subscripts,
  // sub-pixel rounding, or diacritic anchoring.  Values 0.3–0.4 were tested on
  // several Saudi MoE textbooks; 0.35 avoids both under-grouping (headlines split
  // into fragments) and over-grouping (adjacent small-body lines merged).
  const Y_TOLERANCE_MIN    = 2;    // px — absolute floor
  const Y_TOLERANCE_FACTOR = 0.35; // fraction of fontSize

  /**
   * Compute the Y-grouping tolerance for the current band.
   * Larger fonts (titles, headings) need a wider tolerance because
   * sub-pixel placement can spread same-line glyphs further apart.
   */
  function lineYTolerance(bandFontSize) {
    return Math.max(Y_TOLERANCE_MIN, bandFontSize * Y_TOLERANCE_FACTOR);
  }

  /**
   * A line qualifies as a standalone page-number folio if it consists
   * only of 1–4 Western or Arabic-Indic digits (optionally surrounded by
   * whitespace or a single separator like | or ·).
   * These lines are removed from rawText to prevent false lesson-marker hits.
   */
  const PAGE_NUMBER_RE = /^[\s|·\-]*[٠-٩\d]{1,4}[\s|·\-]*$/;

  function isPageFolio(text) {
    return PAGE_NUMBER_RE.test(text);
  }

  /**
   * Heuristically pick reading direction per band:
   * RTL when any Arabic letters are present, otherwise LTR (Latin/math).
   */
  function inferDirection(items) {
    return items.some(it => ARABIC_LETTER_PATTERN.test(it.str)) ? 'rtl' : 'ltr';
  }

  /**
   * Estimate the minimal horizontal gap (in px) that should introduce a space
   * between two adjacent items, based on the current item's average glyph width.
   */
  function getSpacingThreshold(item) {
    // Empty strings (e.g., whitespace glyphs) fall back to the raw item width.
    const width = typeof item.width === 'number' ? item.width : 0;
    const avgGlyphWidth = item.str.length === 0 ? width : width / item.str.length;
    const safeWidth = Math.max(avgGlyphWidth, MIN_GLYPH_WIDTH); // prevent zero-width glyphs from zeroing out the threshold
    return safeWidth * SPACING_THRESHOLD_MULTIPLIER;
  }

  /**
   * Merge adjacent items in a band into a string.
   * Direction-aware to keep Arabic RTL ordering while preserving
   * the natural LTR order of mathematical equations and Latin text.
   * Inserts a space only when the gap between two items is larger than
   * half the current item's glyph width, avoiding both word-run-together
   * and spurious spaces inside Arabic ligatures.
   */
  function bandToText(items, direction) {
    if (items.length === 0) return '';
    let out = items[0].str;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur  = items[i];
      // Gap between adjacent items following the reading direction.
      const gap = direction === 'rtl'
        ? prev.x - (cur.x + cur.width)      // prev is to the right of cur
        : cur.x - (prev.x + prev.width);    // cur is to the right of prev
      const threshold = getSpacingThreshold(cur);
      if (gap > threshold) out += ' ';
      out += cur.str;
    }
    return out;
  }

  /**
   * Extract one page and return:
   *   lines    – [{text, fontSize, y, isPageFolio}] sorted top-to-bottom
   *   rawText  – full page text rebuilt from lines (top→bottom, folio lines stripped)
   *   flagged  – true if private-use-area glyphs were found
   *   pageHeight – PDF-reported page height (useful for relative position checks)
   */
  async function extractPage(pdfPage) {
    const content    = await pdfPage.getTextContent();
    const viewport   = pdfPage.getViewport({ scale: 1 });
    const pageHeight = viewport.height;

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

    // ── 3. Group into lines with dynamic Y-tolerance based on running fontSize ──
    const bands = []; // [{y, items[], fontSize}]
    for (const item of items) {
      const last      = bands[bands.length - 1];
      const tolerance = last ? lineYTolerance(last.fontSize) : Y_TOLERANCE_MIN;
      if (last && Math.abs(item.y - last.y) <= tolerance) {
        last.items.push(item);
        last.fontSize = Math.max(last.fontSize, item.fontSize);
      } else {
        bands.push({ y: item.y, items: [item], fontSize: item.fontSize });
      }
    }

    // ── 4. Within each band: sort X by direction, build text, flag folios ──
    const lines = [];
    for (const band of bands) {
      const direction = inferDirection(band.items);
      band.items.sort((a, b) => direction === 'rtl' ? b.x - a.x : a.x - b.x);
      const text = bandToText(band.items, direction);
      if (!text.trim()) continue;

      // Compute relative Y position (0 = bottom, 1 = top of page)
      const relY  = pageHeight > 0 ? band.y / pageHeight : 0.5;
      // Folios typically appear at the very top (>90%) or very bottom (<10%)
      const folio = isPageFolio(text) && (relY > 0.90 || relY < 0.10);

      lines.push({ text, fontSize: band.fontSize, y: band.y, isPageFolio: folio });
    }

    // ── 5. Rebuild rawText top-to-bottom, skipping page-folio lines ──
    //    Joining with '\n' so rawText[0..N] always reflects the page header.
    const joined = lines
      .filter(l => !l.isPageFolio)
      .map(l => l.text)
      .join('\n');
    const { text: rawText, flagged } = repairArabic(joined);

    return { lines, rawText, flagged, pageHeight };
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
