/**
 * detector.js — v4
 *
 * TOC format (Saudi math textbook, two-column RTL):
 *   Line A: Arabic title + two chapter numbers (1–20) e.g. "تافعاضلماو مضاوقلا 8 لامتحلااو 7"
 *   Line B+: dots lines with two page numbers (>=10) e.g. "50 ........... 12 ..........."
 *
 * Pairing rule (verified against real TOC):
 *   Sort chapter nums ascending → sort page nums ascending → zip
 *   (Both sorted ascending = visual RTL right-to-left reading order)
 */

const Detector = (() => {

  // ── Patterns ──────────────────────────────────────────────────────────────
  const PATTERNS = {
    chapter: [/الفصل\s*(\d+)/, /لصفلا\s*(\d+)/, /(\d+)\s*لصفلا/, /(\d+)\s*الفصل/],
    lesson:  [/الدرس\s*(\d+)/, /سردلا\s*(\d+)/, /(\d+)\s*سردلا/, /(\d+)\s*الدرس/],
    sections: {
      warmup:    [/التهيئة/, /ةئيهتلا/],
      explore:   [/الاستكشاف/, /فاشكتسا/, /فاشكتسلاا/, /فاشكتسلإا/],
      learn:     [/تعلم/, /ملعت/, /أتعلم/, /ملعتأ/],
      example:   [/مثال/, /لاثم/],
      exercises: [/تدرب/, /برّدت/, /تمارين/, /نيرامت/],
      review:    [/مراجعة/, /ةعجارم/],
    },
  };

  const TOC_SCAN_PAGES  = 12;
  const HEADING_FONT_MIN = 10;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const hasArabic = s => /[\u0600-\u06FF]/.test(s);
  const allNums   = s => [...s.matchAll(/\b(\d+)\b/g)].map(m => parseInt(m[1], 10));

  function matchAny(text, patterns) {
    for (const p of patterns) { const m = text.match(p); if (m) return m; }
    return null;
  }

  function detectSection(text) {
    for (const [name, pats] of Object.entries(PATTERNS.sections)) {
      if (matchAny(text, pats)) return name;
    }
    return null;
  }

  function normalizeDigits(s) {
    return s.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660);
  }

  // ── Pass 1: TOC Parser ─────────────────────────────────────────────────────
  function parseTOC(pages) {
    const chapterMap  = {};
    const tocPageNums = new Set();

    for (const page of pages.slice(0, TOC_SCAN_PAGES)) {
      const raw  = normalizeDigits(page.rawText);
      const dots = (raw.match(/\.{4,}/g) || []).length;
      const ellp = (raw.match(/ … /g)    || []).length;
      if (dots < 2 && ellp < 2) continue;   // not a TOC page

      tocPageNums.add(page.pageNum);

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nums = allNums(line);

        // Chapter title line: has Arabic + contains small integers (chapter numbers)
        const chNums = nums.filter(n => n >= 1 && n <= 20);
        if (!hasArabic(line) || chNums.length === 0) continue;

        // Collect page numbers from the next 1–5 lines
        const pageNums = [];
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const nxt = allNums(lines[j]);
          for (const n of nxt) {
            if (n >= 10 && !chNums.includes(n)) pageNums.push(n);
          }
          if (pageNums.length >= chNums.length) break;
        }

        if (pageNums.length === 0) continue;

        // Sort both ascending → pair positionally (matches RTL visual order)
        const sortedCh = [...chNums].sort((a, b) => a - b);
        const sortedPg = [...pageNums].sort((a, b) => a - b);

        for (let k = 0; k < Math.min(sortedCh.length, sortedPg.length); k++) {
          if (!(sortedCh[k] in chapterMap)) {
            chapterMap[sortedCh[k]] = sortedPg[k];
          }
        }
      }
    }

    console.log('[LessonCraft] TOC pages:', [...tocPageNums]);
    console.log('[LessonCraft] Chapter map:', chapterMap);
    return { chapterMap, tocPageNums };
  }

  // ── Page→Chapter range map ─────────────────────────────────────────────────
  function buildPageChapterMap(chapterMap, totalPages) {
    const entries = Object.entries(chapterMap)
      .map(([n, p]) => ({ num: parseInt(n, 10), page: p }))
      .sort((a, b) => a.page - b.page);

    const map = {};
    for (let i = 0; i < entries.length; i++) {
      const start = entries[i].page;
      const end   = i + 1 < entries.length ? entries[i + 1].page - 1 : totalPages;
      for (let p = start; p <= end; p++) map[p] = entries[i].num;
    }
    return map;
  }

  // ── Pass 2: Body Sweep ─────────────────────────────────────────────────────
  function sweepBody(pages, chapterMap, tocPageNums) {
    const pageToChapter = buildPageChapterMap(chapterMap, pages.length);
    const minPage = Object.keys(chapterMap).length > 0
      ? Math.min(...Object.values(chapterMap)) : 1;

    let curChapter = null, curLesson = null, curSection = null;
    const annotated = [];

    for (const page of pages) {
      if (tocPageNums.has(page.pageNum)) continue;   // skip TOC
      if (page.pageNum < minPage) continue;           // skip front matter

      // Chapter from range map
      if (pageToChapter[page.pageNum] !== undefined) {
        const mapped = pageToChapter[page.pageNum];
        if (mapped !== curChapter) {
          curChapter = mapped;
          curLesson  = null;
          curSection = null;
        }
      }

      // Scan lines for lesson / section headings
      for (const line of (page.lines || [])) {
        const text = normalizeDigits(line.text.trim());
        if (text.length < 2) continue;

        // Chapter override from body text
        if (line.fontSize >= 12) {
          const m = matchAny(text, PATTERNS.chapter);
          if (m) { curChapter = parseInt(m[1], 10); curLesson = null; curSection = null; continue; }
        }

        // Lesson boundary
        if (line.fontSize >= HEADING_FONT_MIN) {
          const m = matchAny(text, PATTERNS.lesson);
          if (m) { curLesson = parseInt(m[1], 10); curSection = null; continue; }
        }

        // Section tag
        const sec = detectSection(text);
        if (sec) curSection = sec;
      }

      annotated.push({
        pageNum: page.pageNum,
        chapter: curChapter,
        lesson:  curLesson,
        section: curSection,
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

      const ch = chaptersMap[chId];
      if (!ch.lessons[lesId])
        ch.lessons[lesId] = { id: lesId, title: '', pages: [], sections: {}, flaggedPages: [] };

      const les = ch.lessons[lesId];
      les.pages.push(page.pageNum);
      if (page.flagged) les.flaggedPages.push(page.pageNum);

      const sec = page.section ?? 'content';
      les.sections[sec] = (les.sections[sec] || '') + '\n' + page.rawText;
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
    const annotated = sweepBody(pages, chapterMap, tocPageNums);
    const tree      = buildTree(annotated, { ...metadata, chapterMap });
    return { tree, annotated, chapterMap, tocPageNums };
  }

  return { detect, PATTERNS };

})();
