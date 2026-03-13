/**
 * detector.js — v6
 *
 * Arabic-textbook structure detection strategy
 * ─────────────────────────────────────────────
 *
 * The textbook has three kinds of landmark pages:
 *
 *   1. Chapter cover  — standalone page whose TOP LINES contain
 *                       "الفصل N" (or reversed "لصفلا N") in a large font.
 *                       The line(s) following it are the chapter title.
 *
 *   2. Warmup         — "التهيئة" anywhere in the page text.
 *                       Stored as lesson "intro" (NOT lesson 1).
 *
 *   3. Lesson pages   — HEADER LINE (first 1-4 lines only) contains
 *                       the pattern  "lessonNum - chapterNum"
 *                       e.g.  "1 - 7"  or  "٢ - ٨"  (after digit normalisation).
 *                       Restricting the search to the header prevents false
 *                       matches from exercise numbers inside the page body.
 *
 *   4. Mid-term test  — "منتصف فصل" / "اختبار منتصف الفصل" anywhere.
 *                       Stored as lesson "midtest".
 *
 * Pass 1  — TOC parser:  builds chapter→startPage map from dotted-leader pages.
 * Pass 1b — Cover scan:  detects chapter cover pages to supplement/confirm TOC
 *                        and extract chapter titles.
 * Pass 2  — Body sweep:  annotates every body page with {chapter, lesson, section}.
 * Pass 3  — Build tree:  groups annotated pages into the final chapter/lesson tree.
 *
 * TOC pairing rule (unchanged from v5, verified on real PDFs):
 *   Title line has Arabic + 2 chapter nums (1–20).
 *   Next lines have page nums (≥10), sometimes split across lines.
 *   Sort both ascending → zip → chapter→startPage map.
 */

