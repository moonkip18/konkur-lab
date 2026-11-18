# Konkur Progress Lab

An offline-first personal tracker for Maz mock exams. You enter your answer for
every one of the 95 questions and the official Maz difficulty label for that
question. The app then shows you:

- **Raw performance** — the net percentage you actually scored, using the
  Iranian marking rule (correct +1, wrong −1/3, blank 0).
- **A difficulty-adjusted personal index** (تراز شخصی تخمینی) — a fixed model that
  compares that raw score to what the model expects for *this exam's own
  difficulty mix*.
- **History** — graphs over time, per-subject pages, and a full derivation of
  every number.

Everything stays on your device. There is no account, no server, no analytics,
and no cloud sync.

![Konkur Progress Lab dark UI](docs/screenshot-konkur.png)

**Status**: 233 tests passing · TypeScript strict · offline PWA (installable,
works with no connection) · MIT

---

## The one thing to understand first

Two exams can have the same raw percentage and mean very different things.

If exam A had 12 Hard questions in Math and exam B had 2, then scoring 60% raw on
A is a stronger result than scoring 60% raw on B. The raw number cannot see that
difference. The difficulty-adjusted index can, because it computes a
model-expected score from the labels you actually entered.

This app exists to make that distinction visible. It does **not** estimate your
national rank, and it never compares you to other participants.

---

## What the index is, and what it is not

### It is

A **personal tracking index**. For each subject it asks: *how far above or below
the model's expectation did this subject land, given this exam's difficulty
labels?*

- `5000` means the subject scored exactly what the fixed model expects for that
  exam's difficulty mix.
- Higher means above expectation. Lower means below expectation.
- It is a consistent ruler you can point at your own exams.

### It is not

- ❌ An official Sanjesh or Maz **تراز**
- ❌ A percentile, rank, or estimate of national standing
- ❌ A comparison against other students (there is no participant data anywhere
  in this app)
- ❌ A fitted or adaptive model — it never learns from your history

A higher index than your previous exam does not prove you got better. A lower
one does not prove you got worse. Two different papers can produce different
numbers for identical ability. That is the whole point of the tool.

---

## Running it: one click

**Double-click `Start-Konkur-Lab.bat`.**

It builds the app if needed, starts a local server, and opens your browser.
Leave the black window open while you use the app; close it to stop.

That's it. After the first run, launching takes about a second.

### Why a window has to stay open

The app needs a real web origin to store anything. Chrome treats a
`file://` page as an opaque origin and denies it IndexedDB entirely, so a
double-clicked HTML file cannot save a single exam. `http://127.0.0.1` is a
proper secure context, which is what makes storage, the service worker, and
offline caching work.

This also means your data is tied to the browser you used it in. Chrome and
Firefox keep separate databases for the same `http://127.0.0.1:5178` address —
pick one and stick with it, or use the JSON backup.

### Installing it to your desktop or taskbar

The app is a standard installable PWA. Once it's running:

- **Chrome / Edge** — click the install icon in the address bar
- **iOS Safari** — Share → Add to Home Screen

It then launches from your desktop like a normal app, with its own window and
icon. Note that the local server must still be running, so the desktop
shortcut is best paired with leaving the launcher window open.

## Manual setup

Requires Node.js 20 or newer.

```bash
cd konkur-lab
npm install
```

## Development

```bash
npm run dev        # Vite dev server, prints a local URL
```

Open the `http://localhost:5173` address it prints. **Do not double-click
`index.html`.** That file is the build template, not the app: it loads
`/src/main.tsx`, which a browser cannot resolve or compile from disk, and
Chrome blocks ES modules over `file://` entirely. Opening it that way shows a
notice explaining this, which `main.tsx` removes once the app boots. The same
applies to `dist/index.html` — it must be served, not opened.

`npm start` does the same thing as the launcher batch file without opening a
browser window, if you prefer to click the URL yourself.

## Production build

```bash
npm run build      # type-check, bundle, emit the service worker, verify output
npm run preview    # serve the built output locally
```

The build is a static site. `dist/` can be hosted on any static file server. It
works offline after the first successful load.

