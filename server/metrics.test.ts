import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { analyzeHistory, analyzeRepository, parseGitLog, type RawCommit } from './metrics.js';

const exec = promisify(execFile);
let repositoryPath: string;

async function git(args: string[], env: Record<string, string> = {}) {
  await exec('git', ['-C', repositoryPath, ...args], { env: { ...process.env, ...env } });
}

before(async () => {
  repositoryPath = await mkdtemp(path.join(tmpdir(), 'rat-test-'));
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Alice']);
  await git(['config', 'user.email', 'alice@example.com']);
  await mkdir(path.join(repositoryPath, 'src'));
  await writeFile(path.join(repositoryPath, 'src/app.ts'), 'const one = 1;\nconst two = 2;\n');
  await writeFile(path.join(repositoryPath, 'README.md'), '# Fixture\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'Initial project']);

  await writeFile(path.join(repositoryPath, 'src/app.ts'), 'const one = 1;\nconst two = 2;\nconst three = 3;\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'Add third line'], {
    GIT_AUTHOR_NAME: 'Bob',
    GIT_AUTHOR_EMAIL: 'bob@example.com',
    GIT_COMMITTER_NAME: 'Bob',
    GIT_COMMITTER_EMAIL: 'bob@example.com',
  });
});

after(async () => {
  await rm(repositoryPath, { recursive: true, force: true });
});

describe('Git metric analysis', () => {
  it('parses text changes and ignores binary numstat entries', () => {
    const output = '\u001eabc\u001fAlice\u001falice@example.com\u001f100\u001fMessage\n2\t1\tsrc/{old.ts => new.ts}\n-\t-\timage.png\n';
    const [commit] = parseGitLog(output);
    assert.deepEqual(commit.files, [{ path: 'src/new.ts', added: 2, removed: 1 }]);
  });

  it('computes repository, file, directory, commit-set, and author metrics', async () => {
    const result = await analyzeRepository({
      id: 'fixture', name: 'fixture', path: repositoryPath, head: 'HEAD', aliases: {},
    });
    assert.equal(result.commitCount, 2);
    assert.deepEqual(
      { added: result.totals.added, removed: result.totals.removed, growth: result.totals.growth, churn: result.totals.churn, modifications: result.totals.modifications },
      { added: 4, removed: 0, growth: 4, churn: 4, modifications: 2 },
    );
    assert.deepEqual(
      result.files.find((file) => file.path === 'src/app.ts'),
      { path: 'src/app.ts', kind: 'file', added: 3, removed: 0, growth: 3, churn: 3, modifications: 2, modificationFrequency: 1, churnRate: 1.5 },
    );
    const source = result.directories.find((directory) => directory.path === 'src');
    assert.deepEqual({ added: source?.added, churn: source?.churn, modifications: source?.modifications }, { added: 3, churn: 3, modifications: 2 });
    const root = result.directories.find((directory) => directory.path === '.');
    assert.deepEqual({ added: root?.added, churn: root?.churn, modifications: root?.modifications }, { added: 4, churn: 4, modifications: 2 });
    assert.equal(result.authors.length, 2);
  });

  it('filters by canonical author and supports manual identity merging', async () => {
    const filtered = await analyzeRepository(
      { id: 'fixture', name: 'fixture', path: repositoryPath, head: 'HEAD', aliases: {} },
      { authors: ['Bob <bob@example.com>'] },
    );
    assert.equal(filtered.totals.churn, 1);
    assert.equal(filtered.commitCount, 1);

    const merged = await analyzeRepository({
      id: 'fixture', name: 'fixture', path: repositoryPath, head: 'HEAD',
      aliases: { 'Bob <bob@example.com>': 'Alice <alice@example.com>' },
    });
    assert.equal(merged.authors.length, 1);
    assert.deepEqual(
      { key: merged.authors[0].key, email: merged.authors[0].email, churn: merged.authors[0].churn, ownership: merged.authors[0].ownership },
      { key: 'Alice <alice@example.com>', email: 'alice@example.com', churn: 4, ownership: 1 },
    );
  });

  it('paginates and searches analytical tables on the server', () => {
    const commits: RawCommit[] = Array.from({ length: 60 }, (_, index) => ({
      hash: index.toString(16).padStart(40, '0'),
      author: 'Scale Author',
      email: 'scale@example.com',
      timestamp: 1_700_000_000 + index,
      subject: `Change ${index}`,
      files: [{ path: `src/file-${index}.ts`, added: 1, removed: 0 }],
    }));
    const repository = { id: 'pagination', name: 'pagination', head: 'head', aliases: {} };
    const page = analyzeHistory(repository, commits, {}, { view: 'files', page: 2, pageSize: 25 });
    assert.equal(page.pages.files.total, 60);
    assert.equal(page.pages.files.page, 2);
    assert.equal(page.files.length, 25);

    const searched = analyzeHistory(repository, commits, {}, { view: 'files', query: 'file-42' });
    assert.equal(searched.pages.files.total, 1);
    assert.equal(searched.files[0].path, 'src/file-42.ts');
  });

  it('keeps a 100,000-commit analysis bounded and interactive', { timeout: 30_000 }, () => {
    const commits: RawCommit[] = Array.from({ length: 100_000 }, (_, index) => ({
      hash: index.toString(16).padStart(40, '0'),
      author: `Author ${index % 50}`,
      email: `author-${index % 50}@example.com`,
      timestamp: 1_600_000_000 + index,
      subject: `Synthetic change ${index}`,
      files: [{ path: `packages/pkg-${index % 100}/src/file-${index % 1000}.ts`, added: 1, removed: index % 3 }],
    }));
    const started = performance.now();
    const result = analyzeHistory(
      { id: 'scale', name: 'scale', head: 'head', aliases: {} },
      commits,
      {},
      { view: 'commits', page: 400, pageSize: 250 },
    );
    const elapsed = performance.now() - started;

    assert.equal(result.commitCount, 100_000);
    assert.equal(result.pages.commits.total, 100_000);
    assert.equal(result.pages.commits.page, 400);
    assert.equal(result.commits.length, 250);
    assert.equal(result.totals.added, 100_000);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1_000_000, 'paginated payload should stay below 1 MB');
    assert.ok(elapsed < 15_000, `100k analysis took ${elapsed.toFixed(0)} ms`);
  });
});
