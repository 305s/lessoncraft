/**
 * summarizer.js
 * Auto-generates a structured lesson summary from extracted lesson data.
 *
 * All processing is client-side; no network calls are made.
 *
 * Summary structure returned by summarize():
 * {
 *   title:       string   — lesson title (from lesson.title)
 *   objectives:  string[] — key learning points extracted from "learn" section
 *   keyTerms:    string[] — vocabulary / important terms detected
 *   exercises:   string[] — numbered questions found in "exercises" section
 *   mainPoints:  string[] — most informative sentences across all sections
 * }
 */

const Summarizer = (() => {

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Split Arabic/mixed text into sentences.
   * Splits on Arabic punctuation (؟ ، ؛ .) and newlines.
   */
  function splitSentences(text) {
    if (!text) return [];
    return text
      .split(/[\n؟،؛.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 8);  // ignore very short fragments
  }

  /**
   * Extract numbered items (exercises / examples) from text.
   * Handles both Arabic-Indic (١ ٢ ٣) and Western (1 2 3) numerals
   * followed by a period, parenthesis, or dash.
   */
  function extractNumberedItems(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const items = [];
    for (const line of lines) {
      const trimmed = line.trim();
      // Match lines starting with a number: "1." / "١-" / "(2)" / "٣)"
      if (/^[\u0660-\u0669\d]{1,2}[\.\-\)\s]/.test(trimmed) && trimmed.length > 5) {
        items.push(trimmed);
      }
    }
    return items;
  }

  // Normalise score contribution of sentence length.
  // A sentence of 20 characters contributes 1 point; the bonus is capped at 5
  // so very long sentences don't dominate over educationally-relevant shorter ones.
  const SENTENCE_LENGTH_DIVISOR = 20;

  /**
   * Very lightweight "important sentence" scorer.
   * Rewards sentences that are longer (more content) and contain
   * educational signal words common in Arabic textbooks.
   */
  const SIGNAL_WORDS = [
    /نستطيع/, /يمكن/, /تعريف/, /يساوي/, /ناتج/, /مفهوم/,
    /خاصية/, /قانون/, /نتيجة/, /نعرف/, /نلاحظ/, /نستنتج/,
    /يتكون/, /يعني/, /هو/, /هي/, /هما/, /هم/, /تكتب/, /تقرأ/,
  ];

  function scoreSentence(sentence) {
    let score = Math.min(sentence.length / SENTENCE_LENGTH_DIVISOR, 5); // length bonus, capped at 5
    for (const re of SIGNAL_WORDS) {
      if (re.test(sentence)) score += 1;
    }
    return score;
  }

  /**
   * Return the top-N most informative sentences from `text`.
   */
  function topSentences(text, n = 5) {
    const sentences = splitSentences(text);
    if (sentences.length <= n) return sentences;
    return sentences
      .map(s => ({ s, score: scoreSentence(s) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(x => x.s);
  }

  /**
   * Extract what look like vocabulary / key-term definitions.
   * A "term" line contains a colon or equals sign separating a short Arabic
   * phrase from an explanation.
   */
  function extractKeyTerms(text) {
    if (!text) return [];
    const terms = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if ((t.includes(':') || t.includes('=') || t.includes('يعني') || t.includes('هو')) &&
          t.length > 6 && t.length < 120) {
        terms.push(t);
      }
    }
    return terms.slice(0, 8);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Generate a summary object for a single lesson.
   *
   * @param {object} lesson  – lesson object from the book tree
   *   { id, title, pages, sections: { learn, explore, exercises, ... }, ... }
   * @returns {object} summary
   */
  function summarize(lesson) {
    if (!lesson) return null;

    const sections  = lesson.sections || {};
    const learnText = sections.learn    || '';
    const explText  = sections.explore  || '';
    const exerText  = sections.exercises || '';
    const warmText  = sections.warmup   || '';
    const allText   = [learnText, explText, warmText, sections.content || ''].join('\n');

    return {
      title:      lesson.title || '',
      objectives: topSentences(learnText || explText, 5),
      keyTerms:   extractKeyTerms(learnText || allText),
      exercises:  extractNumberedItems(exerText).slice(0, 10),
      mainPoints: topSentences(allText, 7),
    };
  }

  /**
   * Generate suggested homework questions from a lesson's exercises section.
   * Returns up to `count` numbered exercise strings, or [] if none detected.
   *
   * @param {object} lesson
   * @param {number} count  max questions to return (default 5)
   */
  function suggestHomework(lesson, count = 5) {
    if (!lesson) return [];
    const exerText = lesson.sections?.exercises || lesson.sections?.review || '';
    const items    = extractNumberedItems(exerText);
    // Fall back to top sentences if no numbered items found
    if (items.length === 0) {
      return topSentences(exerText, count);
    }
    return items.slice(0, count);
  }

  return { summarize, suggestHomework };

})();
