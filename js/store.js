/**
 * store.js
 * Manages all scraped book data.
 * Uses localStorage for persistence across sessions.
 * Future: swap localStorage calls for Supabase API calls with no changes to the rest of the app.
 */

const Store = (() => {

  const STORAGE_KEY = 'lessoncraft_books';

  // ── Persistence ───────────────────────────────────────────────────────────

  function getAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveAll(books) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
      return true;
    } catch (e) {
      // Storage quota exceeded — data is too large
      console.warn('Store: localStorage quota exceeded.', e);
      return false;
    }
  }

  /**
   * Save a scraped book tree. The bookId is derived from filename + grade.
   * Returns the bookId.
   */
  function saveBook(bookTree, filename) {
    const bookId = slugify(filename || bookTree.meta.bookTitle || 'book-' + Date.now());
    const books = getAll();
    books[bookId] = { ...bookTree, bookId, filename };
    const ok = saveAll(books);
    if (!ok) {
      // Try saving a lighter version (strip full rawText from sections)
      const lite = stripRawText(bookTree);
      books[bookId] = { ...lite, bookId, filename };
      saveAll(books);
    }
    return bookId;
  }

  function getBook(bookId) {
    return getAll()[bookId] || null;
  }

  function listBooks() {
    const books = getAll();
    return Object.values(books).map(b => ({
      bookId: b.bookId,
      filename: b.filename,
      title: b.meta?.bookTitle || b.filename,
      grade: b.meta?.grade,
      scrapedAt: b.meta?.scrapedAt,
      totalChapters: b.meta?.totalChapters,
      totalPages: b.meta?.totalPages,
    }));
  }

  function deleteBook(bookId) {
    const books = getAll();
    delete books[bookId];
    saveAll(books);
  }

  // ── Export / Import ───────────────────────────────────────────────────────

  /**
   * Download a book's data as a JSON file.
   * This JSON can later be imported directly (no re-scraping needed).
   */
  function exportJSON(bookId) {
    const book = getBook(bookId);
    if (!book) return;
    const blob = new Blob([JSON.stringify(book, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bookId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Import a previously exported JSON file back into the store.
   */
  async function importJSON(file) {
    const text = await file.text();
    const book = JSON.parse(text);
    if (!book.bookId || !book.chapters) throw new Error('Invalid LessonCraft JSON file.');
    const books = getAll();
    books[book.bookId] = book;
    saveAll(books);
    return book.bookId;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function slugify(str) {
    return str
      .replace(/[^\u0600-\u06FF\w]/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase()
      .slice(0, 60);
  }

  /** Remove rawText from sections to reduce storage size (keep structure only) */
  function stripRawText(tree) {
    return {
      ...tree,
      chapters: tree.chapters.map(ch => ({
        ...ch,
        lessons: ch.lessons.map(les => ({
          ...les,
          sections: Object.fromEntries(
            Object.entries(les.sections).map(([k, v]) => [k, v.slice(0, 500) + '…'])
          ),
        })),
      })),
    };
  }

  /**
   * Get storage usage estimate in KB.
   */
  function getStorageUsage() {
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    return Math.round((raw.length * 2) / 1024); // UTF-16 = 2 bytes/char
  }

  return { saveBook, getBook, listBooks, deleteBook, exportJSON, importJSON, getStorageUsage };

})();
