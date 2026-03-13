# LessonCraft

Systematic lesson extractor for Arabic textbooks — built for teachers.

## What it does (now)
- Upload any Arabic/English textbook PDF
- Automatically detects chapter and lesson structure
- Repairs Arabic encoding issues (NFKC normalization)
- Extracts and tags content by section type (warm-up, explore, exercises…)
- Stores scraped books in the browser (localStorage)
- Export to JSON for later import (no re-scraping)

## What it will do (roadmap)
- AI lesson planning assistant
- Homework generator + auto-grader
- Student database & progress tracker
- Homework correction tool

---

## Setup

### 1. GitHub
```bash
git init
git add .
git commit -m "feat: initial LessonCraft core"
git remote add origin https://github.com/YOUR_USERNAME/lessoncraft.git
git push -u origin main
```

### 2. Vercel
1. Go to [vercel.com](https://vercel.com) → **Sign up with GitHub**
2. Click **Add New Project** → import your `lessoncraft` repo
3. Leave all settings default (framework: Other, output: `.`)
4. Click **Deploy**

Vercel auto-deploys every time you push to `main`. Your app is live at:
`https://lessoncraft.vercel.app` (or your custom domain)

---

## Project Structure

```
lessoncraft/
├── index.html          ← App entry (bilingual AR/EN)
├── css/
│   └── style.css       ← RTL/LTR aware styles
├── js/
│   ├── parser.js       ← PDF loading + Arabic text repair
│   ├── detector.js     ← Chapter/lesson structure detection
│   ├── store.js        ← localStorage persistence + JSON export/import
│   └── app.js          ← UI controller
└── vercel.json         ← Hosting config
```

---

## Extending the Scraper

### Add new section keywords (detector.js)
Open `js/detector.js` and find the `PATTERNS.sections` object.
Add a new entry:
```js
mySection: [/Arabic keyword/, /reversed artifact/],
```
That's it — the detector and viewer pick it up automatically.

### Add new chapter heading patterns
Add regex to `PATTERNS.chapter` the same way.

### Future: AI Assistant
When ready, add an `/api/assistant.js` Vercel serverless function.
The `Store.getBook(bookId)` JSON becomes the context for Claude API calls.
No changes needed to the scraper core.

### Future: Supabase Database
Replace the `localStorage` calls in `store.js` with Supabase client calls.
The rest of the app is untouched.

---

## Known Limitations
- Pages using Private Use Area fonts (`U+E000–U+F8FF`) show a warning — text may be garbled. Full fix requires OCR (Tesseract.js with Arabic model).
- Very large PDFs (200+ pages) may be slow on first scrape — this is a one-time cost; the JSON is cached.
- localStorage limit is ~5MB. Export large books to JSON and re-import as needed.
