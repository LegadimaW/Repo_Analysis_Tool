import { spawn } from 'node:child_process';
import type {
  AnalysisFilters,
  AnalysisPageInfo,
  AnalysisResult,
  AnalysisTableRequest,
  AnalysisView,
  AuthorMetric,
  CommitInfo,
  MetricTotals,
  ObjectMetric,
} from '../shared/types.js';

interface ChangedFile {
  path: string;
  added: number;
  removed: number;
}

export interface RawCommit {
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

interface Identity {
  key: string;
  name: string;
  email: string;
}

interface HistoryIndex {
  commits: RawCommit[];
  identities: Map<string, Identity>;
  files: string[];
  directories: string[];
  ancestorsByPath: Map<string, string[]>;
  dateRange: { from: number; to: number } | null;
}

interface AnalysisSnapshot {
  commitCount: number;
  totalCommitCount: number;
  totals: MetricTotals;
  files: ObjectMetric[];
  directories: ObjectMetric[];
  authors: AuthorMetric[];
  commits: CommitInfo[];
  availableAuthors: Identity[];
  availablePaths: Array<{ path: string; kind: 'file' | 'directory' }>;
  dateRange: { from: number; to: number } | null;
}

const HISTORY_CACHE_LIMIT = positiveInteger(process.env.RAT_HISTORY_CACHE_SIZE, 2);
const ANALYSIS_CACHE_LIMIT = positiveInteger(process.env.RAT_ANALYSIS_CACHE_SIZE, 2);
const FILTER_PATH_LIMIT = positiveInteger(process.env.RAT_FILTER_PATH_LIMIT, 500);
const historyCache = new Map<string, { head: string; index: HistoryIndex }>();
const analysisCache = new Map<string, AnalysisSnapshot>();

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}

