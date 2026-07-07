import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
  // Test fixtures are synthetic sample docs (deliberately missing/varied
  // frontmatter to exercise parser tolerance); they are not project docs.
  '__fixtures__',
]);
// Generated, git-ignored directories that hold machine-produced Markdown which
// this linter must not police (frontmatter/links are the generator's concern).
// The TypeDoc API reference (WP6 T5) is regenerated into the docs site on every
// build and validated by TypeDoc + starlight-links-validator, not here.
const ignoredRelativePaths = [
  path.join('apps', 'docs', 'src', 'content', 'docs', 'reference', 'api'),
];
const markdownLinkPattern = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
const markdownHeadingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
const failures = [];

function isIgnoredPath(fullPath) {
  const relative = path.relative(repoRoot, fullPath);
  return ignoredRelativePaths.some(
    (ignored) => relative === ignored || relative.startsWith(ignored + path.sep),
  );
}

function collectMarkdownFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const child = path.join(directory, entry.name);
      if (!ignoredDirectories.has(entry.name) && !isIgnoredPath(child)) {
        files.push(...collectMarkdownFiles(child));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function isExternalLink(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target);
}

function resolveLink(filePath, rawTarget) {
  if (isExternalLink(rawTarget)) {
    return null;
  }

  const targetWithoutFragment = rawTarget.split('#')[0].split('?')[0];

  if (!targetWithoutFragment) {
    return null;
  }

  return path.resolve(path.dirname(filePath), decodeURI(targetWithoutFragment));
}

function isExistingPath(targetPath) {
  if (!targetPath) {
    return true;
  }

  if (existsSync(targetPath)) {
    return true;
  }

  if (existsSync(`${targetPath}.md`)) {
    return true;
  }

  const readmePath = path.join(targetPath, 'README.md');
  return existsSync(readmePath) && statSync(readmePath).isFile();
}

function checkFile(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  const relativeFile = path.relative(repoRoot, filePath);

  checkFrontmatter(relativeFile, contents);
  checkDuplicateHeadings(relativeFile, contents);

  if (!relativeFile.startsWith('.copilot-tracking/')) {
    for (const match of contents.matchAll(markdownLinkPattern)) {
      const rawTarget = match[2].trim();
      const resolvedTarget = resolveLink(filePath, rawTarget);

      if (!isExistingPath(resolvedTarget)) {
        failures.push(`${relativeFile}: broken link to ${rawTarget}`);
      }
    }
  }
}

function checkFrontmatter(relativeFile, contents) {
  if (relativeFile.startsWith('.copilot-tracking/')) {
    return;
  }

  if (contents.startsWith('<!-- markdownlint-disable-file -->')) {
    return;
  }

  if (!contents.startsWith('---\n')) {
    failures.push(`${relativeFile}: missing YAML frontmatter`);
    return;
  }

  const closingDelimiterIndex = contents.indexOf('\n---\n', 4);

  if (closingDelimiterIndex === -1) {
    failures.push(`${relativeFile}: invalid YAML frontmatter block`);
    return;
  }

  const frontmatter = contents.slice(4, closingDelimiterIndex).trim();

  if (!/^title:\s*.+$/m.test(frontmatter)) {
    failures.push(`${relativeFile}: frontmatter missing title`);
  }

  if (!/^description:\s*.+$/m.test(frontmatter)) {
    failures.push(`${relativeFile}: frontmatter missing description`);
  }
}

function normalizeHeading(heading) {
  return heading
    .replace(/`([^`]+)`/g, '$1')
    .trim()
    .toLowerCase();
}

function checkDuplicateHeadings(relativeFile, contents) {
  if (relativeFile.startsWith('.copilot-tracking/')) {
    return;
  }

  const headings = new Set();

  for (const match of contents.matchAll(markdownHeadingPattern)) {
    const headingText = normalizeHeading(match[2]);

    if (headings.has(headingText)) {
      failures.push(`${relativeFile}: duplicate heading "${match[2].trim()}"`);
      continue;
    }

    headings.add(headingText);
  }
}

const misspelledCopilotInstructions = path.join(repoRoot, '.github', 'copilot-instrutions.md');
const standardCopilotInstructions = path.join(repoRoot, '.github', 'copilot-instructions.md');

if (existsSync(misspelledCopilotInstructions)) {
  failures.push('Remove .github/copilot-instrutions.md; use copilot-instructions.md');
}

if (!existsSync(standardCopilotInstructions)) {
  failures.push('Missing .github/copilot-instructions.md');
}

for (const filePath of collectMarkdownFiles(repoRoot)) {
  checkFile(filePath);
}

if (failures.length > 0) {
  console.error('Documentation checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Documentation checks passed.');