`build` finishes with `scripts/verify-build.mjs`, which asserts the two
easy-to-break offline guarantees: the service worker really does precache the
entry point, and nothing in `dist/` loads a third-party resource. A green
build means offline-first is intact, not just that the bundler exited zero.

Bundle size is split so the app shell does not wait on charts: recharts and Dexie
land in their own chunks.

PWA icons are generated from `scripts/make-icons.mjs` (a dependency-free PNG
encoder) and committed to `public/`. Regenerate with `npm run icons` if the mark
changes.

## Tests

```bash
npm test           # Vitest, single run
npm run test:watch # watch mode
```

```bash
npm run typecheck  # tsc -b, strict mode
```

All three must pass:

```bash
npm run typecheck && npm test && npm run build
```

## Exam structure (fixed)

95 questions, split into three sections:

| Subject   | Persian name | Questions | Count | Coefficient |
| --------- | ------------ | --------- | ----: | ----------: |
| Math      | ریاضی        | 1–40      |    40 |         12× |
| Physics   | فیزیک        | 41–65     |    25 |          9× |
| Chemistry | شیمی         | 66–95     |    30 |          7× |
| **Total** |              | **1–95**  | **95** |     **28** |

Subject percentages are never averaged equally. The weighted raw score is:

```
(12 · MathRawNet + 9 · PhysicsRawNet + 7 · ChemistryRawNet) / 28
```

---

## How scoring works

### 1. Raw net percentage

```
RawNet = 100 × (correct − wrong/3) / total
```

Negative values are legitimate and are never clamped to zero.

Also shown: attempt rate `100 × (C+W)/N`, and accuracy among attempted
`100 × C/(C+W)` — displayed as **N/A** rather than dividing by zero.

### 2. Expected net from your difficulty labels

Profile v1 assumes the following for a *strong* candidate. **These are
modelling assumptions chosen for this app. They are not verified Maz or Sanjesh
statistics.**

| Difficulty | p (correct when attempted) | a (attempt rate) |
| ---------- | -------------------------: | ---------------: |
| Easy       |                       0.85 |             0.97 |
| Medium     |                       0.65 |             0.88 |
| Hard       |                       0.25 |             0.60 |

From those, the expected net score per question — *including unattempted
questions* — is derived, never typed in:

```
μ_d = a_d × (p_d − (1 − p_d)/3)
```

| Difficulty | μ (per question) | as a percentage |
| ---------- | ---------------: | --------------: |
| Easy       |         0.776000 |          77.60% |
| Medium     |    0.46933333…   |          46.93% |
| Hard       |         0.000000 |           0.00% |

**About Hard's zero.** It is a mathematical consequence of `a = 0.60` under the
`+1 / −1/3` marking rule, not a claim that Hard questions are worth zero, and not
a prediction that you will score zero on them. It means the *model* expects
roughly break-even net on Hard questions. Getting one right therefore produces a
much larger positive deviation from expectation than getting an Easy one right.

For each subject, from the labels **you actually entered**:

```
ExpectedNet_s = 100 × Σ μ(d_i) / N_s
```

A subject with more Hard questions gets a lower expected net, and so is judged
against a lower bar. Your labels are never rearranged to match any "typical"
distribution.

### 3. Performance, then the index

```
Performance_s = RawNet_s − ExpectedNet_s        (percentage points)

τ_s = 5000 + 2000 × (Performance_s / 15)
```

`A = 5000`, `B = 2000`, `σ = 15`. These are arbitrary scaling choices for a
readable personal index — **not official Sanjesh constants**.

The overall index is the coefficient-weighted average:

```
T = (12·τ_math + 9·τ_physics + 7·τ_chemistry) / 28
```

There is **no cap, no floor, and no target**. The index is never clamped. There is
no "perfect exam" score to hit — 13,000 is not one.

Rounding is for display only: percentages to two decimals, indices to whole
numbers. Full floating-point precision is kept internally, and every displayed
number is reproducible from the exported raw inputs.

---

## History never changes scoring

This is enforced structurally, not just by convention: the scoring functions
accept **one exam's** answers, labels, and profile snapshot. There is no function
anywhere that takes two exams.

