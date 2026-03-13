/**
 * detector.js — v3
 * Rebuilt specifically for Saudi curriculum two-column TOC format.
 *
 * The book TOC looks like this after extraction (two chapters per row, RTL):
 *   "تافعاضلماو مضاوقلا 8   لامتحلااو ءاضحإلاا 7"    ← chapter titles with numbers
 *   "50 ………………… 12 …………………"                        ← page numbers below them
 *
 * Strategy:
 *   1. Find lines that contain chapter numbers (standalone digits in Arabic textbook range)
 *   2. Find page numbers on adjacent lines
 *   3. Build chapter→startPage map
 *   4. Skip TOC/front-matter pages from content
 *   5. Assign pages to chapters by range, lessons by heading scan
 */

const Detector = (() => {

  // ── Patterns ──────────────────────────────────────────────────────────────

  const PATTERNS = {
    chapter: [
      /الفصل\s*(\d+)/, /لصفلا\s*(\d+)/,
      /(\d+)\s*لصفلا/, /(\d+)\s*الفصل/,
    ],
    lesson: [
      /الدرس\s*(\d+)/, /سردلا\s*(\d+)/,
      /(\d+)\s*سردلا/, /(\d+)\s*الدرس/,
    ],
    sections: {
      warmup:    [/التهيئة/, /ةئيهتلا/],
      explore:   [/الاستكشاف/, /فاشكتسا/, /فاشكتسلاا/, /فاشكتسلإا/],
      learn:     [/تعلم/, /ملعت/, /أتعلم/, /ملعتأ/],
      example:   [/مثال/, /لاثم/],
      exercises: [/تدرب/, /برّدت/, /تمارين/, /نيرامت/],
      review:    [/مراجعة/, /ةعجارم/, /مراجع/, /عجار/],
    },
  };

  const TOC_SCAN_PAGES = 15;
  const HEADING_FONT_MIN = 10;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function matchAny(text, patterns) {
    for (const p of patterns) { const m = text.match(p); if (m) return m; }
    return null;
  }

  function detectSection(text) {
    for (const [name, patterns] of Object.entries(PATTERNS.sections)) {
      if (matchAny(text, patterns)) return name;
    }
    return null;
  }

  function normalizeDigits(str) {
    return str.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660);
  }

  // Extract all standalone integers from a string
  function extractNumbers(str) {
    return [...str.matchAll(/\b(\d{1,3})\b/g)].map(m => parseInt(m[1], 10));
  }

  // ── Pass 1: TOC Parser (two-column format) ────────────────────────────────

  function parseTOC(pages) {
    const chapterMap = {};
    const tocPageNums = new Set();

    const scanPages = pages.slice(0, TOC_SCAN_PAGES);

    for (const page of scanPages) {
      const raw = normalizeDigits(page.rawText);

      // Detect TOC page: has dotted leaders (we cleaned them to " … ")
      const leaderCount = (raw.match(/ … /g) || []).length;
      const hasManyDots = (raw.match(/\.{5,}/g) || []).length;
      if (leaderCount < 2 && hasManyDots < 2) continue;

      tocPageNums.add(page.pageNum);

      // Split into lines and work through them
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

      // Collect page-number lines (lines that are mostly digits and dots/spaces)
      // and title lines (lines that contain Arabic text + a chapter digit)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nums = extractNumbers(line);
        if (nums.length === 0) continue;

        // Check if line looks like chapter titles (has Arabic chars + small digits)
        const hasArabic = /[\u0600-\u06FF]/.test(line);

        if (hasArabic) {
          // This is a title line — chapter numbers are small digits (1–20) in the text
          // Page numbers for these chapters are on the NEXT numeric-only line
          const chNums = nums.filter(n => n >= 1 && n <= 20);
          if (chNums.length === 0) continue;

          // Look ahead for a line with page numbers (larger values, 10–300)
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const nextLine = lines[j];
            if (/[\u0600-\u06FF]/.test(nextLine)) break; // hit another title line, stop
            const pageNums = extractNumbers(normalizeDigits(nextLine))
              .filter(n => n >= 10 && n <= 300);

            if (pageNums.length > 0) {
              // Match: rightmost chapter → smallest page, leftmost chapter → largest page
              // (RTL layout: right = earlier in book)
              const sortedCh = [...chNums].sort((a, b) => a - b);
              const sortedPg = [...pageNums].sort((a, b) => a - b);

              for (let k = 0; k < Math.min(sortedCh.length, sortedPg.length); k++) {
                if (!chapterMap[sortedCh[k]]) {
                  chapterMap[sortedCh[k]] = sortedPg[k];
                }
              }
              break;
            }
          }
        }
      }
    }

    // Fallback: if auto-detection found nothing, try scanning ALL lines for
    // "chapter N ... page P" style entries
    if (Object.keys(chapterMap).length === 0) {
      for (const page of scanPages) {
        const raw = normalizeDigits(page.rawText);
        const leaderCount = (raw.match(/ … /g) || []).length;
        if (leaderCount < 2) continue;
        tocPageNums.add(page.pageNum);

        const chunks = raw.split(' … ');
        for (let i = 0; i < chunks.length - 1; i++) {
          const title = chunks[i].trim();
          const after = chunks[i + 1].trim();
          const pageMatch = after.match(/^(\d{1,3})/);
          if (!pageMatch) continue;
          const pageNum = parseInt(pageMatch[1], 10);
          if (pageNum < 5 || pageNum > 300) continue;

          const chMatch = matchAny(title, PATTERNS.chapter);
          if (chMatch && !chapterMap[chMatch[1]]) {
            chapterMap[parseInt(chMatch[1], 10)] = pageNum;
          }
          // trailing digit fallback
          const trail = title.match(/\b(\d{1,2})\s*$/);
          if (trail) {
            const n = parseInt(trail[1], 10);
            if (n >= 1 && n <= 15 && !chapterMap[n]) chapterMap[n] = pageNum;
          }
        }
      }
    }

    return { chapterMap, tocPageNums };
  }

  // ── Page-range chapter assignment ─────────────────────────────────────────

  function buildPageChapterMap(chapterMap, totalPages) {
    const entries = Object.entries(chapterMap)
      .map(([num, page]) => ({ num: parseInt(num, 10), page }))
      .sort((a, b) => a.page - b.page);

    const map = {};
    for (let i = 0; i < entries.length; i++) {
      const start = entries[i].page;
      const end = i + 1 < entries.length ? entries[i + 1].page - 1 : totalPages;
      for (let p = start; p <= end; p++) map[p] = entries[i].num;
    }
    return map;
  }

  // ── Pass 2: Body Sweep ────────────────────────────────────────────────────

  function sweepBody(pages, chapterMap, tocPageNums) {
    const pageToChapter = buildPageChapterMap(chapterMap, pages.length);
    const minContentPage = Object.keys(chapterMap).length > 0
      ? Math.min(...Object.values(chapterMap))
      : 1;

    let currentChapter = null;
    let currentLesson  = null;
    let currentSection = null;
    const annotated = [];

    for (const page of pages) {
      // Skip TOC and pre-chapter pages
      if (tocPageNums.has(page.pageNum)) continue;
      if (page.pageNum < minContentPage) continue;

      // Chapter from range map
      if (pageToChapter[page.pageNum] !== undefined) {
        const mapped = pageToChapter[page.pageNum];
        if (mapped !== currentChapter) {
          currentChapter = mapped;
          currentLesson  = null;
          currentSection = null;
        }
      }

      // Scan lines for headings
      for (const line of (page.lines || [])) {
        const text = normalizeDigits(line.text.trim());
        if (text.length < 2) continue;

        // Chapter override from body text
        if (line.fontSize >= 12) {
          const chM = matchAny(text, PATTERNS.chapter);
          if (chM) {
            currentChapter = parseInt(chM[1], 10);
            currentLesson  = null;
            currentSection = null;
            continue;
          }
        }

        // Lesson heading
        if (line.fontSize >= HEADING_FONT_MIN) {
          const lesM = matchAny(text, PATTERNS.lesson);
          if (lesM) {
            currentLesson  = parseInt(lesM[1], 10);
            currentSection = null;
            continue;
          }
        }

        // Section tag
        const sec = detectSection(text);
        if (sec) currentSection = sec;
      }

      annotated.push({
        pageNum: page.pageNum,
        chapter: currentChapter,
        lesson:  currentLesson,
        section: currentSection,
        rawText: page.rawText,
        lines:   page.lines,
        flagged: page.flagged,
      });
    }

    return annotated;
  }

  // ── Build Tree ─────────────────────────────────────────────────────────────

  function buildTree(annotated, metadata = {}) {
    const chaptersMap = {};

    for (const page of annotated) {
      const chId  = page.chapter ?? 'unknown';
      const lesId = page.lesson  ?? 0;

      if (!chaptersMap[chId])
        chaptersMap[chId] = { id: chId, title: '', lessons: {}, pages: [] };

      chaptersMap[chId].pages.push(page.pageNum);
      const chapter = chaptersMap[chId];

      if (!chapter.lessons[lesId])
        chapter.lessons[lesId] = { id: lesId, title: '', pages: [], sections: {}, flaggedPages: [] };

      const lesson = chapter.lessons[lesId];
      lesson.pages.push(page.pageNum);
      if (page.flagged) lesson.flaggedPages.push(page.pageNum);

      const secKey = page.section ?? 'content';
      lesson.sections[secKey] = (lesson.sections[secKey] || '') + '\n' + page.rawText;
    }

    const chapters = Object.values(chaptersMap)
      .sort((a, b) => a.id === 'unknown' ? 1 : b.id === 'unknown' ? -1 : a.id - b.id)
      .map(ch => ({ ...ch, lessons: Object.values(ch.lessons).sort((a, b) => a.id - b.id) }));

    return {
      meta: {
        ...metadata,
        scrapedAt:     new Date().toISOString(),
        totalPages:    annotated.length,
        totalChapters: chapters.filter(c => c.id !== 'unknown').length,
      },
      chapters,
    };
  }

  // ── Entry ──────────────────────────────────────────────────────────────────

  function detect(pages, metadata = {}) {
    const { chapterMap, tocPageNums } = parseTOC(pages);

    // Debug info stored on window for inspection
    window._lcDebug = { chapterMap, tocPageNums: [...tocPageNums] };
    console.log('[LessonCraft] Chapter map:', chapterMap);
    console.log('[LessonCraft] TOC pages:', [...tocPageNums]);

    const annotated = sweepBody(pages, chapterMap, tocPageNums);
    const tree      = buildTree(annotated, { ...metadata, chapterMap });
    return { tree, annotated, chapterMap, tocPageNums };
  }

  return { detect, PATTERNS };

})();
