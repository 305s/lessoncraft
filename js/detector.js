/**
 * detector.js — v2
 *
 * Key fixes over v1:
 *  1. TOC parser now handles two-column Arabic textbook format
 *  2. Chapter assignment uses page-range logic (not heading text alone)
 *  3. TOC/front-matter pages are skipped from lesson content
 *  4. Lesson detection uses font-size threshold more aggressively
 *  5. Patterns updated to match Saudi math textbook style
 */

const Detector = (() => {

  // ── Patterns ──────────────────────────────────────────────────────────────

  const PATTERNS = {
    // Chapter heading patterns (normal + reversed extraction order)
    chapter: [
      /الفصل\s*(\d+)/,
      /لصفلا\s*(\d+)/,
      /(\d+)\s*لصفلا/,
      /(\d+)\s*الفصل/,
    ],
    // Lesson heading patterns
    lesson: [
      /الدرس\s*(\d+)/,
      /سردلا\s*(\d+)/,
      /(\d+)\s*سردلا/,
      /(\d+)\s*الدرس/,
    ],
    // Section type keywords (both normal and reversed)
    sections: {
      warmup:    [/التهيئة/, /ةئيهتلا/],
      explore:   [/الاستكشاف/, /فاشكتسا/, /فاشكتسلاا/, /فاشكتسلإا/],
      learn:     [/تعلم/, /ملعت/, /أتعلم/, /ملعتأ/],
      example:   [/مثال/, /لاثم/],
      exercises: [/تدرب/, /برّدت/, /تمارين/, /نيرامت/, /راجع/, /عجار/],
      review:    [/مراجعة/, /ةعجارم/, /مراجع/],
    },
    // Standalone chapter number in TOC (e.g. "8" or "١٢" appearing alone on a line or near page nums)
    standaloneNum: /^\s*(\d{1,2})\s*$/,
    // Page number in TOC: a number (1-999) possibly surrounded by spaces
    pageNum: /\b(\d{1,3})\b/g,
  };

  // Pages at the start to scan for TOC
  const TOC_SCAN_PAGES = 15;
  // Font size above which a line is treated as a heading candidate
  const HEADING_FONT_MIN = 10;
  // Font size above which a line is definitely a chapter/lesson heading
  const HEADING_FONT_STRONG = 13;

  // ── Utilities ─────────────────────────────────────────────────────────────

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

  // Convert Arabic-Indic digits to Western
  function normalizeDigits(str) {
    return str.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660);
  }

  // ── Pass 1: TOC Parser ─────────────────────────────────────────────────────

  /**
   * Strategy for Saudi math textbook TOC:
   * - TOC is typically 2–4 pages of the first 15 pages
   * - Each line may contain: [chapter_name] [chapter_num] [dots] [page_num]
   *   sometimes two columns per line
   * - We collect ALL numbers on TOC pages, then pair chapter numbers (5-15 range)
   *   with page numbers (10-250 range) that appear near them
   *
   * Returns { chapterMap: {chNum: startPage}, tocPageNums: Set<number> }
   */
  function parseTOC(pages) {
    const chapterMap = {};
    const tocPageNums = new Set();

    const scanPages = pages.slice(0, TOC_SCAN_PAGES);

    for (const page of scanPages) {
      const text = normalizeDigits(page.rawText);

      // A TOC page has many " … " leaders after our cleaning
      const leaderCount = (text.match(/ … /g) || []).length;
      const isTocPage = leaderCount >= 2;

      if (!isTocPage) continue;
      tocPageNums.add(page.pageNum);

      // Split on leaders — each chunk is "title … pageNum"
      const chunks = text.split(' … ');
      for (let i = 0; i < chunks.length - 1; i++) {
        const titlePart = chunks[i].trim();
        const rest = chunks[i + 1].trim();

        // Extract the first number from 'rest' as the page number
        const pageMatch = rest.match(/^(\d{1,3})/);
        if (!pageMatch) continue;
        const pageNum = parseInt(pageMatch[1], 10);
        if (pageNum < 5 || pageNum > 300) continue;

        // Try to find a chapter number in the title part
        // Chapter numbers in this book appear as standalone digits (7-12)
        const chapterMatch = matchAny(titlePart, PATTERNS.chapter);
        if (chapterMatch) {
          chapterMap[parseInt(chapterMatch[1], 10)] = pageNum;
          continue;
        }

        // Also look for standalone digits at the end of the title part
        // e.g. "المضاعفات والقواسم 8" — the "8" is the chapter number
        const trailingNum = titlePart.match(/\b(\d{1,2})\s*$/);
        if (trailingNum) {
          const n = parseInt(trailingNum[1], 10);
          // Chapter numbers for this grade are typically 1-15
          if (n >= 1 && n <= 15 && pageNum >= 10) {
            if (!chapterMap[n]) chapterMap[n] = pageNum; // first occurrence wins
          }
        }
      }
    }

    return { chapterMap, tocPageNums };
  }

  // ── Page → Chapter assignment (range-based) ────────────────────────────────

  /**
   * Build a page→chapter lookup using the chapter start-page map.
   * This is more reliable than heading-text detection for Arabic PDFs.
   *
   * Example: if chapters start at pages { 7:12, 8:50, 9:86 }
   * then pages 12–49 → chapter 7, pages 50–85 → chapter 8, etc.
   */
  function buildPageChapterMap(chapterMap, totalPages) {
    const entries = Object.entries(chapterMap)
      .map(([num, page]) => ({ num: parseInt(num, 10), page }))
      .sort((a, b) => a.page - b.page);

    const pageToChapter = {};
    for (let i = 0; i < entries.length; i++) {
      const start = entries[i].page;
      const end = i + 1 < entries.length ? entries[i + 1].page - 1 : totalPages;
      for (let p = start; p <= end; p++) {
        pageToChapter[p] = entries[i].num;
      }
    }
    return pageToChapter;
  }

  // ── Pass 2: Body Sweep ─────────────────────────────────────────────────────

  function sweepBody(pages, chapterMap, tocPageNums) {
    const pageToChapter = buildPageChapterMap(chapterMap, pages.length);

    let currentChapter = null;
    let currentLesson = null;
    let currentSection = null;

    const annotated = [];

    for (const page of pages) {
      // Skip TOC and front-matter pages entirely from lesson content
      if (tocPageNums.has(page.pageNum)) continue;
      // Skip the very first pages (cover, copyright, intro) before chapter 1 starts
      const minChapterPage = Math.min(...Object.values(chapterMap), 9999);
      if (page.pageNum < minChapterPage && Object.keys(chapterMap).length > 0) continue;

      // Assign chapter from page-range map (reliable)
      if (pageToChapter[page.pageNum]) {
        const mappedChapter = pageToChapter[page.pageNum];
        if (mappedChapter !== currentChapter) {
          currentChapter = mappedChapter;
          currentLesson = null;
          currentSection = null;
        }
      }

      // Scan lines for lesson/section headings using font size
      for (const line of (page.lines || [])) {
        const text = line.text.trim();
        if (!text || text.length < 2) continue;

        const isStrong = line.fontSize >= HEADING_FONT_STRONG;
        const isHeading = line.fontSize >= HEADING_FONT_MIN;

        // Chapter override from heading text (catches cases where page-map missed)
        if (isStrong) {
          const chMatch = matchAny(text, PATTERNS.chapter);
          if (chMatch) {
            currentChapter = parseInt(chMatch[1], 10);
            currentLesson = null;
            currentSection = null;
            continue;
          }
        }

        // Lesson boundary
        if (isHeading) {
          const lesMatch = matchAny(normalizeDigits(text), PATTERNS.lesson);
          if (lesMatch) {
            currentLesson = parseInt(lesMatch[1], 10);
            currentSection = null;
            continue;
          }
        }

        // Section tag
        const sec = detectSection(text);
        if (sec) {
          currentSection = sec;
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

  // ── Build Tree ─────────────────────────────────────────────────────────────

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

    const chapters = Object.values(chaptersMap)
      .sort((a, b) => {
        if (a.id === 'unknown') return 1;
        if (b.id === 'unknown') return -1;
        return a.id - b.id;
      })
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

  // ── Entry ──────────────────────────────────────────────────────────────────

  function detect(pages, metadata = {}) {
    const { chapterMap, tocPageNums } = parseTOC(pages);
    const annotated = sweepBody(pages, chapterMap, tocPageNums);
    const tree = buildTree(annotated, { ...metadata, chapterMap });
    return { tree, annotated, chapterMap, tocPageNums };
  }

  return { detect, PATTERNS };

})();