Verified by tests in `src/lib/db/history.test.ts`:

- Adding an older exam does not change an existing exam's score
- Adding a newer exam does not change an existing exam's score
- Deleting an exam does not change any remaining score
- Reordering exams does not change any score
- An extreme past result does not calibrate a later exam
- Introducing a new profile version does not overwrite the original snapshot
- Graphs read stored results and are never fed back into the engine

---

## Using the app

### Apply Exam · ثبت آزمون

The main screen, laid out as a digital **پاسخنامه کلیدی** rather than a data
entry form. Three sections (Math 1–40, Physics 41–65, Chemistry 66–95), and for
each question two independent control groups:

- **Answer**: Correct / درست · Blank / نزده · Wrong / غلط
- **Difficulty**: Easy / آسان · Medium / متوسط · Hard / سخت

Nothing is preselected. An unset answer is **not** the same as Blank, and an
unset difficulty is **not** treated as Easy.

Also here: live per-subject counts, overall coverage, keyboard navigation
(arrow keys move, Enter advances), jump-to-question, quick subject jumps,
filters by subject / difficulty / answer status, undo and redo, autosave, and
optional paste entry (answers and labels are parsed separately, with a preview
before anything is written).

An exam can be completed only when all 95 answers **and** all 95 difficulty
labels are present. The sum of correct + wrong + blank must equal each subject's
question count. Missing data is never silently treated as zero or as Blank.

### Dashboard

Latest completed exam with raw scores and adjusted indices kept visibly apart.
Every adjusted figure is shown next to the expected net it is measured against.
Includes the full derivation and the date of the previous exam.

### History

Every stored exam, newest first, with an expandable per-exam breakdown. Archiving
keeps an exam out of the default summaries without deleting it. Completing an
exam freezes its score; reopening it requires an explicit action, clears the
stored result, and increments a recorded revision counter.

### Statistics · آمار

Ten chart groups over completed exams (drafts excluded): weighted raw score,
overall index, per-subject raw-vs-index pairs, expected-vs-actual, net percentage
by difficulty and subject, accuracy by difficulty and subject, attempt rate by
difficulty and subject, correct/wrong/blank counts, and difficulty mix counts and
proportions.

A worked demo of the math, without running anything:

```text
exam with 12 Hard / 10 Medium questions in Math (coefficient 12),
answers: 30 correct, 8 wrong, 2 blank
  raw net:            30 - 8/3            = 27.33  -> 27.33*12 = 328 weighted
  raw percent:        27.33 / 40          = 68.3%
  model expectation:  μ_d from the actual label mix (see docs/scoring)
  personal index:     5000 * (T_actual / T_expected)  -- 5000 = on expectation
```

Every number the UI shows is derivable and test-verified; the derivation is
rendered on-screen next to the result.

Every plotted point is one stored exam. **Missed exams stay gaps** — no zeros are
inserted. A 3-exam rolling average is available as a supplementary view, labelled
with how many exams contributed, and never alters a stored score.

Difficulty cells with fewer than 5 questions are marked as small samples.

### Subjects

Per-subject pages for Math (12×), Physics (9×), and Chemistry (7×): raw net, τ,
expected net, deviation, correct/wrong/blank, by-difficulty breakdown, and each
subject's contribution to the overall weighted score.

### Settings

Date display (Gregorian / Jalali), default provider, exam interval for the
next-date suggestion, backup reminder interval, exports and restore, and
clear-all-data behind a typed confirmation phrase.

---

## Data and storage

### Where your data lives

Browser IndexedDB on this device, through Dexie. Schema version 1, with
versioned migrations defined in `src/lib/db/db.ts`.

**A local save is not a backup.** Data exists only in this browser profile.
Clearing site data, using a private window, or switching devices means a
different (empty) database. The app says this on the Settings page rather than
implying otherwise.

The app requests persistent storage and reports the result honestly —
`granted`, `not granted`, or `unsupported` — including the plain fact that a
local save is still not an external backup.

### JSON backup

Contains everything needed to reproduce every stored result: exam records and
IDs, dates, provider, status, notes, all 95 answer states and difficulty labels,
subject ranges and coefficients, the profile snapshot and version, the scoring
engine version, the stored results, schema version, and export metadata.

