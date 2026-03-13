/**
 * parser.js
 * PDF loading, page extraction, and Arabic text repair.
 * Depends on: pdfjsLib (loaded globally via CDN)
 */

const Parser = (() => {

  // ── Arabic Text Repair ────────────────────────────────────────────────────

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

  function cleanText(str) {
    return str
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // zero-width + bidi marks
      .replace(/\.{4,}/g, ' … ')                           // dotted leaders
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function repairArabic(rawText) {
    const flagged = hasPrivateUseGlyphs(rawText);
    const replaced = replacePrivateGlyphs(rawText);
    const normalized = nfkcNormalize(replaced);
    const cleaned = cleanText(normalized);
    return { text: cleaned, flagged };
  }

  // ── PDF Loading ───────────────────────────────────────────────────────────

  async function loadPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  }

  /**
   * Extract one page. Groups items by Y-coordinate into lines.
   * Preserves fontSize per line — used by detector for heading detection.
   */
  async function extractPage(pdfPage) {
    const content = await pdfPage.getTextContent();
    let rawText = '';
    const lineMap = {};

    for (const item of content.items) {
      if (!item.str) continue;
      const fontSize = Math.abs(item.transform[3]);
      const y = Math.round(item.transform[5]);
      rawText += item.str + ' ';
      if (!lineMap[y]) lineMap[y] = { text: '', fontSize: 0, y };
      lineMap[y].text += item.str;
      lineMap[y].fontSize = Math.max(lineMap[y].fontSize, fontSize);
    }

    const lines = Object.values(lineMap)
      .filter(l => l.text.trim())
      .sort((a, b) => b.y - a.y);   // top to bottom

    const { text, flagged: privateGlyphs } = repairArabic(rawText);
    const cleaned = text.trim();
    const isImageOnly = (content.items || []).length === 0;
    const isEmpty = cleaned.length === 0;
    const flagged = privateGlyphs || isImageOnly || isEmpty;
    return { lines, rawText: text, flagged, needsOCR: isImageOnly || isEmpty };
  }

  async function extractAll(pdfDoc, onProgress) {
    const total = pdfDoc.numPages;
    const pages = [];
    for (let i = 1; i <= total; i++) {
      const pdfPage = await pdfDoc.getPage(i);
      const data = await extractPage(pdfPage);
      pages.push({ pageNum: i, ...data });
      if (onProgress) onProgress(i, total);
    }
    return pages;
  }

  return { loadPDF, extractAll, repairArabic };

})();
