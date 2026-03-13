/**
 * app.js
 * UI controller — wires parser, detector, store, summarizer, students together.
 * Handles: upload flow, progress display, chapter/lesson browsing, language toggle,
 *          lesson summary, homework creation, student management, dashboard.
 */

const App = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  let lang = 'ar'; // 'ar' | 'en'
  let currentBookId    = null;
  let currentChapterIdx = 0;
  let currentLessonIdx  = 0;
  let currentViewMode   = 'content'; // 'content' | 'summary' | 'homework'
  let currentTopPanel   = 'books';   // 'books' | 'dashboard' | 'homework' | 'students'

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
      flaggedWarning: 'تحتوي بعض الصفحات على خطوط مخصصة وقد لا يكون النص مقروءاً.',
      noLessons: 'لم يتم اكتشاف دروس في هذا الفصل.',
      selectLesson: 'اختر درساً',
      lessonTitleSep: ' — ',
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
      // Summary
      summaryTitle: 'ملخص الدرس',
      objectives: 'أهداف التعلم',
      keyTerms: 'المصطلحات',
      mainPoints: 'أبرز النقاط',
      noSummary: 'لا يوجد محتوى كافٍ لإنشاء ملخص.',
      // Homework
      homeworkTitle: 'إنشاء واجب',
      hwTitleLabel: 'عنوان الواجب',
      hwDueDate: 'تاريخ التسليم',
      hwQuestions: 'الأسئلة',
      hwSuggest: 'اقتراحات من الكتاب',
      hwSave: 'حفظ الواجب',
      hwSaved: 'تم حفظ الواجب ✓',
      hwNone: 'لا توجد واجبات لهذا الكتاب.',
      // Dashboard
      dashboard: 'لوحة القيادة',
      dashBooks: 'الكتب',
      dashLessons: 'الدروس',
      dashHW: 'الواجبات',
      dashStudents: 'الطلاب',
      dashAvg: 'متوسط الدرجات',
      // Students
      students: 'الطلاب',
      addStudent: '+ إضافة طالب',
      studentName: 'الاسم',
      studentGrade: 'الصف',
      noStudents: 'لا يوجد طلاب مسجلون.',
      graderTitle: 'تصحيح الواجب',
      gradeLabel: 'الدرجة',
      outOf: 'من',
      saveGrade: 'حفظ',
      avgGrade: 'متوسط',
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
      flaggedWarning: 'Some pages use custom fonts — text may not be fully readable.',
      noLessons: 'No lessons detected in this chapter.',
      selectLesson: 'Select a lesson',
      lessonTitleSep: ' — ',
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
      // Summary
      summaryTitle: 'Lesson Summary',
      objectives: 'Learning Objectives',
      keyTerms: 'Key Terms',
      mainPoints: 'Main Points',
      noSummary: 'Not enough content to generate a summary.',
      // Homework
      homeworkTitle: 'Create Homework',
      hwTitleLabel: 'Homework Title',
      hwDueDate: 'Due Date',
      hwQuestions: 'Questions',
      hwSuggest: 'Suggestions from book',
      hwSave: 'Save Homework',
      hwSaved: 'Homework saved ✓',
      hwNone: 'No homework for this book.',
      // Dashboard
      dashboard: 'Dashboard',
      dashBooks: 'Books',
      dashLessons: 'Lessons',
      dashHW: 'Homework',
      dashStudents: 'Students',
      dashAvg: 'Avg. Grade',
      // Students
      students: 'Students',
      addStudent: '+ Add Student',
      studentName: 'Name',
      studentGrade: 'Grade',
      noStudents: 'No students registered.',
      graderTitle: 'Grade Homework',
      gradeLabel: 'Score',
      outOf: 'out of',
      saveGrade: 'Save',
      avgGrade: 'Average',
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

  // ── Top-level panel switching ─────────────────────────────────────────────

  function switchTopPanel(panel) {
    currentTopPanel = panel;
    const panels = ['books', 'dashboard', 'homework', 'students'];
    for (const p of panels) {
      const sec = $(`${p}Section`);
      if (sec) sec.classList.toggle('active-section', p === panel);
    }
    // Sidebar only shown for books
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = panel === 'books' ? '' : 'none';

    // Update nav tab active state
    for (const btn of document.querySelectorAll('.nav-tab')) {
      btn.classList.toggle('active', btn.dataset.panel === panel);
    }

    setTimeout(Layout.apply, 80);

    // Re-render the switched panel
    if (panel === 'dashboard') renderDashboard();
    if (panel === 'homework')  renderHomeworkPanel();
    if (panel === 'students')  renderStudentsPanel();
  }

  // ── Upload Flow ───────────────────────────────────────────────────────────

  function setupUpload() {
    const zone  = $('dropzone');
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
      const pdfDoc    = await Parser.loadPDF(file);
      const totalPages = pdfDoc.numPages;

      // Step 2: Extract all pages
      const pages = await Parser.extractAll(pdfDoc, (current, total) => {
        updateProgress(current, total, `${t('extracting')} ${current} ${t('of')} ${total}`);
      });

      // Step 3: Detect structure
      updateProgress(totalPages, totalPages, t('detecting'));
      const { tree, chapterMap } = Detector.detect(pages, metadata);
      console.log('[LessonCraft] Chapter map:', JSON.stringify(chapterMap));
      if (Object.keys(chapterMap).length === 0) console.warn('[LessonCraft] ⚠ No chapters detected!');

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
    const list  = $('bookList');
    list.innerHTML = '';

    if (books.length === 0) {
      list.innerHTML = '<p class="empty-hint">—</p>';
      return;
    }

    books.forEach(b => {
      const item = el('div', 'book-item' + (b.bookId === currentBookId ? ' active' : ''));
      item.innerHTML = `
        <span class="book-name">${escapeHtml(b.title)}</span>
        <span class="book-meta">${b.totalPages || '?'} ${t('pages')} · ${b.totalChapters || '?'} ${t('chapters')}</span>
      `;
      item.addEventListener('click', () => openBook(b.bookId));
      list.appendChild(item);
    });

    $('storageInfo').textContent = `${t('storageUsed')}: ${Store.getStorageUsage()} ${t('kb')}`;
  }

  // ── Book Viewer ───────────────────────────────────────────────────────────

  function openBook(bookId) {
    currentBookId     = bookId;
    currentChapterIdx = 0;
    currentLessonIdx  = 0;
    currentViewMode   = 'content';

    const book = Store.getBook(bookId);
    if (!book) return;

    // Switch to books section
    switchTopPanel('books');

    // Switch to viewer
    $('uploadPanel').classList.add('hidden');
    $('viewerPanel').classList.remove('hidden');

    renderBookList(); // update active state

    // Book header
    $('bookTitle').textContent    = book.meta?.bookTitle || book.filename;
    $('bookSubtitle').textContent = book.meta?.grade || '';

    // Chapter sidebar
    renderChapterList(book);
    renderLesson(book);
    setTimeout(Layout.apply, 80);

    // Export / Delete buttons
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
      const titleLine = ch.title
        ? `<span class="ch-title">${escapeHtml(ch.title)}</span>`
        : '';
      item.innerHTML = `
        <span class="ch-num">${t('chapter')} ${ch.id}</span>
        ${titleLine}
        <span class="ch-lesson-count">${ch.lessons.length} ${t('lessons')}</span>
      `;
      item.addEventListener('click', () => {
        currentChapterIdx = idx;
        currentLessonIdx  = 0;
        currentViewMode   = 'content';
        renderChapterList(book);
        renderLesson(book);
      });
      list.appendChild(item);
    });
  }

  function renderLesson(book) {
    const chapter = book.chapters[currentChapterIdx];
    if (!chapter) return;

    // Lesson selector (dropdown)
    const tabBar = $('lessonTabs');
    tabBar.innerHTML = '';

    if (chapter.lessons.length === 0) {
      $('lessonContent').innerHTML = `<p class="empty-hint">${t('noLessons')}</p>`;
      return;
    }

    const select = document.createElement('select');
    select.className = 'lesson-select';
    select.setAttribute('aria-label', t('lessons'));

    chapter.lessons.forEach((les, idx) => {
      const option = document.createElement('option');
      option.value = idx;
      let label;
      if (les.id === 'intro') {
        label = t('sections.warmup');
      } else if (les.id === 'midtest') {
        label = les.title || t('sections.review');
      } else {
        label = les.title
          ? `${t('lesson')} ${les.id}${t('lessonTitleSep')}${les.title}`
          : `${t('lesson')} ${les.id}`;
      }
      option.textContent = label;
      if (idx === currentLessonIdx) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', e => {
      currentLessonIdx = parseInt(e.target.value, 10);
      currentViewMode  = 'content';
      renderLesson(book);
    });

    tabBar.appendChild(select);

    // Wire view-mode tabs
    const viewTabs = $('lessonViewTabs');
    if (viewTabs) {
      for (const btn of viewTabs.querySelectorAll('.view-tab')) {
        btn.classList.toggle('active', btn.dataset.view === currentViewMode);
        btn.onclick = () => {
          currentViewMode = btn.dataset.view;
          for (const b of viewTabs.querySelectorAll('.view-tab')) {
            b.classList.toggle('active', b.dataset.view === currentViewMode);
          }
          renderLessonBody(book);
          setTimeout(Layout.apply, 60);
        };
      }
    }

    renderLessonBody(book);
  }

  function renderLessonBody(book) {
    const chapter = book.chapters[currentChapterIdx];
    const lesson  = chapter?.lessons[currentLessonIdx];
    if (!lesson) return;

    const content = $('lessonContent');
    content.innerHTML = '';

    if (currentViewMode === 'summary') {
      renderSummaryView(lesson, content);
    } else if (currentViewMode === 'homework') {
      renderHomeworkCreationView(lesson, content, book);
    } else {
      renderContentView(lesson, content);
    }
  }

  // ── Content view ──────────────────────────────────────────────────────────

  function renderContentView(lesson, content) {
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
  }

  // ── Summary view ──────────────────────────────────────────────────────────

  function renderSummaryView(lesson, content) {
    const summary = Summarizer.summarize(lesson);
    if (!summary) {
      content.innerHTML = `<p class="empty-hint">${t('noSummary')}</p>`;
      return;
    }

    const hasContent = summary.objectives.length || summary.keyTerms.length ||
                       summary.mainPoints.length || summary.exercises.length;
    if (!hasContent) {
      content.innerHTML = `<p class="empty-hint">${t('noSummary')}</p>`;
      return;
    }

    const wrap = el('div', 'summary-wrap');

    if (summary.title) {
      const title = el('h3', 'summary-title');
      title.textContent = summary.title;
      wrap.appendChild(title);
    }

    const renderList = (heading, items) => {
      if (!items || items.length === 0) return;
      const block = el('div', 'summary-block');
      block.innerHTML = `<div class="summary-block-label">${heading}</div>`;
      const ul = el('ul', 'summary-list');
      for (const item of items) {
        const li = document.createElement('li');
        li.dir = 'auto';
        li.textContent = item;
        ul.appendChild(li);
      }
      block.appendChild(ul);
      wrap.appendChild(block);
    };

    renderList(t('objectives'),  summary.objectives);
    renderList(t('keyTerms'),    summary.keyTerms);
    renderList(t('mainPoints'),  summary.mainPoints);

    if (summary.exercises.length > 0) {
      renderList(t('sections.exercises'), summary.exercises);
    }

    content.appendChild(wrap);
  }

  // ── Homework creation view ─────────────────────────────────────────────────

  function renderHomeworkCreationView(lesson, content, book) {
    const chapter = book.chapters[currentChapterIdx];
    const suggested = Summarizer.suggestHomework(lesson, 6);

    const wrap = el('div', 'hw-create-wrap');

    wrap.innerHTML = `
      <div class="hw-create-form">
        <div class="form-group">
          <label class="form-label">${t('hwTitleLabel')}</label>
          <input id="hwTitleInput" class="form-input" type="text"
            value="${escapeAttr(lesson.title ? `${t('lesson')} ${lesson.id} — ${lesson.title}` : `${t('lesson')} ${lesson.id}`)}" />
        </div>
        <div class="form-group">
          <label class="form-label">${t('hwDueDate')}</label>
          <input id="hwDueDateInput" class="form-input" type="date" />
        </div>
        <div class="form-group">
          <label class="form-label">${t('hwQuestions')}</label>
          <textarea id="hwQuestionsInput" class="form-textarea" rows="6" dir="auto" placeholder="${t('hwSuggest')}…"></textarea>
        </div>
        <div id="hwSuggestBox"></div>
        <button id="hwSaveBtn" class="btn btn-gold">${t('hwSave')}</button>
        <span id="hwSavedMsg" class="hw-saved-msg hidden">${t('hwSaved')}</span>
      </div>
    `;

    content.appendChild(wrap);

    // Pre-fill with suggestions
    if (suggested.length > 0) {
      $('hwQuestionsInput').value = suggested.join('\n');
    }

    // Suggestion chips
    if (suggested.length > 0) {
      const suggestBox = $('hwSuggestBox');
      const label = el('div', 'form-label', t('hwSuggest') + ':');
      suggestBox.appendChild(label);
      const chips = el('div', 'suggest-chips');
      for (const s of suggested) {
        const chip = el('button', 'suggest-chip btn btn-ghost');
        chip.textContent = s.length > 60 ? s.slice(0, 57) + '…' : s;
        chip.title = s;
        chip.type = 'button';
        chip.onclick = () => {
          const ta = $('hwQuestionsInput');
          ta.value = ta.value ? ta.value + '\n' + s : s;
        };
        chips.appendChild(chip);
      }
      suggestBox.appendChild(chips);
    }

    // Save button handler
    $('hwSaveBtn').onclick = () => {
      const title     = $('hwTitleInput').value.trim();
      const dueDate   = $('hwDueDateInput').value;
      const questions = $('hwQuestionsInput').value
        .split('\n')
        .map(q => q.trim())
        .filter(Boolean);

      if (!title) { $('hwTitleInput').focus(); return; }

      Students.createHomework({
        bookId:    book.bookId,
        chapterId: chapter.id,
        lessonId:  lesson.id,
        title,
        questions,
        dueDate,
      });

      const msg = $('hwSavedMsg');
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 2500);
    };
  }

  // ── Language Toggle ───────────────────────────────────────────────────────

  function toggleLang() {
    lang = lang === 'ar' ? 'en' : 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    renderAll();
  }

  function renderAll() {
    // Re-render static text labels
    $('appName').textContent        = t('appName');
    $('appTagline').textContent     = t('tagline');
    $('uploadTitle').textContent    = t('uploadTitle');
    $('uploadHint').textContent     = t('uploadHint');
    $('myBooksLabel').textContent   = t('myBooks');
    $('newBookBtn').textContent     = t('newBook');
    $('langToggle').textContent     = lang === 'ar' ? 'EN' : 'عربي';
    $('inputTitle').placeholder     = t('enterTitle');
    $('inputGrade').placeholder     = t('enterGrade');
    $('metaSubmit').textContent     = t('startScraping');
    $('inputTitleLabel').textContent = t('bookTitle');
    $('inputGradeLabel').textContent = t('grade');

    renderBookList();
    if (currentBookId) {
      const book = Store.getBook(currentBookId);
      if (book) { renderChapterList(book); renderLesson(book); }
    }
    // Re-render visible top panel
    if (currentTopPanel === 'dashboard') renderDashboard();
    if (currentTopPanel === 'homework')  renderHomeworkPanel();
    if (currentTopPanel === 'students')  renderStudentsPanel();
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  function renderDashboard() {
    const wrap = $('dashboardContent');
    if (!wrap) return;
    wrap.innerHTML = '';

    const books   = Store.listBooks();
    const stats   = Students.getStats();
    const hwList  = Students.listHomework();

    // Total lessons
    let totalLessons = 0;
    for (const b of books) {
      const book = Store.getBook(b.bookId);
      if (book) {
        for (const ch of book.chapters) totalLessons += ch.lessons.length;
      }
    }

    // Stat cards
    const statsRow = el('div', 'dash-stats-row');
    const cards = [
      { label: t('dashBooks'),    value: books.length,          icon: '📚' },
      { label: t('dashLessons'),  value: totalLessons,           icon: '📖' },
      { label: t('dashHW'),       value: hwList.length,          icon: '📝' },
      { label: t('dashStudents'), value: stats.studentCount,     icon: '🎓' },
      { label: t('dashAvg'),
        value: stats.avgGrade !== null ? stats.avgGrade + '%' : '—',
        icon: '📊' },
    ];
    for (const c of cards) {
      const card = el('div', 'dash-card');
      card.innerHTML = `<span class="dash-icon">${c.icon}</span>
        <span class="dash-value">${c.value}</span>
        <span class="dash-label">${c.label}</span>`;
      statsRow.appendChild(card);
    }
    wrap.appendChild(statsRow);

    // Recent books
    if (books.length > 0) {
      const sec = el('div', 'dash-section');
      sec.innerHTML = `<div class="dash-section-title">${t('myBooks')}</div>`;
      const tbl = el('table', 'dash-table');
      tbl.innerHTML = `<thead><tr>
        <th>${t('bookTitle')}</th><th>${t('grade')}</th>
        <th>${t('chapters')}</th><th>${t('lessons')}</th>
      </tr></thead>`;
      const tbody = document.createElement('tbody');
      for (const b of books) {
        const bk = Store.getBook(b.bookId);
        let bLessons = 0;
        if (bk) for (const ch of bk.chapters) bLessons += ch.lessons.length;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(b.title)}</td><td>${escapeHtml(b.grade || '—')}</td>
          <td>${b.totalChapters || '?'}</td><td>${bLessons}</td>`;
        tr.style.cursor = 'pointer';
        tr.onclick = () => openBook(b.bookId);
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      sec.appendChild(tbl);
      wrap.appendChild(sec);
    }

    // Recent homework
    const recentHW = hwList.slice(0, 5);
    if (recentHW.length > 0) {
      const sec = el('div', 'dash-section');
      sec.innerHTML = `<div class="dash-section-title">${t('dashHW')}</div>`;
      const tbl = el('table', 'dash-table');
      tbl.innerHTML = `<thead><tr>
        <th>${t('hwTitleLabel')}</th><th>${t('hwDueDate')}</th>
        <th>${t('avgGrade')}</th>
      </tr></thead>`;
      const tbody = document.createElement('tbody');
      for (const hw of recentHW) {
        const avg = Students.homeworkAverage(hw.id);
        const tr  = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(hw.title)}</td>
          <td>${hw.dueDate || '—'}</td>
          <td>${avg !== null ? avg + '%' : '—'}</td>`;
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      sec.appendChild(tbl);
      wrap.appendChild(sec);
    }

    if (books.length === 0 && hwList.length === 0) {
      wrap.innerHTML = `<p class="empty-hint" style="padding:40px;text-align:center">
        ${t('uploadHint')}</p>`;
    }
  }

  // ── Homework Panel ────────────────────────────────────────────────────────

  function renderHomeworkPanel() {
    const wrap = $('homeworkListWrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    const hwList = Students.listHomework();

    if (hwList.length === 0) {
      wrap.innerHTML = `<p class="empty-hint">${t('hwNone')}</p>`;
      return;
    }

    for (const hw of hwList) {
      const card = el('div', 'hw-card');
      const avg  = Students.homeworkAverage(hw.id);
      const grades = Students.getHomeworkGrades(hw.id);

      card.innerHTML = `
        <div class="hw-card-header">
          <span class="hw-card-title">${escapeHtml(hw.title)}</span>
          <span class="hw-card-due">${hw.dueDate || ''}</span>
        </div>
        <div class="hw-card-meta">
          ${hw.questions.length} ${t('hwQuestions')} ·
          ${t('avgGrade')}: ${avg !== null ? avg + '%' : '—'}
        </div>
      `;

      // Questions list
      if (hw.questions.length > 0) {
        const qList = el('ol', 'hw-questions-list');
        for (const q of hw.questions) {
          const li = document.createElement('li');
          li.dir = 'auto';
          li.textContent = q;
          qList.appendChild(li);
        }
        card.appendChild(qList);
      }

      // Grader table
      const graderWrap = el('div', 'hw-grader-wrap');
      const graderBtn  = el('button', 'btn btn-ghost hw-grade-btn',
        `${t('graderTitle')} (${grades.length})`);
      const graderBody = el('div', 'hw-grader-body hidden');

      graderBtn.onclick = () => {
        graderBody.classList.toggle('hidden');
        renderGrader(hw, graderBody);
      };

      graderWrap.appendChild(graderBtn);
      graderWrap.appendChild(graderBody);
      card.appendChild(graderWrap);

      // Delete button
      const delBtn = el('button', 'btn btn-rust hw-delete-btn', '🗑');
      delBtn.title = t('deleteBook');
      delBtn.onclick = () => {
        if (confirm('Delete this homework?')) {
          Students.deleteHomework(hw.id);
          renderHomeworkPanel();
        }
      };
      card.appendChild(delBtn);

      wrap.appendChild(card);
    }
  }

  function renderGrader(hw, container) {
    container.innerHTML = '';
    const studentList = Students.listStudents();
    if (studentList.length === 0) {
      container.innerHTML = `<p class="empty-hint">${t('noStudents')}</p>`;
      return;
    }

    const grades = Students.getHomeworkGrades(hw.id);
    const gradeMap = {};
    for (const g of grades) gradeMap[g.studentId] = g;

    const tbl   = el('table', 'grade-table');
    tbl.innerHTML = `<thead><tr>
      <th>${t('studentName')}</th>
      <th>${t('gradeLabel')}</th>
      <th>${t('outOf')}</th>
      <th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const st of studentList) {
      const existing = gradeMap[st.id];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td dir="auto">${escapeHtml(st.name)}</td>
        <td><input class="grade-input" type="number" min="0" max="100"
          value="${existing ? existing.score : ''}" placeholder="—" /></td>
        <td><input class="grade-max-input" type="number" min="1"
          value="${existing ? existing.maxScore : 100}" /></td>
        <td><button class="btn btn-gold grade-save-btn">${t('saveGrade')}</button></td>
      `;
      const scoreInput = tr.querySelector('.grade-input');
      const maxInput   = tr.querySelector('.grade-max-input');
      const saveBtn    = tr.querySelector('.grade-save-btn');

      saveBtn.onclick = () => {
        const score    = parseFloat(scoreInput.value);
        const maxScore = parseFloat(maxInput.value) || 100;
        if (isNaN(score)) return;
        Students.recordGrade({ studentId: st.id, homeworkId: hw.id, score, maxScore });
        saveBtn.textContent = '✓';
        setTimeout(() => { saveBtn.textContent = t('saveGrade'); }, 1500);
        // Refresh the header avg
        renderHomeworkPanel();
      };

      tbody.appendChild(tr);
    }

    tbl.appendChild(tbody);
    container.appendChild(tbl);

    // Class average
    const avg = Students.homeworkAverage(hw.id);
    if (avg !== null) {
      const avgRow = el('div', 'grade-avg-row',
        `${t('avgGrade')}: <strong>${avg}%</strong>`);
      container.appendChild(avgRow);
    }
  }

  // ── Students Panel ────────────────────────────────────────────────────────

  function renderStudentsPanel() {
    const wrap = $('studentListWrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    const students = Students.listStudents();
    if (students.length === 0) {
      wrap.innerHTML = `<p class="empty-hint">${t('noStudents')}</p>`;
      return;
    }

    const tbl   = el('table', 'dash-table');
    tbl.innerHTML = `<thead><tr>
      <th>${t('studentName')}</th>
      <th>${t('studentGrade')}</th>
      <th>${t('avgGrade')}</th>
      <th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const st of students) {
      const avg = Students.studentAverage(st.id);
      const tr  = document.createElement('tr');
      tr.innerHTML = `
        <td dir="auto">${escapeHtml(st.name)}</td>
        <td dir="auto">${escapeHtml(st.grade || '—')}</td>
        <td>${avg !== null ? avg + '%' : '—'}</td>
        <td>
          <button class="btn btn-ghost view-grades-btn">📊</button>
          <button class="btn btn-rust remove-st-btn">🗑</button>
        </td>
      `;

      tr.querySelector('.remove-st-btn').onclick = () => {
        if (confirm('Remove student?')) {
          Students.removeStudent(st.id);
          renderStudentsPanel();
        }
      };

      tr.querySelector('.view-grades-btn').onclick = () => {
        showStudentGrades(st, tbody);
      };

      tbody.appendChild(tr);
    }

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
  }

  function showStudentGrades(student, tbody) {
    // Remove existing inline grade rows
    for (const row of tbody.querySelectorAll('.inline-grades-row')) row.remove();

    const grades = Students.getStudentGrades(student.id);
    if (grades.length === 0) return;

    // Find student's row and insert after it
    const rows = [...tbody.querySelectorAll('tr:not(.inline-grades-row)')];
    const studentRow = rows.find(r => r.querySelector('td')?.textContent.trim() === student.name);
    if (!studentRow) return;

    const inlineRow = document.createElement('tr');
    inlineRow.className = 'inline-grades-row';
    const td = document.createElement('td');
    td.colSpan = 4;

    const innerTbl = el('table', 'grade-table inline-grades-tbl');
    innerTbl.innerHTML = `<thead><tr>
      <th>${t('hwTitleLabel')}</th>
      <th>${t('gradeLabel')}</th>
      <th>${t('outOf')}</th>
      <th>%</th>
    </tr></thead>`;
    const innerBody = document.createElement('tbody');

    for (const g of grades) {
      const r = document.createElement('tr');
      r.innerHTML = `
        <td dir="auto">${escapeHtml(g.homeworkTitle)}</td>
        <td>${g.score}</td>
        <td>${g.maxScore}</td>
        <td>${g.pct}%</td>
      `;
      innerBody.appendChild(r);
    }

    innerTbl.appendChild(innerBody);
    td.appendChild(innerTbl);
    inlineRow.appendChild(td);
    studentRow.after(inlineRow);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    setupUpload();

    $('langToggle').addEventListener('click', toggleLang);
    $('newBookBtn').addEventListener('click', () => {
      switchTopPanel('books');
      $('viewerPanel').classList.add('hidden');
      $('uploadPanel').classList.remove('hidden');
    });

    // Top nav tabs
    for (const btn of document.querySelectorAll('.nav-tab')) {
      btn.addEventListener('click', () => switchTopPanel(btn.dataset.panel));
    }

    // Add student form
    $('addStudentBtn').addEventListener('click', () => {
      $('addStudentForm').classList.remove('hidden');
      $('stNameInput').focus();
    });
    $('stCancelBtn').addEventListener('click', () => {
      $('addStudentForm').classList.add('hidden');
    });
    $('stSaveBtn').addEventListener('click', () => {
      const name  = $('stNameInput').value.trim();
      const grade = $('stGradeInput').value.trim();
      if (!name) { $('stNameInput').focus(); return; }
      Students.addStudent(name, grade);
      $('stNameInput').value  = '';
      $('stGradeInput').value = '';
      $('addStudentForm').classList.add('hidden');
      renderStudentsPanel();
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
      // Only constrain by sidebar when sidebar is visible
      const sidebar = document.querySelector('.sidebar');
      const sidebarVisible = sidebar && sidebar.style.display !== 'none';
      const sideOffset = sidebarVisible ? SIDEBAR_W : 0;
      mainArea.style.width  = (window.innerWidth - sideOffset) + 'px';
      if (isRTL()) {
        mainArea.style.right = sideOffset + 'px';
        mainArea.style.left  = '0px';
      } else {
        mainArea.style.left  = sideOffset + 'px';
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

    // ── lesson tabs + view tabs + content area ──
    const tabs     = document.getElementById('lessonTabs');
    const viewTabs = document.getElementById('lessonViewTabs');
    const content  = document.getElementById('lessonContent');
    if (tabs && content) {
      const tabsH     = tabs.offsetHeight;
      const viewTabsH = viewTabs ? viewTabs.offsetHeight : 0;
      // Position view-mode tab strip directly below lesson selector
      if (viewTabs) viewTabs.style.top = tabsH + 'px';
      content.style.top    = (tabsH + viewTabsH) + 'px';
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