Restore **previews before writing**: exam count, question-record count, duplicate
date+provider conflicts, and validation errors. An invalid or partial file never
touches your existing data. Validation also re-scores each completed exam from its
own stored inputs and rejects the file if a stored result does not match — so a
tampered or truncated backup cannot be imported silently. When validation passes,
the write runs in one Dexie transaction: all exams land, or the database is left
exactly as it was.

### CSV exports

**Question-level** — one row per question:

```
exam_id, exam_date, provider, exam_status, subject, subject_fa, question_number,
answer, difficulty, profile_version, engine_version, completed
```

**Exam-level** — one row per exam, carrying counts, all raw net percentages, the
weighted raw score, difficulty counts per subject, expected nets, deviations,
subject indices, the overall index, coefficients, all scoring parameters, and
coverage metadata.

Together these are enough to recompute every displayed number in a spreadsheet.

### Clear all data

Requires typing `DELETE ALL EXAMS`. Irreversible without a backup, and the app
says so before you type it.

---

## Offline behaviour

- The app shell and assets are precached by a service worker
  (`vite-plugin-pwa`, Workbox `generateSW`).
- Scoring is entirely local — no network call is involved in any calculation.
- Entering an exam, calculating scores, viewing history, and exporting data all
  work with no internet connection.
- Storage failures, quota errors, and invalid imports surface as readable
  messages rather than silent failures.

---

## Project layout

```
src/
  lib/
    scoring/        Pure scoring library. No React, no Dexie, no DOM.
      types.ts        Exam structure, subjects, coefficients
      profile.ts      Profile v1, assumption validation, μ derivation
      raw.ts          Raw net, weighted raw, counts
      adjusted.ts     Expected net, performance, τ, overall T
      exam.ts         Exam-level orchestration and completion validation
      stats.ts        Per-difficulty slices, coverage, rolling averages
      format.ts       Display rounding
      persian.ts      Jalali ↔ Gregorian (Borkowski algorithm)
    db/              Dexie schema, repository, backups, CSV
    answerKey.ts      Paste parsing and list filters
    undo.ts           Bounded undo/redo with coalescing
    chartData.ts      Exam → chart row flattening
  components/       Shared UI: primitives, charts, score breakdown, explainer
  pages/            Dashboard, ApplyExam, History, Statistics, Subjects, Settings
  state/            App context and settings
```

The scoring library is deliberately framework-independent and is where the math
is tested. UI code never implements a formula; it only renders results.

---

## Dates

Stored as ISO Gregorian (`YYYY-MM-DD`) always. Jalali conversion is computed for
display only, using the Borkowski algorithm with 33-year cycle corrections. The
next-exam suggestion is 14 days after the most recent exam (configurable) and
never creates an exam automatically. Missed exams are simply absent.

---

## Testing

233 tests (~45s), covering:

- Answer marking values, negative percentages, the required 60/10/25 arithmetic
  example, attempt rate, accuracy, and N/A handling
- Weighted raw score with 12/9/7, negative scores, changed coefficients, and proof
  it is never the equal average
- μ derivation and the three expected-net percentages
- Expected nets from actual labels, and a subject with more Hard questions scoring
  a lower expected net
- τ, T, no clamping, full precision, and invalid-parameter handling
- **Historical independence** (see above)
- Database lifecycle, persistence across close/reopen, migrations, and
  answer/difficulty independence
- JSON backup round trips, import rejection cases, transaction rollback
- CSV columns and values, and reproducibility of displayed numbers
- Question numbering, 95-question coverage, no implicit defaults, autosave,
  undo/redo, completion validation
- Paste parsing, list filters, and undo/redo coalescing
- Chart-row construction: drafts excluded, archived opt-in, gaps preserved, and
  stored results never mutated
- Jalali/Gregorian conversion

Run a single file while iterating:

```bash
npx vitest run src/lib/scoring/scoring.test.ts
```

---

## Privacy

No network requests. No accounts. No analytics, telemetry, or crash reporting. No
paid APIs. The app makes zero third-party requests — fonts are system fonts, and
every asset is served from the same origin.