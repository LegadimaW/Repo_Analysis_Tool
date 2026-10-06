import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import type { RepositorySummary } from '../shared/types.js';

const exec = promisify(execFile);
const DATA_DIR = path.resolve(process.env.RAT_DATA_DIR ?? '.rat-data');
const REPOS_DIR = path.join(DATA_DIR, 'repositories');
const INDEX_FILE = path.join(DATA_DIR, 'repositories.json');

interface StoredRepository extends RepositorySummary {
  path: string;
}

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', repoPath, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout.trim();
}

function publicSummary(repository: StoredRepository): RepositorySummary {
  const { path: _path, ...summary } = repository;
  return summary;
}

function safeRepositoryName(value: string): string {
  const withoutQuery = value.replace(/[?#].*$/, '');
  const segment = withoutQuery.split('/').filter(Boolean).at(-1) ?? 'repository';
  return segment.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-') || 'repository';
}

async function locateGitRoot(directory: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  try {
    await git(directory, ['rev-parse', '--git-dir']);
    return directory;
  } catch {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '__MACOSX') {
        const found = await locateGitRoot(path.join(directory, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
}

async function describeRepository(
  id: string,
  repoPath: string,
  name: string,
  source: string,
  aliases: Record<string, string> = {},
): Promise<StoredRepository> {
  const [branch, head, count] = await Promise.all([
    git(repoPath, ['branch', '--show-current']),
    git(repoPath, ['rev-parse', 'HEAD']),
    git(repoPath, ['rev-list', '--count', '--no-merges', 'HEAD']),
  ]);
  return {
    id,
    name,
    source,
    path: repoPath,
    branch: branch || 'detached HEAD',
    head,
    addedAt: new Date().toISOString(),
    commitCount: Number(count),
    aliases,
  };
}

export class RepositoryStore {
  private repositories = new Map<string, StoredRepository>();

  async init(): Promise<void> {
    await mkdir(REPOS_DIR, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as StoredRepository[];
      this.repositories = new Map(saved.map((repository) => [repository.id, repository]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  list(): RepositorySummary[] {
    return [...this.repositories.values()]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .map(publicSummary);
  }

  get(id: string): StoredRepository {
    const repository = this.repositories.get(id);
    if (!repository) throw new Error('Repository not found');
    return repository;
  }

  async clone(url: string): Promise<RepositorySummary> {
    if (!/^(https?|git):\/\//i.test(url)) {
      throw new Error('Use a public HTTP(S) or git:// clone URL');
    }
    const id = randomUUID();
    const destination = path.join(REPOS_DIR, id);
    try {
      await exec('git', ['clone', '--no-single-branch', '--', url, destination], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 10 * 60_000,
      });
      const repository = await describeRepository(id, destination, safeRepositoryName(url), url);
      this.repositories.set(id, repository);
      await this.persist();
      return publicSummary(repository);
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }

  async importZip(buffer: Buffer, filename: string): Promise<RepositorySummary> {
    const id = randomUUID();
    const destination = path.join(REPOS_DIR, id);
    await mkdir(destination, { recursive: true });
    try {
      const archive = new AdmZip(buffer);
      for (const entry of archive.getEntries()) {
        const normalized = entry.entryName.replace(/\\/g, '/');
        if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
          throw new Error(`Unsafe path in archive: ${entry.entryName}`);
        }
        const target = path.resolve(destination, normalized);
        if (!target.startsWith(`${destination}${path.sep}`) && target !== destination) {
          throw new Error(`Unsafe path in archive: ${entry.entryName}`);
        }
        if (entry.isDirectory) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, entry.getData());
        }
      }
      const root = await locateGitRoot(destination);
      if (!root) throw new Error('The zip does not contain a usable Git repository');
      const repository = await describeRepository(
        id,
        root,
        safeRepositoryName(filename.replace(/\.zip$/i, '')),
        `zip:${filename}`,
      );
      this.repositories.set(id, repository);
      await this.persist();
      return publicSummary(repository);
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }

  async setAliases(id: string, aliases: Record<string, string>): Promise<RepositorySummary> {
    const repository = this.get(id);
    repository.aliases = aliases;
    await this.persist();
    return publicSummary(repository);
  }

  async remove(id: string): Promise<void> {
    const repository = this.get(id);
    this.repositories.delete(id);
    await this.persist();
    const managedRoot = path.join(REPOS_DIR, id);
    if (repository.path.startsWith(managedRoot)) {
      await rm(managedRoot, { recursive: true, force: true });
    }
  }

  private async persist(): Promise<void> {
    const temporary = `${INDEX_FILE}.tmp`;
    await writeFile(temporary, JSON.stringify([...this.repositories.values()], null, 2));
    await rename(temporary, INDEX_FILE);
  }
}

export { git };
