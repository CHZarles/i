# `i` —— 个人学习日志 GitHub Page 设计

- **Date**: 2026-07-15
- **Status**: Approved (pending plan)
- **Author**: CHZarles / via brainstorming with claude code
- **Branch context**: main repo `/home/charles/i` (Pi Agent rebuild). This spec adds a
  sibling Astro project under `/home/charles/i/site/`. The main project (`packages/ai`,
  `docs/`, `study_note/`) is **not** modified.

## 1. Goal

A single-page "lab notebook" GitHub Page that:

1. Introduces the project on its own terms (not as "rebuilding Pi").
2. Records personal practice experiences over time, in the author's voice.
3. Surfaces the author's growth alongside the technology.

Git history is referenced manually inside posts only — no API pulls, no auto-timeline.

## 2. Audience and Voice

Three concurrent audiences, in priority order:

1. The author (future self doing post-hoc review).
2. Peers learning TypeScript / Agent runtimes from scratch.
3. Recruiters / potential collaborators skimming for ability and judgement.

Implications:

- Chinese-primary prose; key surfaces (hero, about, summary lines) provide
  English gloss when useful.
- Voice: first-person, judgement-forward, technical-but-accessible. Anti-AI
  polish pass through the `rn-renhua` skill on every draft.
- No brand marketing language. No "passionate / dedicated / mission-driven"
  filler.

## 3. Stack and Repo Layout

Astro static site inside the existing repo:

```
~/i/
├── packages/ai/                # unchanged — main project
├── docs/                       # unchanged — engineering docs
│   └── superpowers/specs/      # NEW — brainstorming / specs land here
├── study_note/                 # unchanged — handwritten raw notes
└── site/                       # NEW — Astro project
    ├── astro.config.mjs
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── content/
    │   │   ├── config.ts        # content collection schema
    │   │   └── posts/*.md       # one .md per learning entry
    │   ├── layouts/
    │   │   └── Base.astro       # terminal-beige shell
    │   ├── components/
    │   │   ├── Header.astro
    │   │   ├── PostCard.astro
    │   │   ├── StatusBar.astro
    │   │   └── Topology.astro
    │   ├── pages/
    │   │   └── index.astro
    │   └── styles/
    │       └── global.css       # tokens, mono stack, ASCII dividers
    └── public/
        └── favicon.svg
```

Constraints:

- YAGNI: no search, no theme toggle, no analytics, no comment system.
- No client-side JS beyond what Astro injects for content hydration.
- No Tailwind / CSS framework. Hand-written CSS only.
- Marked-line dependencies pinned exactly; lockfile committed.

## 4. Routes and Pages

| Route             | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `/`               | The single-page lab notebook (this spec).      |
| `/journal/<slug>` | Optional per-post deep page (stub only at v1). |
| `/rss.xml`        | Optional RSS feed for the journal (v2 only).   |

v1 ships only `/`. The optional `/journal/[slug]` page is wired but only
filled if a post explicitly opts-in via frontmatter (`longform: true`) and is
**not blocked by the absence of the route**.

## 5. Content Model

`src/content/config.ts` schema for the `posts` collection:

```ts
{
  title: string,        // required
  date: string,         // required, ISO YYYY-MM-DD
  tags: string[],       // required, ≥1 entry; free vocabulary (types, auth,
                        // provider, adapter, sse, agent-loop, harness,
                        // session, reflect, ...)
  summary: string,      // required, ≤140 zh-chars, used on cards and <meta>
  longform?: boolean,   // if true, also exposed at /journal/<slug>
  draft?: boolean       // default false; drafts skipped in production build
}
```

Permalink generation:

- Files named `YYYY-MM-DD-<slug>.md`. If a date in frontmatter mismatches the
  filename, the **filename wins** and a build warning is logged.

Ordering: posts render in `date` descending order. Ties broken by file mtime.

## 6. Page Anatomy (Single-Index Sections, Top to Bottom)

```
┌─ Header (sticky, ~32px)                                  ─┐
│ $ i · agent runtime core          ← repo / about anchors  │
├───────────────────────────────────────────────────────────┤
│ ## what's this                                           │
│  one-paragraph intro on the project's own terms,         │
│  not framed as "rebuild Pi". links → repo, status.       │
├───────────────────────────────────────────────────────────┤
│ ## status                                                │
│   tests: 19/19 ✓   last touch: 2026-07-14                │
│   focus: anthropic sse frame → events mapping            │
│   (hand-maintained; updated when a post is added)        │
├───────────────────────────────────────────────────────────┤
│ ## now                                                   │
│  the latest 1–3 entries, with summary + tags + date.     │
│  rendered as PostCards.                                  │
├───────────────────────────────────────────────────────────┤
│ ## growth log                                            │
│  full archive, every entry, grouped by year. each entry  │
│  = date · title · tags. expanded view on click (no nav).│
├───────────────────────────────────────────────────────────┤
│ ## topology                                              │
│  ASCII / SVG topology snapshot:                          │
│  types → auth → provider → api adapter →                 │
│  tool protocol → agent loop → agent / session → harness  │
│  gated entries are annotated `▢ pending`.               │
├───────────────────────────────────────────────────────────┤
│ ## about                                                 │
│  author, contact, repo link, "这里不写重建 Pi"备注       │
└───────────────────────────────────────────────────────────┘
```

Each post card on click expands in-place (details/summary or controlled state).
No page navigation between posts keeps the reader inside the lab-book feel.

