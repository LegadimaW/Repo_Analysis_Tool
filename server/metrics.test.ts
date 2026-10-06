import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { analyzeRepository, parseGitLog } from './metrics.js';

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
});
