# Generated parser smoke fixture

`generate-smoke-pdf.mjs` creates a deterministic two-page PDF containing:

- a title, paragraphs, and a ruled 2 x 2 table;
- two text columns with stable sentinel strings;
- only ASCII text and PDF Base-14 font references.

No binary PDF or third-party document is committed. The generated file lives
under the gitignored `work/` directory and is suitable for local parser smoke
tests. The project must choose a root open-source license before this fixture
source is described as redistributable outside the repository.

The current generator produces 2,264 bytes with SHA-256
`4eeb317654a251c6b36366c8b200a29b07b0bd5c8128ee877d05b2455c4dd6c6`.

Generate it with:

~~~bash
bun fixtures/generate-smoke-pdf.mjs
~~~
