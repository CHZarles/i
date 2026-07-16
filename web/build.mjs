#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(webDir, '..');
const articlesDir = path.join(rootDir, 'articles');
const outputDir = path.join(rootDir, 'dist');
const checkOnly = process.argv.includes('--check');
const basePath = normalizeBase(process.env.BASE_PATH ?? '/i/');
const siteUrl = 'https://chzarles.github.io/i/';

const project = JSON.parse(await readFile(path.join(webDir, 'project.json'), 'utf8'));
const markdown = createMarkdown();
const articles = await loadArticles();

if (checkOnly) {
  console.log(`content check OK · ${articles.length} published articles`);
  process.exit(0);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'styles.css'), await readFile(path.join(webDir, 'styles.css')));
await writeFile(path.join(outputDir, 'favicon.svg'), await readFile(path.join(webDir, 'favicon.svg')));

const assetsDir = path.join(articlesDir, 'assets');
await cp(assetsDir, path.join(outputDir, 'articles', 'assets'), { recursive: true, force: true });

await writeFile(path.join(outputDir, 'index.html'), renderHome());

for (const [index, article] of articles.entries()) {
  const articleDir = path.join(outputDir, 'articles', article.slug);
  await mkdir(articleDir, { recursive: true });
  await writeFile(
    path.join(articleDir, 'index.html'),
    renderArticle(article, articles[index - 1], articles[index + 1]),
  );
}

console.log(`build OK · ${articles.length} articles · ${outputDir}`);

function normalizeBase(value) {
  const clean = `/${value}`.replaceAll(/\/+/g, '/');
  return clean.endsWith('/') ? clean : `${clean}/`;
}

function url(relative = '') {
  return `${basePath}${relative}`.replaceAll(/\/+/g, '/');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createMarkdown() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    highlight(code, language) {
      if (language && hljs.getLanguage(language)) {
        const value = hljs.highlight(code, { language, ignoreIllegals: true }).value;
        return `<pre><code class="hljs language-${escapeHtml(language)}">${value}</code></pre>`;
      }
      return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
    },
  });

  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const source = token.attrGet('src');
    if (source?.startsWith('assets/')) token.attrSet('src', url(`articles/${source}`));
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    return defaultImage(tokens, index, options, env, self);
  };

  const defaultLinkOpen = md.renderer.rules.link_open
    ?? ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const href = token.attrGet('href');
    if (href?.endsWith('.md')) {
      token.attrSet('href', url(`articles/${path.basename(href, '.md')}/`));
    }
    return defaultLinkOpen(tokens, index, options, env, self);
  };

  md.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';

  return md;
}

async function loadArticles() {
  const names = (await readdir(articlesDir))
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .sort();
  const loaded = [];

  for (const name of names) {
    const slug = path.basename(name, '.md');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`${name}: filename must be a lowercase URL slug`);
    }

    const raw = await readFile(path.join(articlesDir, name), 'utf8');
    const { data, content } = matter(raw);
    if (data.draft === true) continue;
    if (typeof data.title !== 'string' || !data.title.trim()) throw new Error(`${name}: title is required`);
    if (!data.date || Number.isNaN(new Date(data.date).getTime())) throw new Error(`${name}: valid date is required`);
    if (!Number.isInteger(data.sequence) || data.sequence < 1) throw new Error(`${name}: positive sequence is required`);
    if (!content.trim()) throw new Error(`${name}: article body is empty`);
    for (const field of ['background', 'problem', 'approach', 'outcome']) {
      if (typeof data[field] !== 'string' || !data[field].trim()) {
        throw new Error(`${name}: ${field} is required`);
      }
    }

    const commits = Array.isArray(data.commits) ? data.commits : [];
    for (const hash of commits) {
      if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error(`${name}: invalid commit hash ${hash}`);
      verifyCommit(hash, name);
    }

    const renderedBody = markdown.render(content);
    const { leadTopology, body } = extractLeadTopology(renderedBody, name);

    loaded.push({
      slug,
      title: data.title.trim(),
      date: toDate(data.date),
      sequence: Number.isInteger(data.sequence) ? data.sequence : 0,
      updated: data.updated ? toDate(data.updated) : undefined,
      summary: typeof data.summary === 'string' ? data.summary.trim() : '',
      tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [],
      commits,
      leadTopology,
      body,
    });
  }

  return loaded.sort((a, b) =>
    b.date.valueOf() - a.date.valueOf()
    || b.sequence - a.sequence
    || a.slug.localeCompare(b.slug));
}

function extractLeadTopology(html, file) {
  const match = html.match(/^<p>(<img\b[^>]*\bsrc="[^"]*\/topology-[^"]+\.svg"[^>]*>)<\/p>\n?/);
  if (!match) throw new Error(`${file}: topology diagram must be the first article element`);

  const leadTopology = match[1]
    .replace('loading="lazy"', 'loading="eager" fetchpriority="high"');

  return {
    leadTopology,
    body: html.slice(match[0].length),
  };
}

