# Classroom design preview

A standalone teacher-first design for tracking an English class through the
existing 570-word Academic Word List. The source is published to the separate
`/words-studio/teacher-preview/` path by `scripts/build_pages.py`.

The preview includes a teacher overview, searchable student roster, attention
filter, individual progress, assignments, activity reports, CSV download, real
word definitions/examples, and a linked student practice experience.

All 18 student names and activity records are fictional. Preview edits are stored
only in the browser under `words-studio-classroom-design-v1`; the current study
app and its database are independent. The preview is a design prototype, not a
shared classroom backend or a source of actual student results.

Visual and interaction references:

- [Quizlet Class Progress](https://quizlet.com/features/teacher-class-progress)
- [Vocabulary.com Teacher Dashboard](https://www.vocabulary.com/articles/announcements/announcing-the-powerful-new-teacher-dashboard/)
- [Knowt for Teachers](https://knowt.com/teachers)

To build and check locally:

```sh
python scripts/build_pages.py
python -m http.server 8765 --bind 127.0.0.1
node scripts/test_teacher_preview.cjs /path/to/node_modules/playwright
```
