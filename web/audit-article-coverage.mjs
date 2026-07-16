#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, '..');
const require = createRequire(path.join(webDir, 'package.json'));
const matter = require('gray-matter');
const coverageManifest = JSON.parse(
  await readFile(path.join(repoRoot, 'articles', '_coverage.json'), 'utf8'),
);

const requested = process.argv.slice(2);
const articleFiles = requested.length > 0
  ? requested
  : execFileSync('bash', ['-lc', "printf '%s\\n' articles/*.md"], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim().split('\n').filter((file) => !path.basename(file).startsWith('_'));

let anchorCount = 0;
let declarationCount = 0;
const failures = [];
const scopeContents = new Map();

for (const relativeFile of articleFiles) {
  const absoluteFile = path.resolve(repoRoot, relativeFile);
  const raw = await readFile(absoluteFile, 'utf8');
  const { content } = matter(raw);
  const slug = path.basename(relativeFile, '.md');
  const evidence = coverageManifest[slug];
  const commits = Array.isArray(evidence?.commits) ? evidence.commits.map(String) : [];
  const coverage = Array.isArray(evidence?.coverage) ? evidence.coverage : [];

  check(evidence, `${relativeFile}: articles/_coverage.json has no entry for ${slug}`);
  check(commits.length > 0, `${relativeFile}: manifest commits must list the inspected Git states`);
  check(coverage.length > 0, `${relativeFile}: manifest coverage must list scoped paths and anchors`);

  const coveredCommits = new Set();

  for (const entry of coverage) {
    const commit = String(entry?.commit ?? '');
    const file = String(entry?.path ?? '');
    const anchors = Array.isArray(entry?.anchors) ? entry.anchors.map(String) : [];

    check(commits.includes(commit), `${relativeFile}: coverage commit ${commit} is absent from commits`);
    check(file.length > 0, `${relativeFile}: coverage entry for ${commit} needs a path`);
    check(anchors.length > 0, `${relativeFile}: ${commit}:${file} needs at least one anchor`);

    const changedFiles = git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit]);
    check(
      changedFiles.split('\n').includes(file),
      `${relativeFile}: ${file} did not change in ${commit}`,
    );

    const state = readGitFile(commit, file);
    const parent = readGitFile(`${commit}^`, file);
    const searchableGitState = `${parent}\n${state}`;

    for (const anchor of anchors) {
      check(
        searchableGitState.includes(anchor),
        `${relativeFile}: anchor ${JSON.stringify(anchor)} is absent from ${commit}:${file} and its parent`,
      );
      check(
        content.includes(anchor),
        `${relativeFile}: article body does not cover anchor ${JSON.stringify(anchor)}`,
      );
      anchorCount += 1;
    }

    const scopeKey = `${commit}\0${file}`;
    scopeContents.set(scopeKey, `${scopeContents.get(scopeKey) ?? ''}\n${content}`);

    coveredCommits.add(commit);
  }

  for (const commit of commits) {
    check(coveredCommits.has(commit), `${relativeFile}: commit ${commit} has no coverage entry`);
  }
}

if (requested.length === 0) {
  for (const [scopeKey, combinedContent] of scopeContents) {
    const [commit, file] = scopeKey.split('\0');
    const diff = git(['show', '--format=', '--unified=0', commit, '--', file]);

    for (const declaration of changedDeclarations(diff)) {
      declarationCount += 1;
      check(
        combinedContent.includes(declaration),
        `${commit}:${file}: changed declaration or test ${JSON.stringify(declaration)} is absent from the scoped articles`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(
  `coverage audit OK - ${articleFiles.length} articles - ${anchorCount} anchors - ${declarationCount} changed declarations/tests`,
);

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function readGitFile(revision, file) {
  try {
    return execFileSync('git', ['show', `${revision}:${file}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function changedDeclarations(diff) {
  const declarations = new Set();

  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const added = line.slice(1);
    const declaration = added.match(/^\s*(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/)
      ?? added.match(/^\s*(?:export\s+)?(?:interface|type|class)\s+([A-Za-z_$][\w$]*)/)
      ?? added.match(/^\s*export\s+const\s+([A-Za-z_$][\w$]*)/);
    if (declaration) declarations.add(declaration[1]);

    const testName = added.match(/^\s*test\(\s*["']([^"']+)["']/);
    if (testName) declarations.add(testName[1]);
  }

  return declarations;
}

function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}
