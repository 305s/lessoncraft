/**
 * detector.js
 * Two-pass structure detection:
 *   Pass 1: TOC parse → chapter-to-page map
 *   Pass 2: Body sweep → lesson boundaries + section tagging
 *
 * Designed for Arabic math textbooks (Saudi curriculum) but
 * patterns are configurable via PATTERNS below.
 */

const Detector = (() => {

  // ── Configurable Patterns ─────────────────────────────────────────────────
  // Arabic text in PDFs can appear in normal or visually-reversed order.
  // We match both. Add/modify patterns here as you encounter new books.

  const PATTERNS = {
    // Chapter heading — matches "الفصل 8" or its reversed extraction artifact
    chapter: [
      /الفصل\s*(\d+)/,
      /لصفلا\s*(\d+)/,
      /(\d+)\s*لصفلا/,
      /(\d+)\s*الفصل/,
    ],
    // Lesson heading — "الدرس 2" etc.
    lesson: [
      /الدرس\s*(\d+)/,
      /سردلا\s*(\d+)/,
      /(\d+)\s*سردلا/,
    ],
    // Section types — used to label content chunks within a lesson
    sections: {
      warmup:    [/التهيئة/, /ةئيهتلا/],
      explore:   [/الاستكشاف/, /فاشكتسا/, /فاشكتسلاا/],
      learn:     [/تعلم/, /ملعت/, /أتعلم/, /ملعتأ/],
      example:   [/مثال/, /لاثم/],
      exercises: [/تدرب/, /برّدت/, /تمارين/, /نيرامت/],
      review:    [/مراجعة/, /ةعجارم/],
    },
    // TOC line: text followed by dotted leader then page number
    // After our cleanText pass, leaders become " … "
    tocLine: /(.+?)\s*…\s*(\d+)\s*$/,
  };

  // Min font size (in pts) to consider a line a heading candidate
  const HEADING_FONT_THRESHOLD = 11;

  // How many pages at the start to scan for the TOC
  const TOC_SCAN_PAGES = 12;

  // ── Utility ───────────────────────────────────────────────────────────────

  function matchAny(text, patterns) {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m;
    }
    return null;
  }

  function detectSection(text) {
    for (const [name, patterns] of Object.entries(PATTERNS.sections)) {
      if (matchAny(text, patterns)) return name;
    }
    return null;
  }

  // ── Pass 1: TOC Parser ─────────────────────────────────────────────────────

  /**
   * Scan the first TOC_SCAN_PAGES pages for chapter → start-page mappings.
   * Returns: { chapterMap: { "7": 50, "8": 56, ... }, tocPageRange: [start, end] }
   */
  function parseTOC(pages) {
    const chapterMap = {};
    let tocStart = null, tocEnd = null;

    const tocPages = pages.slice(0, TOC_SCAN_PAGES);

    for (const page of tocPages) {
      const lines = page.rawText.split('\n').map(l => l.trim()).filter(Boolean);
      let isTocPage = false;

      for (const line of lines) {
        // Check for TOC entry (has a dotted leader + page number)
        const tocMatch = line.match(PATTERNS.tocLine);
        if (tocMatch) {
          isTocPage = true;
          const label = tocMatch[1].trim();
          const pageNum = parseInt(tocMatch[2], 10);

          // Check if this TOC entry is a chapter heading
          const chapterMatch = matchAny(label, PATTERNS.chapter);
          if (chapterMatch) {
            const chNum = chapterMatch[1];
            chapterMap[chNum] = pageNum;
          }
        }
      }

      if (isTocPage) {
        if (tocStart === null) tocStart = page.pageNum;
        tocEnd = page.pageNum;
      }
    }

    return { chapterMap, tocPageRange: tocStart ? [tocStart, tocEnd] : null };
  }

  // ── Pass 2: Body Sweep ─────────────────────────────────────────────────────

  /**
   * Given all pages + the TOC chapter map, sweep the body and assign each page
   * to a chapter/lesson/section context.
   *
   * Returns: Array of AnnotatedPage:
   * { pageNum, chapter, lesson, section, rawText, lines, flagged }
   */
  function sweepBody(pages, chapterMap) {
    // Sort chapter starts ascending so we can derive ranges
    const chapterStarts = Object.entries(chapterMap)
      .map(([num, page]) => ({ num: parseInt(num), page }))
      .sort((a, b) => a.page - b.page);

    // State machine
    let currentChapter = null;
    let currentLesson = null;
    let currentSection = null;

    const annotated = [];

    for (const page of pages) {
      // ── Determine chapter from page number (TOC-based) ──
      for (const { num, page: startPage } of chapterStarts) {
        if (page.pageNum >= startPage) currentChapter = num;
      }

      // ── Scan lines for headings ──
      const allLines = page.lines || [];

      for (const line of allLines) {
        const text = line.text.trim();
        if (!text) continue;

        const isLargeFont = line.fontSize >= HEADING_FONT_THRESHOLD;

        // Chapter boundary
        const chMatch = matchAny(text, PATTERNS.chapter);
        if (chMatch && isLargeFont) {
          currentChapter = parseInt(chMatch[1], 10);
          currentLesson = null;
          currentSection = null;
          continue;
        }

        // Lesson boundary
        const lesMatch = matchAny(text, PATTERNS.lesson);
        if (lesMatch && isLargeFont) {
          currentLesson = parseInt(lesMatch[1], 10);
          currentSection = null;
          continue;
        }

        // Section tag (warmup, explore, exercises, etc.)
        const sec = detectSection(text);
        if (sec) {
          currentSection = sec;
          continue;
        }
      }

      annotated.push({
        pageNum: page.pageNum,
        chapter: currentChapter,
        lesson: currentLesson,
        section: currentSection,
        rawText: page.rawText,
        lines: page.lines,
        flagged: page.flagged,
      });
    }

    return annotated;
  }

  // ── Build Lesson Tree ─────────────────────────────────────────────────────

  /**
   * Collapse annotated pages into a hierarchical structure:
   * chapters → lessons → sections → text
   */
  function buildTree(annotatedPages, metadata = {}) {
    const chaptersMap = {};

    for (const page of annotatedPages) {
      const chId = page.chapter ?? 'unknown';
      const lesId = page.lesson ?? 0;

      if (!chaptersMap[chId]) {
        chaptersMap[chId] = { id: chId, title: '', lessons: {}, pages: [] };
      }
      chaptersMap[chId].pages.push(page.pageNum);

      const chapter = chaptersMap[chId];
      if (!chapter.lessons[lesId]) {
        chapter.lessons[lesId] = {
          id: lesId,
          title: '',
          pages: [],
          sections: {},
          flaggedPages: [],
        };
      }
      const lesson = chapter.lessons[lesId];
      lesson.pages.push(page.pageNum);

      if (page.flagged) lesson.flaggedPages.push(page.pageNum);

      const secKey = page.section ?? 'content';
      if (!lesson.sections[secKey]) lesson.sections[secKey] = '';
      lesson.sections[secKey] += (lesson.sections[secKey] ? '\n' : '') + page.rawText;
    }

    // Convert maps to sorted arrays
    const chapters = Object.values(chaptersMap)
      .sort((a, b) => (a.id === 'unknown' ? 1 : a.id - b.id))
      .map(ch => ({
        ...ch,
        lessons: Object.values(ch.lessons).sort((a, b) => a.id - b.id),
      }));

    return {
      meta: {
        ...metadata,
        scrapedAt: new Date().toISOString(),
        totalPages: annotatedPages.length,
        totalChapters: chapters.filter(c => c.id !== 'unknown').length,
      },
      chapters,
    };
  }

  // ── Main Entry ─────────────────────────────────────────────────────────────

  /**
   * Run full detection pipeline on extracted pages.
   * pages: output from Parser.extractAll()
   * metadata: { bookTitle, grade, subject }
   */
  function detect(pages, metadata = {}) {
    const { chapterMap, tocPageRange } = parseTOC(pages);
    const annotated = sweepBody(pages, chapterMap);
    const tree = buildTree(annotated, { ...metadata, tocPageRange, chapterMap });
    return { tree, annotated, chapterMap };
  }

  return { detect, PATTERNS };

})();
