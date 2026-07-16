Articles in this directory are independent from the website. Every publishable article is a standard Markdown file.

Required frontmatter:

---
title: 'Article title'
date: '2026-07-15'
sequence: 14
background: 'Why this work started.'
problem: 'The concrete question or failure.'
approach: 'What changed and how it was checked.'
outcome: 'The measured result or unresolved work.'
---

Optional fields:

updated: '2026-07-16'
tags: ['adapter', 'sse']
summary: 'Short archive summary.'
draft: true

- Add an article by creating a Markdown file with any filename.
- Edit the Markdown file to update the article.
- Set draft: true to keep it out of the website.
- Delete the Markdown file to remove it.
- Store article-owned images in assets/.

Articles may be written manually or generated from verified Git history when requested.
Generated articles must stay within commit messages, diffs, tests, and current code evidence.
The separate `articles/_coverage.json` manifest must account for every meaningful declaration,
branch, protocol event, terminal condition, and test in the article's selected Git scope.
Run `npm run --prefix web check` to verify the coverage anchors against Git history.
Do not invent personal experience or use first-person narration. Run rn-renhua as the final Chinese editing pass.

Series style:

- Start from the Agent Runtime topology, then introduce one runtime concept.
- Explain why the boundary exists before showing code.
- Use small code slices as concrete expressions of the concept.
- End with the proof, current topology node, and one next prerequisite.
- Keep historical behavior separate from the current runtime path.
