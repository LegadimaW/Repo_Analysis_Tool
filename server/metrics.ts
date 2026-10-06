import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AnalysisFilters,
  AnalysisResult,
  AuthorMetric,
  CommitInfo,
  MetricTotals,
  ObjectMetric,
} from '../shared/types.js';

const exec = promisify(execFile);

interface ChangedFile {
  path: string;
  added: number;
  removed: number;
}

interface RawCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  files: ChangedFile[];
}

interface RepositoryInput {
  id: string;
  name: string;
  path: string;
  head: string;
  aliases: Record<string, string>;
}

const cache = new Map<string, { head: string; commits: RawCommit[] }>();

function resolveRename(rawPath: string): string {
  if (!rawPath.includes(' => ')) return rawPath;
  const braced = rawPath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`;
  return rawPath.slice(rawPath.lastIndexOf(' => ') + 4);
}

export function parseGitLog(output: string): RawCommit[] {
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const lines = record.split('\n');
      const [hash, author, email, timestamp, ...subjectParts] = lines.shift()!.split('\x1f');
      const files: ChangedFile[] = [];
      for (const line of lines) {
        const [addedText, removedText, ...pathParts] = line.split('\t');
        if (!addedText || !removedText || pathParts.length === 0) continue;
        if (addedText === '-' || removedText === '-') continue;
        const added = Number(addedText);
        const removed = Number(removedText);
        if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
        files.push({ path: resolveRename(pathParts.join('\t')), added, removed });
      }
      return {
        hash,
        author,
        email: email.toLowerCase(),
        timestamp: Number(timestamp),
        subject: subjectParts.join('\x1f'),
        files,
      };
    });
}

async function loadHistory(repository: RepositoryInput): Promise<RawCommit[]> {
  const cached = cache.get(repository.id);
  if (cached?.head === repository.head) return cached.commits;
  const { stdout } = await exec(
    'git',
    [
      '-C',
      repository.path,
      'log',
      'HEAD',
      '--no-merges',
      '--date-order',
      '--use-mailmap',
      '--find-renames=50%',
      '--format=%x1e%H%x1f%aN%x1f%aE%x1f%ct%x1f%s',
      '--numstat',
    ],
    { maxBuffer: 1024 * 1024 * 1024, timeout: 15 * 60_000 },
  );
  const commits = parseGitLog(stdout);
  cache.set(repository.id, { head: repository.head, commits });
  return commits;
}

function identityKey(name: string, email: string): string {
  return `${name} <${email.toLowerCase()}>`;
}

function canonicalKey(key: string, aliases: Record<string, string>): string {
  let current = key;
  const visited = new Set<string>();
  while (aliases[current] && !visited.has(current)) {
    visited.add(current);
    current = aliases[current];
  }
  return current;
}

function directoryAncestors(filePath: string): string[] {
  const parts = filePath.split('/');
  const directories = ['.'];
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join('/'));
  }
  return directories;
}

function emptyTotals(): MetricTotals {
  return {
    added: 0,
    removed: 0,
    growth: 0,
    churn: 0,
    modifications: 0,
    modificationFrequency: 0,
    churnRate: 0,
  };
}

function addChange(target: MetricTotals, added: number, removed: number): void {
  target.added += added;
  target.removed += removed;
  target.growth += added - removed;
  target.churn += added + removed;
}

function finalize<T extends MetricTotals>(metric: T, commitCount: number): T {
  metric.modificationFrequency = commitCount ? metric.modifications / commitCount : 0;
  metric.churnRate = commitCount ? metric.churn / commitCount : 0;
  return metric;
}

function matchesPath(filePath: string, paths: string[]): boolean {
  return paths.length === 0 || paths.some((selected) => (
    selected === '.' || filePath === selected || filePath.startsWith(`${selected}/`)
  ));
}

export async function analyzeRepository(
  repository: RepositoryInput,
  filters: AnalysisFilters = {},
): Promise<AnalysisResult> {
  const history = await loadHistory(repository);
  const identities = new Map<string, { key: string; name: string; email: string }>();
  for (const commit of history) {
    const key = identityKey(commit.author, commit.email);
    identities.set(key, { key, name: commit.author, email: commit.email });
  }

  const canonicalIdentity = (commit: RawCommit) => {
    const sourceKey = identityKey(commit.author, commit.email);
    const key = canonicalKey(sourceKey, repository.aliases);
    return identities.get(key) ?? { key, name: commit.author, email: commit.email };
  };

  const selectedHashes = new Set(filters.commits ?? []);
  const selectedAuthors = new Set(filters.authors ?? []);
  const selectedPaths = filters.paths ?? [];
  const selected = history.filter((commit) => {
    const identity = canonicalIdentity(commit);
    if (selectedHashes.size && !selectedHashes.has(commit.hash)) return false;
    if (filters.from !== undefined && commit.timestamp < filters.from) return false;
    if (filters.to !== undefined && commit.timestamp >= filters.to) return false;
    return !selectedAuthors.size || selectedAuthors.has(identity.key);
  });

  const totals = emptyTotals();
  const files = new Map<string, ObjectMetric>();
  const directories = new Map<string, ObjectMetric>();
  const authors = new Map<string, AuthorMetric>();
  const commits: CommitInfo[] = [];

  for (const commit of selected) {
    const relevantFiles = commit.files.filter((file) => matchesPath(file.path, selectedPaths));
    const identity = canonicalIdentity(commit);
    const authorMetric = authors.get(identity.key) ?? {
      ...emptyTotals(),
      key: identity.key,
      author: identity.name,
      email: identity.email,
      ownership: 0,
    };
    authors.set(identity.key, authorMetric);

    let commitAdded = 0;
    let commitRemoved = 0;
    const changedDirectories = new Map<string, { added: number; removed: number }>();

    for (const change of relevantFiles) {
      commitAdded += change.added;
      commitRemoved += change.removed;
      const fileMetric = files.get(change.path) ?? {
        ...emptyTotals(),
        path: change.path,
        kind: 'file' as const,
      };
      addChange(fileMetric, change.added, change.removed);
      if (change.added + change.removed > 0) fileMetric.modifications += 1;
      files.set(change.path, fileMetric);

      for (const directory of directoryAncestors(change.path)) {
        const current = changedDirectories.get(directory) ?? { added: 0, removed: 0 };
        current.added += change.added;
        current.removed += change.removed;
        changedDirectories.set(directory, current);
      }
    }

    for (const [directory, change] of changedDirectories) {
      const directoryMetric = directories.get(directory) ?? {
        ...emptyTotals(),
        path: directory,
        kind: 'directory' as const,
      };
      addChange(directoryMetric, change.added, change.removed);
      if (change.added + change.removed > 0) directoryMetric.modifications += 1;
      directories.set(directory, directoryMetric);
    }

    addChange(totals, commitAdded, commitRemoved);
    addChange(authorMetric, commitAdded, commitRemoved);
    if (commitAdded + commitRemoved > 0) {
      totals.modifications += 1;
      authorMetric.modifications += 1;
    }
    commits.push({
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 8),
      author: identity.name,
      email: identity.email,
      timestamp: commit.timestamp,
      subject: commit.subject,
      added: commitAdded,
      removed: commitRemoved,
      churn: commitAdded + commitRemoved,
      files: relevantFiles.length,
    });
  }

  const commitCount = selected.length;
  finalize(totals, commitCount);
  const fileResults = [...files.values()].map((metric) => finalize(metric, commitCount));
  const directoryResults = [...directories.values()].map((metric) => finalize(metric, commitCount));
  const authorResults = [...authors.values()].map((metric) => {
    finalize(metric, commitCount);
    metric.ownership = totals.churn ? metric.churn / totals.churn : 0;
    return metric;
  });

  const availableAuthors = new Map<string, { key: string; name: string; email: string }>();
  const availableFiles = new Set<string>();
  const availableDirectories = new Set<string>(['.']);
  for (const commit of history) {
    const identity = canonicalIdentity(commit);
    availableAuthors.set(identity.key, identity);
    for (const file of commit.files) {
      availableFiles.add(file.path);
      directoryAncestors(file.path).forEach((directory) => availableDirectories.add(directory));
    }
  }
  const timestamps = history.map((commit) => commit.timestamp);
  const byChurn = <T extends MetricTotals>(a: T, b: T) => b.churn - a.churn;

  return {
    repositoryId: repository.id,
    repositoryName: repository.name,
    generatedAt: new Date().toISOString(),
    commitCount,
    totalCommitCount: history.length,
    totals,
    files: fileResults.sort(byChurn),
    directories: directoryResults.sort(byChurn),
    authors: authorResults.sort(byChurn),
    commits: commits.sort((a, b) => b.timestamp - a.timestamp).slice(0, 1000),
    available: {
      authors: [...availableAuthors.values()].sort((a, b) => a.name.localeCompare(b.name)),
      paths: [
        ...[...availableDirectories].sort().map((path) => ({ path, kind: 'directory' as const })),
        ...[...availableFiles].sort().map((path) => ({ path, kind: 'file' as const })),
      ],
      dateRange: timestamps.length ? { from: Math.min(...timestamps), to: Math.max(...timestamps) } : null,
    },
  };
}
