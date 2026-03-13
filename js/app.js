/**
 * app.js
 * UI controller — wires parser, detector, store together.
 * Handles: upload flow, progress display, chapter/lesson browsing, language toggle.
 */

const App = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  let lang = 'ar'; // 'ar' | 'en'
  let currentBookId = null;
  let currentChapterIdx = 0;
  let currentLessonIdx = 0;

  // ── i18n ──────────────────────────────────────────────────────────────────
  const T = {
    ar: {
      appName: 'LessonCraft',
      tagline: 'استخراج منهجي للدروس من الكتب المدرسية',
      uploadTitle: 'ارفع كتاباً',
      uploadHint: 'اسحب ملف PDF هنا أو انقر للاختيار',
      processing: 'جارٍ المعالجة…',
      extracting: 'استخراج الصفحة',
      of: 'من',
      detecting: 'اكتشاف هيكل الفصول…',
      done: 'اكتمل',
      chapters: 'الفصول',
      lessons: 'الدروس',
      lesson: 'الدرس',
      chapter: 'الفصل',
      pages: 'الصفحات',
       sections: {
         warmup: 'التهيئة', explore: 'الاستكشاف', learn: 'تعلم',
         example: 'مثال', exercises: 'تدرب', review: 'مراجعة', content: 'المحتوى',
       },
       flaggedWarning: 'تحتوي بعض الصفحات على خطوط مخصصة أو نص مفقود وقد تحتاج إلى OCR.',
       noLessons: 'لم يتم اكتشاف دروس في هذا الفصل.',
       export: 'تصدير JSON',
       deleteBook: 'حذف',
       myBooks: 'كتبي',
       newBook: 'كتاب جديد',
      storageUsed: 'مساحة مستخدمة',
      kb: 'ك.ب',
      bookTitle: 'عنوان الكتاب',
      grade: 'الصف',
      enterTitle: 'مثال: رياضيات الصف الخامس الجزء الثاني',
      enterGrade: 'مثال: الخامس الابتدائي',
      startScraping: 'ابدأ الاستخراج',
    },
    en: {
      appName: 'LessonCraft',
      tagline: 'Systematic lesson extraction from textbooks',
      uploadTitle: 'Upload a Book',
      uploadHint: 'Drag a PDF here or click to browse',
      processing: 'Processing…',
      extracting: 'Extracting page',
      of: 'of',
      detecting: 'Detecting chapter structure…',
      done: 'Done',
      chapters: 'Chapters',
      lessons: 'Lessons',
      lesson: 'Lesson',
      chapter: 'Chapter',
      pages: 'Pages',
       sections: {
         warmup: 'Warm-up', explore: 'Explore', learn: 'Learn',
         example: 'Example', exercises: 'Exercises', review: 'Review', content: 'Content',
       },
       flaggedWarning: 'Some pages have custom fonts or missing text — consider running OCR.',
      noLessons: 'No lessons detected in this chapter.',
      export: 'Export JSON',
      deleteBook: 'Delete',
      myBooks: 'My Books',
      newBook: 'New Book',
      storageUsed: 'Storage used',
      kb: 'KB',
      bookTitle: 'Book Title',
      grade: 'Grade',
      enterTitle: 'e.g. Math Grade 5 Part 2',
      enterGrade: 'e.g. Grade 5',
      startScraping: 'Start Scraping',
    },
  };

  const t = key => {
    const keys = key.split('.');
    let obj = T[lang];
    for (const k of keys) obj = obj?.[k];
    return obj ?? key;
  };

  // ── DOM Helpers ───────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  // ── Upload Flow ───────────────────────────────────────────────────────────

  function setupUpload() {
    const zone = $('dropzone');
    const input = $('fileInput');

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', e => handleFile(e.target.files[0]));

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file?.type === 'application/pdf') handleFile(file);
    });

    // Import JSON button
    $('importBtn').addEventListener('click', () => $('importInput').click());
    $('importInput').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const bookId = await Store.importJSON(file);
        renderBookList();
        openBook(bookId);
      } catch (err) {
        alert('Invalid file: ' + err.message);
      }
    });
  }

  async function handleFile(file) {
    if (!file) return;

    // Show metadata form
    showMetaForm(file);
  }

  function showMetaForm(file) {
    $('metaForm').classList.remove('hidden');
    $('metaFileName').textContent = file.name;
    $('metaSubmit').onclick = () => startScraping(file, {
      bookTitle: $('inputTitle').value || file.name,
      grade: $('inputGrade').value,
    });
  }

  async function startScraping(file, metadata) {
    $('metaForm').classList.add('hidden');
    showProgress();

    try {
      // Step 1: Load PDF
      const pdfDoc = await Parser.loadPDF(file);
      const totalPages = pdfDoc.numPages;

      // Step 2: Extract all pages
      const pages = await Parser.extractAll(pdfDoc, (current, total) => {
        updateProgress(current, total, `${t('extracting')} ${current} ${t('of')} ${total}`);
      });

      // Step 3: Detect structure
      updateProgress(totalPages, totalPages, t('detecting'));
      const { tree, chapterMap } = Detector.detect(pages, metadata);
      console.log("[LessonCraft] Chapter map:", JSON.stringify(chapterMap));
      if (Object.keys(chapterMap).length === 0) console.warn("[LessonCraft] 26a0 No chapters detected!");

      // Step 4: Save
      const bookId = Store.saveBook(tree, file.name);

      // Step 5: Show result
      hideProgress();
      renderBookList();
      openBook(bookId);

    } catch (err) {
      hideProgress();
      console.error(err);
      alert('Error processing PDF: ' + err.message);
    }
  }

  // ── Progress UI ───────────────────────────────────────────────────────────

  function showProgress() {
    $('progressPanel').classList.remove('hidden');
    $('uploadPanel').classList.add('hidden');
  }

  function hideProgress() {
    $('progressPanel').classList.add('hidden');
  }

  function updateProgress(current, total, label) {
    const pct = Math.round((current / total) * 100);
    $('progressBar').style.width = pct + '%';
    $('progressLabel').textContent = label;
  }

  // ── Book List ─────────────────────────────────────────────────────────────

  function renderBookList() {
    const books = Store.listBooks();
    const list = $('bookList');
    list.innerHTML = '';

    if (books.length === 0) {
      list.innerHTML = '<p class="empty-hint">—</p>';
      return;
    }

    books.forEach(b => {
      const item = el('div', 'book-item' + (b.bookId === currentBookId ? ' active' : ''));
      item.innerHTML = `
        <span class="book-name">${b.title}</span>
        <span class="book-meta">${b.totalPages || '?'} ${t('pages')} · ${b.totalChapters || '?'} ${t('chapters')}</span>
      `;
      item.addEventListener('click', () => openBook(b.bookId));
      list.appendChild(item);
    });

    $('storageInfo').textContent = `${t('storageUsed')}: ${Store.getStorageUsage()} ${t('kb')}`;
  }

  // ── Book Viewer ───────────────────────────────────────────────────────────

  function openBook(bookId) {
    currentBookId = bookId;
    currentChapterIdx = 0;
    currentLessonIdx = 0;

    const book = Store.getBook(bookId);
    if (!book) return;

    // Switch to viewer
    $('uploadPanel').classList.add('hidden');
    $('viewerPanel').classList.remove('hidden');

    renderBookList(); // update active state

    // Book header
    $('bookTitle').textContent = book.meta?.bookTitle || book.filename;
    $('bookSubtitle').textContent = book.meta?.grade || '';

    // Chapter sidebar
    renderChapterList(book);
    renderLesson(book);
    setTimeout(Layout.apply, 80);

    // Export button
    $('exportBtn').onclick = () => Store.exportJSON(bookId);
    $('deleteBtn').onclick = () => {
      if (confirm('Delete this book?')) {
        Store.deleteBook(bookId);
        currentBookId = null;
        $('viewerPanel').classList.add('hidden');
        $('uploadPanel').classList.remove('hidden');
        renderBookList();
      }
    };
  }

  function renderChapterList(book) {
    const list = $('chapterList');
    list.innerHTML = '';

    book.chapters.forEach((ch, idx) => {
      const item = el('div', 'chapter-item' + (idx === currentChapterIdx ? ' active' : ''));
      item.innerHTML = `<span>${t('chapter')} ${ch.id}</span><span class="ch-lesson-count">${ch.lessons.length} ${t('lessons')}</span>`;
      item.addEventListener('click', () => {
        currentChapterIdx = idx;
        currentLessonIdx = 0;
        renderChapterList(book);
        renderLesson(book);
      });
      list.appendChild(item);
    });
  }

  function renderLesson(book) {
    const chapter = book.chapters[currentChapterIdx];
    if (!chapter) return;

    // Lesson tabs
    const tabBar = $('lessonTabs');
    tabBar.innerHTML = '';

    if (chapter.lessons.length === 0) {
      $('lessonContent').innerHTML = `<p class="empty-hint">${t('noLessons')}</p>`;
      return;
    }

    chapter.lessons.forEach((les, idx) => {
      const tab = el('button', 'lesson-tab' + (idx === currentLessonIdx ? ' active' : ''));
      tab.textContent = `${t('lesson')} ${les.id || idx + 1}`;
      tab.addEventListener('click', () => {
        currentLessonIdx = idx;
        renderLesson(book);
      });
      tabBar.appendChild(tab);
    });

    // Lesson body
      const lesson = chapter.lessons[currentLessonIdx];
      const content = $('lessonContent');
      content.innerHTML = '';

    // Flagged warning
    if (lesson.flaggedPages?.length > 0) {
      const warn = el('div', 'flagged-warning');
      warn.textContent = `⚠ ${t('flaggedWarning')} (${t('pages')}: ${lesson.flaggedPages.join(', ')})`;
      content.appendChild(warn);
    }

    // Page range
    const pageInfo = el('div', 'page-range');
    pageInfo.textContent = `${t('pages')}: ${lesson.pages[0]}–${lesson.pages[lesson.pages.length - 1]}`;
    content.appendChild(pageInfo);

    // Sections
    const sectionOrder = ['warmup', 'explore', 'learn', 'example', 'exercises', 'review', 'content'];
    for (const secKey of sectionOrder) {
      const text = lesson.sections[secKey];
      if (!text) continue;

      const sec = el('div', 'section-block');
      sec.innerHTML = `
        <div class="section-label">${t('sections.' + secKey)}</div>
        <div class="section-text" dir="auto">${escapeHtml(text)}</div>
      `;
      content.appendChild(sec);
    }
    requestAnimationFrame(Layout.apply);
  }

  // ── Language Toggle ───────────────────────────────────────────────────────

  function toggleLang() {
    lang = lang === 'ar' ? 'en' : 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    renderAll();
    Layout.apply();
  }

  function renderAll() {
    // Re-render static text labels
    $('appName').textContent = t('appName');
    $('appTagline').textContent = t('tagline');
    $('uploadTitle').textContent = t('uploadTitle');
    $('uploadHint').textContent = t('uploadHint');
    $('myBooksLabel').textContent = t('myBooks');
    $('newBookBtn').textContent = t('newBook');
    $('langToggle').textContent = lang === 'ar' ? 'EN' : 'عربي';
    $('inputTitle').placeholder = t('enterTitle');
    $('inputGrade').placeholder = t('enterGrade');
    $('metaSubmit').textContent = t('startScraping');
    $('inputTitleLabel').textContent = t('bookTitle');
    $('inputGradeLabel').textContent = t('grade');

    renderBookList();
    if (currentBookId) {
      const book = Store.getBook(currentBookId);
      if (book) { renderChapterList(book); renderLesson(book); }
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    setupUpload();

    $('langToggle').addEventListener('click', toggleLang);
    $('newBookBtn').addEventListener('click', () => {
      $('viewerPanel').classList.add('hidden');
      $('uploadPanel').classList.remove('hidden');
    });

    renderAll();
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', App.init);
// ── Layout Engine ─────────────────────────────────────────────────────────
// Sets pixel-exact top/bottom/left/right on every positioned element.
// Called on load, resize, and after any panel switch.
// This is the ONLY reliable approach for iOS Safari scroll containers.

const Layout = (() => {
  const TOPBAR_H   = 52;   // matches --topbar-h in CSS
  const SIDEBAR_W  = 220;  // matches --sidebar-w
  const CHAPTER_W  = 180;  // matches --chapter-w
  const isRTL = () => document.documentElement.dir === 'rtl';

  function vh() {
    // visualViewport gives the real available height on mobile
    // (excludes browser chrome, keyboard, etc.)
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }

  function apply() {
    const totalH  = vh();
    const bodyH   = totalH - TOPBAR_H;   // height below topbar
    const mainW   = window.innerWidth - SIDEBAR_W;

    // ── main-area: fills right of sidebar ──
    const mainArea = document.querySelector('.main-area');
    if (mainArea) {
      mainArea.style.top    = TOPBAR_H + 'px';
      mainArea.style.bottom = '0px';
      mainArea.style.width  = mainW + 'px';
      if (isRTL()) {
        mainArea.style.right = SIDEBAR_W + 'px';
        mainArea.style.left  = '0px';
      } else {
        mainArea.style.left  = SIDEBAR_W + 'px';
        mainArea.style.right = '0px';
      }
    }

    // ── viewer-header ──
    const viewerHeader = document.querySelector('.viewer-header');
    if (!viewerHeader) return;
    const headerH = viewerHeader.offsetHeight;

    // ── chapter column ──
    const chapterCol = document.getElementById('chapterCol');
    if (chapterCol) {
      chapterCol.style.top    = headerH + 'px';
      chapterCol.style.bottom = '0px';
      chapterCol.style.width  = CHAPTER_W + 'px';
    }

    // ── lesson column ──
    const lessonCol = document.getElementById('lessonCol');
    if (lessonCol) {
      lessonCol.style.top    = headerH + 'px';
      lessonCol.style.bottom = '0px';
      const lessonW = mainW - CHAPTER_W;
      lessonCol.style.width = lessonW + 'px';
      if (isRTL()) {
        lessonCol.style.left  = '0px';
        lessonCol.style.right = CHAPTER_W + 'px';
      } else {
        lessonCol.style.right = '0px';
        lessonCol.style.left  = CHAPTER_W + 'px';
      }
    }

    // ── lesson tabs ──
    const tabs = document.getElementById('lessonTabs');
    const content = document.getElementById('lessonContent');
    if (tabs && content) {
      const tabsH = tabs.offsetHeight;
      // lessonContent fills from below tabs to bottom of lesson col
      content.style.top    = tabsH + 'px';
      content.style.bottom = '0px';
    }
  }

  function init() {
    apply();
    window.addEventListener('resize', apply);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', apply);
      window.visualViewport.addEventListener('scroll', apply);
    }
  }

  return { init, apply };
})();

document.addEventListener('DOMContentLoaded', () => {
  Layout.init();
  document.fonts?.ready?.then(Layout.apply);
});