function resolveRename(rawPath: string): string {
  if (!rawPath.includes(' => ')) return rawPath;
  const braced = rawPath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`;
  return rawPath.slice(rawPath.lastIndexOf(' => ') + 4);
}

function parseGitRecord(record: string): RawCommit | null {
  const normalized = record.trim();
  if (!normalized) return null;
  const lines = normalized.split('\n');
  const [hash, author, email, timestamp, ...subjectParts] = lines.shift()!.split('\x1f');
  if (!hash || !author || email === undefined || timestamp === undefined) return null;
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
}

export function parseGitLog(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const record of output.split('\x1e')) {
    const commit = parseGitRecord(record);
    if (commit) commits.push(commit);
  }
  return commits;
}

function directoryAncestors(filePath: string): string[] {
  const directories = ['.'];
  let separator = filePath.indexOf('/');
  while (separator !== -1) {
    directories.push(filePath.slice(0, separator));
    separator = filePath.indexOf('/', separator + 1);
  }
  return directories;
}

function identityKey(name: string, email: string): string {
  return `${name} <${email.toLowerCase()}>`;
}

function createHistoryIndex(commits: RawCommit[]): HistoryIndex {
  const identities = new Map<string, Identity>();
  const files = new Set<string>();
  const directories = new Set<string>(['.']);
  const ancestorsByPath = new Map<string, string[]>();
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  for (const commit of commits) {
    const key = identityKey(commit.author, commit.email);
    identities.set(key, { key, name: commit.author, email: commit.email });
    from = Math.min(from, commit.timestamp);
    to = Math.max(to, commit.timestamp);
    for (const file of commit.files) {
      files.add(file.path);
      let ancestors = ancestorsByPath.get(file.path);
      if (!ancestors) {
        ancestors = directoryAncestors(file.path);
        ancestorsByPath.set(file.path, ancestors);
        ancestors.forEach((directory) => directories.add(directory));
      }
    }
  }

  return {
    commits,
    identities,
    files: [...files].sort(),
    directories: [...directories].sort(),
    ancestorsByPath,
    dateRange: commits.length ? { from, to } : null,
  };
}

async function streamGitHistory(repository: RepositoryInput): Promise<HistoryIndex> {
  const child = spawn('git', [
    '-C', repository.path,
    'log', 'HEAD',
    '--no-merges',
    '--date-order',
    '--use-mailmap',
    '--find-renames=50%',
    '--format=%x1e%H%x1f%aN%x1f%aE%x1f%ct%x1f%s',
    '--numstat',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    const commits: RawCommit[] = [];
    let pending = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Git history analysis timed out after 15 minutes'));
    }, 15 * 60_000);

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(createHistoryIndex(commits));
    }

    function consume(record: string) {
      const commit = parseGitRecord(record);
      if (commit) commits.push(commit);
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      const records = pending.split('\x1e');
      pending = records.pop() ?? '';
      records.forEach(consume);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 1024 * 1024) stderr += chunk;
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(stderr.trim() || `git log exited with code ${code}`));
      consume(pending);
      finish();
    });
  });
}

function invalidateRepositoryAnalyses(repositoryId: string): void {
  for (const key of analysisCache.keys()) {
    if (key.startsWith(`${repositoryId}\x00`)) analysisCache.delete(key);
  }
}

async function loadHistory(repository: RepositoryInput): Promise<HistoryIndex> {
  const cached = historyCache.get(repository.id);
  if (cached?.head === repository.head) {
    remember(historyCache, repository.id, cached, HISTORY_CACHE_LIMIT);
    return cached.index;
  }
  invalidateRepositoryAnalyses(repository.id);
  const index = await streamGitHistory(repository);
  remember(historyCache, repository.id, { head: repository.head, index }, HISTORY_CACHE_LIMIT);
  return index;
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

function stableValues(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function snapshotKey(repository: RepositoryInput, filters: AnalysisFilters): string {
  return `${repository.id}\x00${repository.head}\x00${JSON.stringify({
    aliases: Object.entries(repository.aliases).sort(([a], [b]) => a.localeCompare(b)),
    from: filters.from,
    to: filters.to,
    commits: stableValues(filters.commits),
    authors: stableValues(filters.authors),
    paths: stableValues(filters.paths),
  })}`;
}

function buildSnapshot(
  repository: Pick<RepositoryInput, 'aliases'>,
  history: HistoryIndex,
  filters: AnalysisFilters,
): AnalysisSnapshot {
  const canonicalIdentity = (commit: RawCommit): Identity => {
    const sourceKey = identityKey(commit.author, commit.email);
    const key = canonicalKey(sourceKey, repository.aliases);
    return history.identities.get(key) ?? { key, name: commit.author, email: commit.email };
  };

  const selectedHashes = stableValues(filters.commits).map((hash) => hash.toLowerCase());
  const selectedAuthors = new Set(stableValues(filters.authors));
  const selectedPaths = stableValues(filters.paths);
  const selected = history.commits.filter((commit) => {
    const identity = canonicalIdentity(commit);
    if (selectedHashes.length && !selectedHashes.some((hash) => commit.hash.toLowerCase().startsWith(hash))) return false;
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
    const identity = canonicalIdentity(commit);
    const authorMetric = authors.get(identity.key) ?? {
      ...emptyTotals(), key: identity.key, author: identity.name, email: identity.email, ownership: 0,
    };
    authors.set(identity.key, authorMetric);
    let commitAdded = 0;
    let commitRemoved = 0;
    let relevantFileCount = 0;
    const changedDirectories = new Map<string, { added: number; removed: number }>();

    for (const change of commit.files) {
      if (!matchesPath(change.path, selectedPaths)) continue;
      relevantFileCount += 1;
      commitAdded += change.added;
      commitRemoved += change.removed;
      const fileMetric = files.get(change.path) ?? {
        ...emptyTotals(), path: change.path, kind: 'file' as const,
      };
      addChange(fileMetric, change.added, change.removed);
      if (change.added + change.removed > 0) fileMetric.modifications += 1;
      files.set(change.path, fileMetric);

      const ancestors = history.ancestorsByPath.get(change.path) ?? directoryAncestors(change.path);
      for (const directory of ancestors) {
        const current = changedDirectories.get(directory) ?? { added: 0, removed: 0 };
        current.added += change.added;
        current.removed += change.removed;
        changedDirectories.set(directory, current);
      }
    }

    for (const [directory, change] of changedDirectories) {
      const directoryMetric = directories.get(directory) ?? {
        ...emptyTotals(), path: directory, kind: 'directory' as const,
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
      files: relevantFileCount,
    });
  }

  const commitCount = selected.length;
  finalize(totals, commitCount);
  const byChurn = <T extends MetricTotals>(a: T, b: T) => b.churn - a.churn;
  const fileResults = [...files.values()].map((metric) => finalize(metric, commitCount)).sort(byChurn);
  const directoryResults = [...directories.values()].map((metric) => finalize(metric, commitCount)).sort(byChurn);
  const authorResults = [...authors.values()].map((metric) => {
    finalize(metric, commitCount);
    metric.ownership = totals.churn ? metric.churn / totals.churn : 0;
    return metric;
  }).sort(byChurn);

  const availableAuthors = new Map<string, Identity>();
  for (const identity of history.identities.values()) {
    const key = canonicalKey(identity.key, repository.aliases);
    availableAuthors.set(key, history.identities.get(key) ?? { ...identity, key });
  }
  const availablePaths = [
    ...history.directories.map((path) => ({ path, kind: 'directory' as const })),
    ...history.files.map((path) => ({ path, kind: 'file' as const })),
  ];

  return {
    commitCount,
    totalCommitCount: history.commits.length,
    totals,
    files: fileResults,
    directories: directoryResults,
    authors: authorResults,
    commits: commits.sort((a, b) => b.timestamp - a.timestamp),
    availableAuthors: [...availableAuthors.values()].sort((a, b) => a.name.localeCompare(b.name)),
    availablePaths,
    dateRange: history.dateRange,
  };
}

function normalizedTableRequest(table: AnalysisTableRequest = {}): Required<AnalysisTableRequest> {
  return {
    view: table.view ?? 'files',
    page: Math.max(1, Math.floor(table.page ?? 1)),
    pageSize: Math.min(250, Math.max(25, Math.floor(table.pageSize ?? 100))),
    query: table.query?.trim().toLowerCase() ?? '',
  };
}

function pageItems<T>(
  items: T[],
  view: AnalysisView,
  table: Required<AnalysisTableRequest>,
  searchableText: (item: T) => string,
): { items: T[]; page: AnalysisPageInfo } {
  const isActive = table.view === view;
  const query = isActive ? table.query : '';
  const filtered = query
    ? items.filter((item) => searchableText(item).toLowerCase().includes(query))
    : items;
  const pageSize = table.pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = isActive ? Math.min(table.page, totalPages) : 1;
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    page: { page, pageSize, total: filtered.length, totalPages },
  };
}

function materializeResult(
  repository: Pick<RepositoryInput, 'id' | 'name'>,
  snapshot: AnalysisSnapshot,
  tableRequest: AnalysisTableRequest = {},
): AnalysisResult {
  const table = normalizedTableRequest(tableRequest);
  const files = pageItems(snapshot.files, 'files', table, (item) => item.path);
  const directories = pageItems(snapshot.directories, 'directories', table, (item) => item.path);
  const authors = pageItems(snapshot.authors, 'authors', table, (item) => `${item.author} ${item.email}`);
  const commits = pageItems(snapshot.commits, 'commits', table, (item) => `${item.hash} ${item.author} ${item.email} ${item.subject}`);
  const visiblePaths = snapshot.availablePaths.slice(0, FILTER_PATH_LIMIT);

  return {
    repositoryId: repository.id,
    repositoryName: repository.name,
    generatedAt: new Date().toISOString(),
    commitCount: snapshot.commitCount,
    totalCommitCount: snapshot.totalCommitCount,
    totals: snapshot.totals,
    files: files.items,
    directories: directories.items,
    authors: authors.items,
    commits: commits.items,
    insights: { files: snapshot.files.slice(0, 6), authors: snapshot.authors.slice(0, 6) },
    pages: {
      files: files.page,
      directories: directories.page,
      authors: authors.page,
      commits: commits.page,
    },
    available: {
      authors: snapshot.availableAuthors,
      paths: visiblePaths,
      pathCount: snapshot.availablePaths.length,
      pathsTruncated: visiblePaths.length < snapshot.availablePaths.length,
      dateRange: snapshot.dateRange,
    },
  };
}

export function analyzeHistory(
  repository: Pick<RepositoryInput, 'id' | 'name' | 'head' | 'aliases'>,
  commits: RawCommit[],
  filters: AnalysisFilters = {},
  table: AnalysisTableRequest = {},
): AnalysisResult {
  return materializeResult(repository, buildSnapshot(repository, createHistoryIndex(commits), filters), table);
}

export async function analyzeRepository(
  repository: RepositoryInput,
  filters: AnalysisFilters = {},
  table: AnalysisTableRequest = {},
): Promise<AnalysisResult> {
  const history = await loadHistory(repository);
  const key = snapshotKey(repository, filters);
  let snapshot = analysisCache.get(key);
  if (snapshot) remember(analysisCache, key, snapshot, ANALYSIS_CACHE_LIMIT);
  else {
    snapshot = buildSnapshot(repository, history, filters);
    remember(analysisCache, key, snapshot, ANALYSIS_CACHE_LIMIT);
  }
  return materializeResult(repository, snapshot, table);
}