## 7. Visual System (Terminal-Beige Tokens)

| Token             | Value                              | Use                                |
| ----------------- | ---------------------------------- | ---------------------------------- |
| `--bg`            | `#f5f1e8`                          | page background                    |
| `--bg-elev`       | `#ede5d2`                          | code blocks, status strip          |
| `--fg`            | `#1a1a1a`                          | primary text                       |
| `--fg-muted`      | `#7a6f5f`                          | metadata, dates, captions          |
| `--rule`          | `#c8bfae`                          | ASCII `─` dividers, table rules    |
| `--accent`        | `#1f3a8a`                          | links, hover underlines            |
| `--accent-hover`  | `#1e40af`                          | active links                       |

Typography:

- Single stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, "Roboto Mono",
  monospace`. Everything — headings, body, code, captions — uses this.
- Heading scale: 1.6rem (h2) / 1.25rem (h3) / 1rem (body). Left-aligned.
- Body line-height: 1.65. Max width on `#main`: 70ch.
- ASCII rule character `─` rendered with `font-family` reset and CSS
  `letter-spacing: 0.2em`. No `border-bottom`.

No box-shadow. No gradients. No rounded corners. No emoji (per global
preference).

## 8. Manual Git Reference Convention

Inside posts, commits cited as:

```
→ commit 7325e31 · read anthropic sse byte stream
```

No GitHub API calls. No auto-generated commit log. A post's facts about a
commit are whatever the author writes in the post. This is intentional; an
auto-timeline would drift away from the manual narrative.

## 9. Deployment

- Astro build output → `site/dist/`.
- GitHub Action on push to `main` (and manual `workflow_dispatch`):
  - job `build`: `node 22`, `npm ci`, `npm run --prefix site build`,
    upload `site/dist` artifact.
  - job `deploy`: `actions/deploy-pages@v4`, environment `github-pages`.
- Settings: Pages source = "GitHub Actions". Custom domain: none (default
  `CHzarles.github.io/i`).
- Badges in `## status` section are static text, not live API queries.

## 10. Workflow (Manual Markdown)

The author writes a new entry:

1. `vim site/src/content/posts/2026-07-20-<slug>.md`.
2. Fill frontmatter `title / date / tags / summary`.
3. Write the prose; cite commits inline with the `→ commit <hash> · <message>`
   pattern when relevant.
4. (Optional) Run `rn-renhua` on the draft to strip AI-flavor.
5. `git add site/src/content/posts/... && git commit && git push`.

GitHub Action builds and publishes. No local scripts. No CLI scaffolds.

## 11. Initial Seed Content (v1 Backfill)

The first commit batch draws from
`study_note/rebuilding-pi-agent-core-practice.md`, split into dated posts:

| File                                          | Source section (study_note)                       |
| --------------------------------------------- | ------------------------------------------------ |
| `2026-07-02-types-and-runtime.md`             | "一开始最容易犯的错误" + "成功经验一"               |
| `2026-07-05-auth-and-providers.md`            | "成功经验二"                                       |
| `2026-07-08-message-conversion.md`            | "成功经验三"                                       |
| `2026-07-14-sse-decoder-layers.md`            | "成功经验四" + "失败经验一" + "失败经验二"         |
| `2026-07-14-reflect-and-commit-strategy.md`    | "失败经验三/四/五" + "提交策略" + "最终总结"        |
| `2026-07-15-introducing-the-site.md`          | (new) explains the site itself, in author voice    |

Each seeded post gets an `rn-renhua` pass before commit. The `## introducing`
post is written last and explains what readers are looking at.

## 12. Quality Gates

Per YAGNI, no unit tests on the static site. Quality is enforced by:

1. **Build gate**: `npm run --prefix site build` must succeed on every push.
   Action fails the deploy on type errors or Astro warnings treated as errors.
2. **Content gate**: a small repo-side script `site/scripts/check-posts.mjs`
   runs in CI to assert:
   - every post has non-empty `title / date / tags / summary`
   - every commit hash cited is `^[0-9a-f]{7,40}$`
   - summary length ≤ 140 characters (JS `string.length`; emoji counted as
     2 surrogate pairs, which still keeps practical posts well under any
     card-truncation length)
3. **Manual gate**: author reviews `site/dist/` via `astro preview` before
   merging to main if the post is a public-facing entry.

## 13. Out of Scope (v1)

Explicitly excluded to keep the surface small:

- Search.
- Dark mode toggle.
- Comments / feedback widget.
- Per-post URLs (`/journal/<slug>`) until a post opts in.
- i18n toggles.
- Comments / analytics / telemetry.
- Reusing the main repo's `package.json` (separate Astro project keeps
  `node_modules` clean and prevents accidental coupling).

## 14. Risks and Mitigations

| Risk                                               | Mitigation                                          |
| -------------------------------------------------- | --------------------------------------------------- |
| Drift between study_note and posts                 | Author posts selectively. Linking back is optional. |
| CI / Pages misconfigured silently                  | First deploy uses `workflow_dispatch`, manual eyes. |
| Posts start sounding AI-ish                        | `rn-renhua` pass per draft.                         |
| `node_modules` from `/site/` collides with root    | Root `package.json` excludes `site/**/node_modules`. |
| Bad frontmatter blocks build silently              | The `check-posts.mjs` script in CI surfaces issues. |

## 15. Open Questions

None at design freeze. Future evolution surfaces (search, RSS, comments) go
through their own brainstorm cycles when triggered.