function verifyCommit(hash, file) {
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd: rootDir, stdio: 'ignore' });
  } catch {
    throw new Error(`${file}: commit ${hash} does not exist in this repository`);
  }
}

function toDate(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function displayDate(date) {
  return isoDate(date).replaceAll('-', '.');
}

function layout({ title, description, body, canonical = '' }) {
  const fullTitle = title === project.name ? `${project.name} · Agent Runtime` : `${title} · ${project.name}`;
  const canonicalUrl = canonical ? new URL(canonical, siteUrl).href : siteUrl;
  return `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#fbfcfe">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="icon" type="image/svg+xml" href="${url('favicon.svg')}">
  <link rel="stylesheet" href="${url('styles.css')}">
  <title>${escapeHtml(fullTitle)}</title>
</head>
<body>
  <header class="site-header">
    <a class="site-name" href="${url()}">${escapeHtml(project.name)}</a>
    <nav aria-label="主导航">
      <a href="${url()}">文章</a>
      <a href="${escapeHtml(project.repository)}">GitHub</a>
    </nav>
  </header>
  ${body}
  <footer class="site-footer">
    <span>${escapeHtml(project.name)} / Agent Runtime</span>
    <a href="${escapeHtml(project.repository)}">Repository</a>
  </footer>
</body>
</html>`;
}

function renderHome() {
  const groups = Map.groupBy(articles, (article) => String(article.date.getUTCFullYear()));
  const years = [...groups.keys()].sort((a, b) => b.localeCompare(a));
  const list = years.map((year) => `
    <section class="year-group" aria-labelledby="year-${year}">
      <h2 id="year-${year}">${year}</h2>
      <ol class="article-list">
        ${groups.get(year).map(renderArticleRow).join('')}
      </ol>
    </section>`).join('');

  const body = `
  <main class="page home-page">
    <section class="project-summary" aria-labelledby="project-title">
      <h1 id="project-title">${escapeHtml(project.name)}</h1>
      <p>${escapeHtml(project.description)}</p>
      <dl class="project-facts">
        <div><dt>测试</dt><dd>${escapeHtml(project.tests)}</dd></div>
        <div><dt>当前进度</dt><dd>${escapeHtml(project.currentFocus)}</dd></div>
        <div><dt>最近代码</dt><dd><time datetime="${escapeHtml(project.lastCodeDate)}">${escapeHtml(project.lastCodeDate)}</time></dd></div>
      </dl>
    </section>
    <section class="journal-index" aria-labelledby="journal-title">
      <header class="section-header">
        <h2 id="journal-title">实践记录</h2>
        <span>${articles.length} 篇</span>
      </header>
      ${list}
    </section>
  </main>`;
  return layout({ title: project.name, description: project.description, body });
}

function renderArticleRow(article) {
  const tagList = article.tags.length
    ? `<ul class="tag-list">${article.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>`
    : '';
  return `<li class="article-row">
    <time datetime="${isoDate(article.date)}">${displayDate(article.date)}</time>
    <div>
      <h3><a href="${url(`articles/${article.slug}/`)}">${escapeHtml(article.title)}</a></h3>
      ${article.summary ? `<p>${escapeHtml(article.summary)}</p>` : ''}
      <div class="article-meta">${tagList}</div>
    </div>
  </li>`;
}

function renderArticle(article, newer, older) {
  const tags = article.tags.length
    ? `<ul class="tag-list">${article.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>`
    : '';
  const navigation = newer || older
    ? `<nav class="article-navigation" aria-label="文章导航">
        ${older ? `<a href="${url(`articles/${older.slug}/`)}"><span>上一篇</span>${escapeHtml(older.title)}</a>` : '<span></span>'}
        ${newer ? `<a class="next" href="${url(`articles/${newer.slug}/`)}"><span>下一篇</span>${escapeHtml(newer.title)}</a>` : '<span></span>'}
      </nav>`
    : '';
  const body = `
  <main class="article-page">
    <figure class="article-topology">${article.leadTopology}</figure>
    <div class="page article-content">
      <a class="back-link" href="${url()}">← 返回文章列表</a>
      <article>
        <header class="article-header">
          <time datetime="${isoDate(article.date)}">${displayDate(article.date)}</time>
          <h1>${escapeHtml(article.title)}</h1>
          ${article.summary ? `<p>${escapeHtml(article.summary)}</p>` : ''}
          <div class="article-header-meta">${tags}</div>
        </header>
        <div class="prose">${article.body}</div>
      </article>
      ${navigation}
    </div>
  </main>`;
  return layout({
    title: article.title,
    description: article.summary || article.title,
    canonical: `articles/${article.slug}/`,
    body,
  });
}
