/**
 * students.js
 * Student database, homework management, and grade tracking.
 * All data is persisted in localStorage.
 *
 * Data schema (stored under STUDENT_KEY):
 * {
 *   students:  { [studentId]: { id, name, grade, createdAt } },
 *   homework:  { [hwId]:      { id, bookId, chapterId, lessonId, title, questions[], dueDate, createdAt } },
 *   grades:    { [gradeId]:   { id, studentId, homeworkId, score, maxScore, notes, gradedAt } }
 * }
 */

const Students = (() => {

  const STUDENT_KEY = 'lessoncraft_students';

  // ── Persistence ───────────────────────────────────────────────────────────

  function getDB() {
    try {
      const raw = localStorage.getItem(STUDENT_KEY);
      const db  = raw ? JSON.parse(raw) : {};
      if (!db.students) db.students = {};
      if (!db.homework) db.homework = {};
      if (!db.grades)   db.grades   = {};
      return db;
    } catch {
      return { students: {}, homework: {}, grades: {} };
    }
  }

  function saveDB(db) {
    try {
      localStorage.setItem(STUDENT_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      console.warn('Students: localStorage quota exceeded.', e);
      return false;
    }
  }

  /**
   * Lightweight ID generator suitable for a single-user classroom app.
   * Combines a millisecond timestamp with 5 random base-36 characters.
   * Collision probability is negligible for ≤ hundreds of records per device.
   * For a multi-user production backend, replace with a UUID v4 generator.
   */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Students ──────────────────────────────────────────────────────────────

  function addStudent(name, grade) {
    const db  = getDB();
    const id  = uid();
    db.students[id] = { id, name: name.trim(), grade: (grade || '').trim(), createdAt: new Date().toISOString() };
    saveDB(db);
    return id;
  }

  function updateStudent(id, fields) {
    const db = getDB();
    if (!db.students[id]) return false;
    Object.assign(db.students[id], fields);
    saveDB(db);
    return true;
  }

  function removeStudent(id) {
    const db = getDB();
    delete db.students[id];
    // Remove all grades for this student
    for (const gId of Object.keys(db.grades)) {
      if (db.grades[gId].studentId === id) delete db.grades[gId];
    }
    saveDB(db);
  }

  function listStudents() {
    const db = getDB();
    return Object.values(db.students).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }

  function getStudent(id) {
    return getDB().students[id] || null;
  }

  // ── Homework ──────────────────────────────────────────────────────────────

  /**
   * Create a homework assignment.
   * @param {object} opts
   *   bookId     – ID of the source book
   *   chapterId  – chapter identifier
   *   lessonId   – lesson identifier
   *   title      – homework title
   *   questions  – string[] of question texts
   *   dueDate    – ISO date string (optional)
   */
  function createHomework({ bookId, chapterId, lessonId, title, questions = [], dueDate = '' }) {
    const db = getDB();
    const id = uid();
    db.homework[id] = {
      id,
      bookId,
      chapterId,
      lessonId,
      title:     title.trim(),
      questions: questions.map(q => q.trim()).filter(Boolean),
      dueDate,
      createdAt: new Date().toISOString(),
    };
    saveDB(db);
    return id;
  }

  function updateHomework(id, fields) {
    const db = getDB();
    if (!db.homework[id]) return false;
    Object.assign(db.homework[id], fields);
    saveDB(db);
    return true;
  }

  function deleteHomework(id) {
    const db = getDB();
    delete db.homework[id];
    // Remove all grades for this homework
    for (const gId of Object.keys(db.grades)) {
      if (db.grades[gId].homeworkId === id) delete db.grades[gId];
    }
    saveDB(db);
  }

  function listHomework(bookId = null) {
    const db = getDB();
    const all = Object.values(db.homework);
    return bookId
      ? all.filter(h => h.bookId === bookId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function getHomework(id) {
    return getDB().homework[id] || null;
  }

  // ── Grades ────────────────────────────────────────────────────────────────

  /**
   * Record (or update) a grade for one student on one homework.
   * If a grade already exists for the (studentId, homeworkId) pair, it is updated.
   */
  function recordGrade({ studentId, homeworkId, score, maxScore = 100, notes = '' }) {
    const db = getDB();
    // Find existing grade entry for this pair
    const existing = Object.values(db.grades).find(
      g => g.studentId === studentId && g.homeworkId === homeworkId
    );
    if (existing) {
      Object.assign(existing, { score, maxScore, notes, gradedAt: new Date().toISOString() });
    } else {
      const id = uid();
      db.grades[id] = {
        id, studentId, homeworkId,
        score, maxScore, notes,
        gradedAt: new Date().toISOString(),
      };
    }
    saveDB(db);
  }

  function deleteGrade(studentId, homeworkId) {
    const db = getDB();
    for (const gId of Object.keys(db.grades)) {
      const g = db.grades[gId];
      if (g.studentId === studentId && g.homeworkId === homeworkId) {
        delete db.grades[gId];
      }
    }
    saveDB(db);
  }

  /**
   * Get all grades for a specific homework assignment.
   * Returns [{studentId, studentName, score, maxScore, pct, notes, gradedAt}]
   */
  function getHomeworkGrades(homeworkId) {
    const db       = getDB();
    const students = db.students;
    return Object.values(db.grades)
      .filter(g => g.homeworkId === homeworkId)
      .map(g => ({
        ...g,
        studentName: students[g.studentId]?.name || '—',
        pct: g.maxScore > 0 ? Math.round((g.score / g.maxScore) * 100) : 0,
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'ar'));
  }

  /**
   * Get all grades for a specific student.
   * Returns [{homeworkId, homeworkTitle, score, maxScore, pct, notes, gradedAt}]
   */
  function getStudentGrades(studentId) {
    const db       = getDB();
    const homework = db.homework;
    return Object.values(db.grades)
      .filter(g => g.studentId === studentId)
      .map(g => ({
        ...g,
        homeworkTitle: homework[g.homeworkId]?.title || '—',
        pct: g.maxScore > 0 ? Math.round((g.score / g.maxScore) * 100) : 0,
      }))
      .sort((a, b) => b.gradedAt.localeCompare(a.gradedAt));
  }

  /**
   * Calculate the average grade percentage for a student across all homework.
   * Returns null if no grades recorded.
   */
  function studentAverage(studentId) {
    const grades = getStudentGrades(studentId);
    if (grades.length === 0) return null;
    const total = grades.reduce((sum, g) => sum + g.pct, 0);
    return Math.round(total / grades.length);
  }

  /**
   * Calculate the class average for a specific homework assignment.
   * Returns null if no grades recorded.
   */
  function homeworkAverage(homeworkId) {
    const grades = getHomeworkGrades(homeworkId);
    if (grades.length === 0) return null;
    const total = grades.reduce((sum, g) => sum + g.pct, 0);
    return Math.round(total / grades.length);
  }

  // ── Dashboard Stats ───────────────────────────────────────────────────────

  /**
   * Returns a snapshot of all student-related statistics for the dashboard.
   */
  function getStats() {
    const db = getDB();
    const studentCount  = Object.keys(db.students).length;
    const homeworkCount = Object.keys(db.homework).length;
    const gradeCount    = Object.keys(db.grades).length;

    const allPcts = Object.values(db.grades)
      .filter(g => g.maxScore > 0)
      .map(g => Math.round((g.score / g.maxScore) * 100));
    const avgGrade = allPcts.length
      ? Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length)
      : null;

    return { studentCount, homeworkCount, gradeCount, avgGrade };
  }

  return {
    // Students
    addStudent, updateStudent, removeStudent, listStudents, getStudent,
    // Homework
    createHomework, updateHomework, deleteHomework, listHomework, getHomework,
    // Grades
    recordGrade, deleteGrade, getHomeworkGrades, getStudentGrades,
    studentAverage, homeworkAverage,
    // Stats
    getStats,
  };

})();