const Detector = (() => {

  // ── Patterns ──────────────────────────────────────────────────────────────

  // Lesson-header marker: "lessonNum - chapterNum" — e.g. "1 - 7" or "٢ - ٨"
  // Checked ONLY against the first 1-4 lines of a page (the header area),
  // never against the full page text, to eliminate false positives from
  // exercise / equation numbers in the page body.
  const LESSON_MARKER = /(?:^|[\s\u0600-\u06FF])(\d{1,2})\s*-\s*(\d{1,2})(?:$|[\s\u0600-\u06FF])/;

  // Chapter cover: "الفصل N" (forward) or "لصفلا N" (reversed visual-order)
  // or "N الفصل" / "N لصفلا" (when number precedes the word).
  const CHAPTER_COVER_WORD = /(?:الفصل|لصفلا)/;
  const CHAPTER_COVER_RE   = /(?:الفصل|لصفلا)\s*(\d{1,2})|(\d{1,2})\s*(?:الفصل|لصفلا)/;

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
    // Convert Arabic-Indic digits (٠-٩) to Western Arabic (0-9)
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

  /**
   * Build the "header text" for a page: join the first few lines
   * (after digit normalisation) into a single string.
   * This is the ONLY text used for lesson-marker detection.
   */
  function pageHeaderText(page, maxLines = 4) {
    return normalizeDigits(
      (page.lines || []).slice(0, maxLines).map(l => l.text).join(' ')
    );
  }

  // ── Pass 1: TOC Parser ────────────────────────────────────────────────────

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

        // Sort ascending → pair (matches visual RTL order in TOC)
        const sc = [...chNums].sort((a, b) => a - b);
        const sp = [...pageNums].sort((a, b) => a - b);
        sc.forEach((ch, k) => {
          if (k < sp.length && !(ch in chapterMap)) chapterMap[ch] = sp[k];
        });
      }
    }

    console.log('[LessonCraft] TOC chapter map:', chapterMap);
    console.log('[LessonCraft] TOC pages:', [...tocPageNums]);
    return { chapterMap, tocPageNums };
  }

  // ── Pass 1b: Chapter Cover Scan ───────────────────────────────────────────
  //
  // Walk every non-TOC page and detect chapter cover pages.
  // A cover page satisfies ALL of:
  //   • Contains CHAPTER_COVER_RE in its top 3 lines (after digit normalisation)
  //   • The matched chapter number is ≥ 1 and ≤ 30
  //   • Has ≤ 10 non-empty lines total (cover pages are sparse; body pages have many)
  //
  // Returns:
  //   coverMap  – { chapterNum → { pageNum, title } }
  //              (title extracted from lines following the chapter-number line)

  function scanCovers(pages, tocPageNums) {
    const coverMap = {};

    for (const page of pages) {
      if (tocPageNums.has(page.pageNum)) continue;

      const lines    = page.lines || [];
      const nonEmpty = lines.filter(l => l.text.trim()).length;
      if (nonEmpty > 10) continue;  // body pages have many lines; covers have ≤10

      // Check first 3 lines for "الفصل N"
      const topText = normalizeDigits(lines.slice(0, 3).map(l => l.text).join(' '));
      if (!CHAPTER_COVER_WORD.test(topText)) continue;

      const m = topText.match(CHAPTER_COVER_RE);
      if (!m) continue;
      const chNum = parseInt(m[1] || m[2], 10);
      if (chNum < 1 || chNum > 30) continue;

      // Extract chapter title: first Arabic-text line(s) that are NOT the chapter number line
      const titleParts = lines
        .slice(0, 6)
        .map(l => l.text.trim())
        .filter(t => t && !/^\d+$/.test(t) && !CHAPTER_COVER_WORD.test(t));
      const title = titleParts.join(' ').trim();

      if (!(chNum in coverMap)) {
        coverMap[chNum] = { pageNum: page.pageNum, title };
        console.log(`[LessonCraft] Cover: ch${chNum} p${page.pageNum} "${title}"`);
      }
    }

    return coverMap;
  }

  // ── Page→Chapter range map ────────────────────────────────────────────────

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

  // ── Pass 2: Page-by-page sweep ────────────────────────────────────────────

  function sweepBody(pages, chapterMap, tocPageNums, coverMap) {
    // Merge TOC map with cover-scan map: TOC takes precedence for page start,
    // but cover map fills gaps and provides titles.
    const mergedChapterMap = { ...chapterMap };
    for (const [ch, info] of Object.entries(coverMap)) {
      if (!(ch in mergedChapterMap)) mergedChapterMap[ch] = info.pageNum;
    }

    const pageToChapter = buildPageChapterMap(mergedChapterMap, pages.length);
    const minPage = Object.keys(mergedChapterMap).length > 0
      ? Math.min(...Object.values(mergedChapterMap)) : 1;

    let curChapter = null;
    let curLesson  = null;  // null = warmup/intro; 'midtest' = mid-term; number = lesson
    let curSection = null;
    const annotated = [];

    for (const page of pages) {
      // Skip TOC and front-matter
      if (tocPageNums.has(page.pageNum)) continue;
      if (page.pageNum < minPage)        continue;

      const rawN   = normalizeDigits(page.rawText || '');

      // Header text (top 4 lines only) — used exclusively for structural markers.
      // Restricting to the header prevents lesson-number false-positives from
      // exercise sequences, equation indices etc. in the page body.
      const hdrText = pageHeaderText(page, 4);

      // ── 1. Chapter boundary from range map ──────────────────────────────
      if (pageToChapter[page.pageNum] !== undefined) {
        const mapped = pageToChapter[page.pageNum];
        if (mapped !== curChapter) {
          curChapter = mapped;
          curLesson  = null;  // reset to "intro" state until a lesson marker is found
          curSection = null;
        }
      }

      // ── 2. Chapter cover page — skip it (it's a landmark, not content) ──
      if (CHAPTER_COVER_WORD.test(hdrText) && CHAPTER_COVER_RE.test(hdrText)) {
        const cm = hdrText.match(CHAPTER_COVER_RE);
        if (cm) {
          const covCh = parseInt(cm[1] || cm[2], 10);
          if (covCh >= 1 && covCh <= 30) {
            curChapter = covCh;
            curLesson  = null;
            curSection = null;
            // Don't push this page into annotated — it's structural decoration
            continue;
          }
        }
      }

      // ── 3. Mid-chapter test ─────────────────────────────────────────────
      // Check BEFORE lesson marker because mid-test pages contain "4-7" etc.
      if (/منتصف|فصتنم/.test(rawN)) {
        curLesson  = 'midtest';
        curSection = null;
        annotated.push({
          pageNum: page.pageNum, chapter: curChapter,
          lesson: curLesson, section: curSection,
          rawText: page.rawText, lines: page.lines, flagged: page.flagged,
        });
        continue;
      }

      // ── 4. Lesson marker in HEADER ONLY ─────────────────────────────────
      const lm = hdrText.match(LESSON_MARKER);
      if (lm) {
        const n1 = parseInt(lm[1], 10);
        const n2 = parseInt(lm[2], 10);
        let lessonNum = null;
        // The chapter number is whichever matches curChapter or is in mergedChapterMap
        if (n2 === curChapter || n2 in mergedChapterMap) {
          lessonNum  = n1;
          curChapter = n2;
        } else if (n1 === curChapter || n1 in mergedChapterMap) {
          lessonNum  = n2;
          curChapter = n1;
        } else {
          // Fallback: lesson numbers are 1-8, chapter numbers are higher
          lessonNum  = Math.min(n1, n2);
          curChapter = Math.max(n1, n2);
        }
        if (lessonNum !== curLesson) {
          curLesson  = lessonNum;
          curSection = null;
        }
      }

      // ── 5. Warmup — marks intro pages before lesson 1 ───────────────────
      if (curLesson === null && matchAny(rawN, SECTION_PATTERNS.warmup)) {
        curSection = 'warmup';
      }

      // ── 6. Section detection (only inside numbered lessons) ─────────────
      if (curLesson !== null && curLesson !== 'midtest') {
        for (const line of (page.lines || [])) {
          const sec = detectSection(normalizeDigits(line.text));
          if (sec) { curSection = sec; break; }
        }
      }

      annotated.push({
        pageNum:  page.pageNum,
        chapter:  curChapter,
        lesson:   curLesson,
        section:  curSection,
        rawText:  page.rawText,
        lines:    page.lines,
        flagged:  page.flagged,
      });
    }

    return { annotated };
  }

  // ── Pass 3: Build Tree ────────────────────────────────────────────────────

  function buildTree(annotated, metadata = {}, coverMap = {}) {
    const chaptersMap = {};

    for (const page of annotated) {
      const chId  = page.chapter ?? 'unknown';
      const lesId = page.lesson !== null ? page.lesson : 'intro';

      if (!chaptersMap[chId]) {
        // Use title from cover-scan map if available
        const coverTitle = coverMap[chId]?.title || '';
        chaptersMap[chId] = { id: chId, title: coverTitle, lessons: {}, pages: [] };
      }
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
      // Append with a newline separator to keep pages distinct within a section
      les.sections[sec] = (les.sections[sec] || '') + '\n' + page.rawText;
    }

    // Sort chapters ascending; within each chapter sort: intro → 1,2,3... → midtest
    const chapters = Object.values(chaptersMap)
      .sort((a, b) => a.id === 'unknown' ? 1 : b.id === 'unknown' ? -1 : a.id - b.id)
      .map(ch => ({
        ...ch,
        lessons: Object.values(ch.lessons).sort((a, b) => {
          if (a.id === 'intro')   return -1;
          if (b.id === 'intro')   return  1;
          if (a.id === 'midtest') return  1;
          if (b.id === 'midtest') return -1;
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
    const coverMap                    = scanCovers(pages, tocPageNums);
    const { annotated }               = sweepBody(pages, chapterMap, tocPageNums, coverMap);
    const tree                        = buildTree(annotated, { ...metadata, chapterMap }, coverMap);
    return { tree, annotated, chapterMap, tocPageNums };
  }

  return { detect, PATTERNS: SECTION_PATTERNS };

})();
