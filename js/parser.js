/**
 * parser.js
 * Handles PDF loading, page-by-page extraction, and Arabic text repair.
 * Depends on: pdf.js (loaded globally as pdfjsLib)
 */

const Parser = (() => {

  // ── Arabic Text Repair ────────────────────────────────────────────────────

  /**
   * NFKC normalization collapses Arabic Presentation Forms (U+FB50–U+FDFF, U+FE70–U+FEFF)
   * back to base Arabic characters (U+0600–U+06FF).
   * This is the fix for the common "garbled Arabic" issue in PDFs using presentation-form fonts.
   */
  function nfkcNormalize(str) {
    return str.normalize('NFKC');
  }

  /**
   * Detect if a string contains Private Use Area characters (U+E000–U+F8FF).
   * These are unmappable custom glyphs — the page likely uses a symbol/image font.
   * We flag it so the UI can warn the user and optionally trigger OCR later.
   */
  function hasPrivateUseGlyphs(str) {
    return /[\uE000-\uF8FF]/.test(str);
  }

  /**
   * Remove or replace known noise artifacts from PDF extraction:
   * - Multiple spaces/tabs → single space
   * - Repeated dots (TOC leaders like "............") → single marker we can parse
   * - Zero-width chars
   */
  function cleanText(str) {
    return str
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // zero-width + bidi marks
      .replace(/\.{3,}/g, ' … ')                           // dotted leaders → clean ellipsis
      .replace(/\s+/g, ' ')                                // collapse whitespace
      .trim();
  }

  /**
   * Full Arabic repair pipeline for a single page's raw text.
   * Returns { text, flagged } where flagged=true means the page has unmappable glyphs.
   */
  function repairArabic(rawText) {
    const flagged = hasPrivateUseGlyphs(rawText);
    // Filter out private-use characters before normalizing
    const filtered = rawText.replace(/[\uE000-\uF8FF]/g, '');
    const normalized = nfkcNormalize(filtered);
    const cleaned = cleanText(normalized);
    return { text: cleaned, flagged };
  }

  // ── PDF Loading & Extraction ──────────────────────────────────────────────

  /**
   * Load a PDF File object using pdf.js.
   * Returns a PDFDocumentProxy.
   */
  async function loadPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    return loadingTask.promise;
  }

  /**
   * Extract text from a single page with font size metadata.
   * pdf.js gives us individual text items with transform matrices.
   * We use the font size to help detect headings (larger = heading).
   *
   * Returns: { lines: [{text, fontSize, y}], rawText, flagged }
   */
  async function extractPage(pdfPage) {
    const content = await pdfPage.getTextContent();

    let rawText = '';
    const lines = [];
    let currentLine = { text: '', fontSize: 0, y: null };

    for (const item of content.items) {
      if (item.str === undefined) continue;

      // Transform matrix: [scaleX, skewX, skewY, scaleY, translateX, translateY]
      const fontSize = Math.abs(item.transform[3]); // scaleY ≈ font size in pts
      const y = Math.round(item.transform[5]);       // vertical position

      rawText += item.str;

      // Group items on the same Y-line (within 2pt tolerance)
      if (currentLine.y === null || Math.abs(y - currentLine.y) < 2) {
        currentLine.text += item.str;
        currentLine.fontSize = Math.max(currentLine.fontSize, fontSize);
        currentLine.y = y;
      } else {
        if (currentLine.text.trim()) lines.push({ ...currentLine });
        currentLine = { text: item.str, fontSize, y };
      }
    }
    if (currentLine.text.trim()) lines.push({ ...currentLine });

    const { text, flagged } = repairArabic(rawText);
    return { lines, rawText: text, flagged };
  }

  /**
   * Extract all pages from a PDF document.
   * Calls onProgress(pageNum, totalPages) after each page.
   *
   * Returns: Array of PageData objects:
   * { pageNum, rawText, lines, flagged }
   */
  async function extractAll(pdfDoc, onProgress) {
    const total = pdfDoc.numPages;
    const pages = [];

    for (let i = 1; i <= total; i++) {
      const pdfPage = await pdfDoc.getPage(i);
      const { lines, rawText, flagged } = await extractPage(pdfPage);

      pages.push({ pageNum: i, rawText, lines, flagged });

      if (onProgress) onProgress(i, total);
    }

    return pages;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return { loadPDF, extractAll, repairArabic };

})();
