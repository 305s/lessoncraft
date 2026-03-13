/**
 * detector.js — v5
 *
 * Structure confirmed from real PDF:
 *
 *   Chapter cover  → page with standalone chapter number + title (e.g. "الفصل ٧")
 *   Warmup         → "التهيئة" — chapter intro, stored as lesson "intro", NOT lesson 1
 *   Lesson pages   → marked "{lesson} - {chapter}" at top e.g. "1 - 7" or "٢ - ٨"
 *   Mid-term test  → "فصتنم رابتخا" — stored as lesson "midtest", not a real lesson
 *
 * TOC pairing rule (verified):
 *   Title line has Arabic + 2 chapter nums (1–20)
 *   Next lines have page nums (>=10), sometimes split across lines
 *   Sort both ascending → zip → chapter→startPage map
 */

const Detector = (() => {

  // ── Patterns ──────────────────────────────────────────────────────────────

  // "1 - 7" or "2-8" or "١ - ٧" (after digit normalization)
  // Must appear near the top of the page — matched on first 300 chars
  const LESSON_MARKER = /\b(\d{1,2})\s*-\s*(\d{1,2})\b/;

  const SECTION_PATTERNS = {
    warmup:    [/التهيئة/, /ةئيهتلا/, /ةُ\s*ئَ\s*يِ\s*هتَّ/, /ةُ\s*ـ+ئَ\s*يِ\s*هتَّ/],
    explore:   [/الاستكشاف/, /فاشكتسا/, /فاشكتسلاا/],
    learn:     [/تعلم/, /ملعت/, /أتعلم/],
    example:   [/مثال/, /لاثم/],
    exercises: [/تدرب/, /برّدت/, /تمارين/, /نيرامت/],
    review:    [/مراجعة/, /ةعجارم/],
  };

  const TOC_SCAN_PAGES = 12;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const hasArabic = s => /[\u0600-\u06FF]/.test(s);
  const allNums   = s => [...s.matchAll(/\b(\d+)\b/g)].map(m => parseInt(m[1], 10));

  function normalizeDigits(s) {
    return (s || '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660);
  }

  function matchAny(text, patterns) {
    for (const p of patterns) { const m = text.match(p); if (m) return m; }
    return null;
  }

  function detectSection(text) {
    for (const [name, pats] of Object.entries(SECTION_PATTERNS)) {
      if (matchAny(text, pats)) return name;
    }
    return null;
  }

  // ── Pass 1: TOC Parser ─────────────────────────────────────────────────────

  function parseTOC(pages) {
    const chapterMap  = {};
    const tocPageNums = new Set();

    for (const page of pages.slice(0, TOC_SCAN_PAGES)) {
      const raw  = normalizeDigits(page.rawText);
      const dots = (raw.match(/\.{4,}/g) || []).length;
      const ellp = (raw.match(/ … /g)    || []).length;
      if (dots < 2 && ellp < 2) continue;

      tocPageNums.add(page.pageNum);
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const line   = lines[i];
        const nums   = allNums(line);
        const chNums = nums.filter(n => n >= 1 && n <= 20);
        if (!hasArabic(line) || chNums.length === 0) continue;

        // Collect page nums from the next few lines
        const pageNums = [];
        for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
          for (const n of allNums(lines[j])) {
            if (n >= 10 && !chNums.includes(n)) pageNums.push(n);
          }
          if (pageNums.length >= chNums.length) break;
        }
        if (!pageNums.length) continue;

        // Sort ascending → pair (matches visual RTL order)
        const sc = [...chNums].sort((a, b) => a - b);
        const sp = [...pageNums].sort((a, b) => a - b);
        sc.forEach((ch, k) => {
          if (k < sp.length && !(ch in chapterMap)) chapterMap[ch] = sp[k];
        });
      }
    }

    console.log('[LessonCraft] Chapter map:', chapterMap);
    console.log('[LessonCraft] TOC pages:', [...tocPageNums]);
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

  // ── Pass 2: Page-by-page sweep ─────────────────────────────────────────────

  function sweepBody(pages, chapterMap, tocPageNums) {
    const pageToChapter = buildPageChapterMap(chapterMap, pages.length);
    const minPage = Object.keys(chapterMap).length > 0
      ? Math.min(...Object.values(chapterMap)) : 1;

    let curChapter = null;
    let curLesson  = null;   // null = warmup/intro, 'midtest' = midterm, number = lesson
    let curSection = null;
    const annotated = [];

    for (const page of pages) {
      // Skip TOC and front-matter
      if (tocPageNums.has(page.pageNum)) continue;
      if (page.pageNum < minPage) continue;

      const rawN   = normalizeDigits(page.rawText || '');
      // Only check top of page for lesson marker (it's always in header area)
      const topN   = rawN.slice(0, 400);

      // ── 1. Chapter boundary from range map ──
      if (pageToChapter[page.pageNum] !== undefined) {
        const mapped = pageToChapter[page.pageNum];
        if (mapped !== curChapter) {
          curChapter = mapped;
          curLesson  = null;   // reset to "intro" state until lesson marker found
          curSection = null;
        }
      }

      // ── 2. Mid-chapter test (check BEFORE lesson marker — midtest pages contain "4-7" etc.) ──
      if (/فصتنم|لصفلا فصتنم/.test(rawN)) {
        curLesson  = 'midtest';
        curSection = null;
        annotated.push({ pageNum: page.pageNum, chapter: curChapter, lesson: curLesson, section: curSection, rawText: page.rawText, lines: page.lines, flagged: page.flagged });
        continue;
      }

      // ── 3. Lesson marker "N - M" at top of page ──
      const lm = topN.match(LESSON_MARKER);
      if (lm) {
        const n1 = parseInt(lm[1], 10);
        const n2 = parseInt(lm[2], 10);
        // The chapter number is whichever matches curChapter or is in chapterMap
        // The lesson number is the other one (always smaller, 1–8 range)
        let lessonNum = null;
        if (n2 === curChapter || n2 in chapterMap) {
          lessonNum  = n1;
          curChapter = n2;
        } else if (n1 === curChapter || n1 in chapterMap) {
          lessonNum  = n2;
          curChapter = n1;
        } else {
          // Fallback: smaller = lesson, larger = chapter
          lessonNum  = Math.min(n1, n2);
          curChapter = Math.max(n1, n2);
        }
        if (lessonNum !== curLesson) {
          curLesson  = lessonNum;
          curSection = null;
        }
      }

      // ── 4. Warmup (التهيئة) — marks intro pages before lesson 1 ──
      if (curLesson === null && /ةئيهتلا|التهيئة/.test(rawN)) {
        curSection = 'warmup';
      }

      // ── 5. Section detection ──
      if (curLesson !== null && curLesson !== 'midtest') {
        for (const line of (page.lines || [])) {
          const sec = detectSection(normalizeDigits(line.text));
          if (sec) { curSection = sec; break; }
        }
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
      // null lesson = intro/warmup pages before lesson 1
      const lesId = page.lesson !== null ? page.lesson : 'intro';

      if (!chaptersMap[chId])
        chaptersMap[chId] = { id: chId, title: '', lessons: {}, pages: [] };
      chaptersMap[chId].pages.push(page.pageNum);

      const ch = chaptersMap[chId];
      if (!ch.lessons[lesId]) {
        ch.lessons[lesId] = {
          id:           lesId,
          title:        lesId === 'intro' ? 'التهيئة' : lesId === 'midtest' ? 'اختبار الفصل' : '',
          pages:        [],
          sections:     {},
          flaggedPages: [],
        };
      }

      const les = ch.lessons[lesId];
      les.pages.push(page.pageNum);
      if (page.flagged) les.flaggedPages.push(page.pageNum);

      const sec = page.section ?? 'content';
      les.sections[sec] = (les.sections[sec] || '') + '\n' + page.rawText;
    }

    // Sort chapters ascending; within each chapter sort: intro → 1,2,3... → midtest
    const chapters = Object.values(chaptersMap)
      .sort((a, b) => a.id === 'unknown' ? 1 : b.id === 'unknown' ? -1 : a.id - b.id)
      .map(ch => ({
        ...ch,
        lessons: Object.values(ch.lessons).sort((a, b) => {
          if (a.id === 'intro')    return -1;
          if (b.id === 'intro')    return  1;
          if (a.id === 'midtest')  return  1;
          if (b.id === 'midtest')  return -1;
          return a.id - b.id;
        }),
      }));

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

  return { detect, PATTERNS: SECTION_PATTERNS };

})();
