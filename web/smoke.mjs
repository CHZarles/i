#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(webDir, '..');
const distDir = path.join(rootDir, 'dist');
const articlesDir = path.join(rootDir, 'articles');
const htmlFiles = await walk(distDir, (file) => file.endsWith('.html'));
const generated = new Set((await walk(distDir, () => true)).map((file) => path.relative(distDir, file)));

if (!generated.has('index.html')) throw new Error('missing dist/index.html');
if (!generated.has('styles.css')) throw new Error('missing dist/styles.css');

const topologyPath = path.join(distDir, 'articles', 'assets', 'topology-provider.svg');
const topology = await readFile(topologyPath, 'utf8');
for (const label of [
  'PROCESS / NETWORK BOUNDARY',
  'runAgentLoop()',
  'StreamFn',
  'Models',
  'Provider',
  'API implementation',
  'Provider SDK / fetch',
  'Provider HTTP API',
  'AssistantMessageEventStream',
  'Tool protocol + executor',
  'Session',
  'AgentHarness',
]) {
  if (!topology.includes(label)) throw new Error(`topology diagram is missing '${label}'`);
}
if (topology.includes('PI-AGENT —') || topology.includes('PI-AI —')) {
  throw new Error('package names must not be presented as runtime layers');
}

for (const file of await walk(path.join(distDir, 'articles', 'assets'), (file) => file.endsWith('.svg'))) {
  const svg = await readFile(file, 'utf8');
  if (!svg.includes('viewBox="0 0 1200 790"')) {
    throw new Error(`${path.relative(distDir, file)}: unexpected topology viewBox`);
  }
}

const publishedSlugs = [];
const publishedSequences = [];
const topologyBySlug = new Map();
for (const name of await readdir(articlesDir)) {
  if (!name.endsWith('.md') || name.startsWith('_')) continue;
  const raw = await readFile(path.join(articlesDir, name), 'utf8');
  const { data, content } = matter(raw);
  if (data.draft === true) continue;
  const slug = path.basename(name, '.md');
  publishedSlugs.push(slug);
  publishedSequences.push(data.sequence);
  if (Object.hasOwn(data, 'commits')) throw new Error(`${name}: commit hashes must not appear in article frontmatter`);
  const topologyImages = [...content.matchAll(/!\[[^\]]*\]\(assets\/(topology-[^)]+\.svg)\)/g)];
  if (topologyImages.length !== 1) throw new Error(`${name}: expected exactly one topology diagram`);
  topologyBySlug.set(slug, topologyImages[0][1]);
}

if (publishedSlugs.length !== 14) throw new Error(`expected 14 focused articles, found ${publishedSlugs.length}`);
assertDeepEqual(
  publishedSequences.slice().sort((a, b) => a - b),
  Array.from({ length: 14 }, (_, index) => index + 1),
  'article sequences must cover 1 through 14 exactly',
);

for (const slug of publishedSlugs) {
  const target = path.join('articles', slug, 'index.html');
  if (!generated.has(target)) throw new Error(`missing generated article: ${target}`);
  const diagram = path.join('articles', 'assets', topologyBySlug.get(slug));
  if (!generated.has(diagram)) throw new Error(`${slug}: missing generated topology diagram ${diagram}`);

  const html = await readFile(path.join(distDir, target), 'utf8');
  const topologyIndex = html.indexOf('class="article-topology"');
  const headerIndex = html.indexOf('class="article-header"');
  if (topologyIndex === -1 || topologyIndex > headerIndex) {
    throw new Error(`${slug}: topology diagram must render before the article header`);
  }
  if ((html.match(/topology-[a-z0-9-]+\.svg/g) ?? []).length !== 1) {
    throw new Error(`${slug}: topology diagram must render exactly once`);
  }
}

for (const file of htmlFiles) {
  const relative = path.relative(distDir, file);
  const html = await readFile(file, 'utf8');
  if (/<script\b/i.test(html)) throw new Error(`${relative}: client-side script is not allowed`);
  if (/class="[^"]*hero/i.test(html)) throw new Error(`${relative}: hero section is not allowed`);
  if (html.includes('/commit/')) throw new Error(`${relative}: commit hashes must not be rendered`);
  for (const phrase of ['这个页面', '本站', '网站会', '这里会', '这篇在讲']) {
    if (html.includes(phrase)) throw new Error(`${relative}: forbidden filler phrase '${phrase}'`);
  }

  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (!target.startsWith('/i/')) continue;
    const clean = target.slice('/i/'.length).split(/[?#]/, 1)[0];
    const outputPath = clean === '' ? 'index.html' : clean.endsWith('/') ? `${clean}index.html` : clean;
    if (!generated.has(outputPath)) throw new Error(`${relative}: broken local link ${target}`);
  }
}

const articleHtml = htmlFiles
  .filter((file) => path.relative(distDir, file).startsWith('articles/'))
  .map((file) => readFile(file, 'utf8'));
if (!(await Promise.all(articleHtml)).some((html) => /class="hljs language-(?:ts|json|bash)"/.test(html))) {
  throw new Error('generated articles are missing syntax highlighting');
}

console.log(`smoke OK · ${htmlFiles.length} pages · ${publishedSlugs.length} articles`);

function assertDeepEqual(actual, expected, message) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(message);
  }
}

async function walk(directory, include) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath, include));
    else if (include(fullPath)) files.push(fullPath);
  }
  return files;
}
