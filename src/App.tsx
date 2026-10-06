import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AnalysisFilters,
  AnalysisResult,
  AuthorMetric,
  MetricTotals,
  ObjectMetric,
  RepositorySummary,
} from '../shared/types';
import { api } from './api';

type Tab = 'files' | 'directories' | 'authors' | 'commits';
type IconName = 'branch' | 'plus' | 'upload' | 'github' | 'filter' | 'merge' | 'trash' | 'file' | 'folder' | 'users' | 'commit' | 'x' | 'download';

const icons: Record<IconName, ReactNode> = {
  branch: <><path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
  github: <><circle cx="12" cy="12" r="9"/><path d="M8 18c-3 1-3-1-4-1m8 3v-3c0-1 .3-2-1-2 3 0 6-1 6-5 0-1 0-2-1-3 0 0-1 0-3 1a10 10 0 0 0-5 0C6 7 5 7 5 7c-1 1-1 2-1 3 0 4 3 5 6 5-1 0-1 1-1 2v3"/></>,
  filter: <><path d="M4 5h16l-6 7v6l-4 2v-8z"/></>,
  merge: <><circle cx="7" cy="5" r="2"/><circle cx="17" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M7 7v3c0 3 5 3 5 7m5-10v3c0 3-5 3-5 7"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></>,
  folder: <><path d="M3 6h7l2 2h9v11H3z"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 19c0-4 2-6 6-6s6 2 6 6"/><path d="M16 6a3 3 0 0 1 0 6m1 2c3 0 4 2 4 5"/></>,
  commit: <><circle cx="12" cy="12" r="3"/><path d="M3 12h6m6 0h6"/></>,
  x: <><path d="m6 6 12 12M18 6 6 18"/></>,
  download: <><path d="M12 4v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/></>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function formatNumber(value: number): string {
  return Intl.NumberFormat('en', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value < 0.01 && value > 0 ? 2 : 1)}%`;
}

function metricValue(metric: MetricTotals, key: keyof MetricTotals): string {
  const value = metric[key];
  return key === 'modificationFrequency' ? formatPercent(value) : formatNumber(value);
}

function MetricCard({ label, value, tone, detail }: { label: string; value: string; tone: string; detail: string }) {
  return <article className={`metric-card ${tone}`}>
    <div className="metric-top"><span>{label}</span><span className="metric-dot" /></div>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>;
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return <main className="empty-state">
    <div className="empty-orbit"><Icon name="branch" size={38} /></div>
    <p className="eyebrow">REPOSITORY INTELLIGENCE</p>
    <h1>See the story inside<br />every commit.</h1>
    <p>Import a Git repository to uncover ownership, hotspots, churn, growth, and the people shaping the codebase.</p>
    <button className="primary large" onClick={onAdd}><Icon name="plus" /> Analyze a repository</button>
    <div className="feature-row"><span>Deep history</span><i /><span>Rename aware</span><i /><span>Author mapping</span></div>
  </main>;
}

function IngestModal({ onClose, onAdded }: { onClose: () => void; onAdded: (repository: RepositorySummary) => void }) {
  const [mode, setMode] = useState<'url' | 'zip'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const repository = mode === 'url'
        ? await api.cloneRepository(url)
        : await api.uploadRepository(file!);
      onAdded(repository);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      <p className="eyebrow">ADD REPOSITORY</p>
      <h2>Bring in a codebase</h2>
      <p className="modal-copy">RAT analyses the complete non-merge history from HEAD.</p>
      <div className="segmented">
        <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}><Icon name="github" /> Clone URL</button>
        <button className={mode === 'zip' ? 'active' : ''} onClick={() => setMode('zip')}><Icon name="upload" /> Upload ZIP</button>
      </div>
      <form onSubmit={submit}>
        {mode === 'url' ? <label className="field">
          <span>Public Git URL</span>
          <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" required autoFocus />
          <small>The repository is deeply cloned, including its full reachable history.</small>
        </label> : <label className="drop-zone">
          <input type="file" accept=".zip,application/zip" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
          <Icon name="upload" size={28} />
          <strong>{file?.name ?? 'Choose a repository archive'}</strong>
          <span>The ZIP must include its .git directory</span>
        </label>}
        {error && <div className="error-banner">{error}</div>}
        <button className="primary submit" disabled={busy || (mode === 'url' ? !url : !file)}>
          {busy ? <><span className="spinner" /> Importing full history…</> : <><Icon name="branch" /> Import and analyze</>}
        </button>
      </form>
    </section>
  </div>;
}

interface FilterDraft { from: string; to: string; author: string; path: string; commits: string }
const emptyFilters: FilterDraft = { from: '', to: '', author: '', path: '', commits: '' };

function FilterPanel({ result, draft, setDraft, apply, reset }: {
  result: AnalysisResult;
  draft: FilterDraft;
  setDraft: (next: FilterDraft) => void;
  apply: () => void;
  reset: () => void;
}) {
  return <section className="filter-panel">
    <div className="filter-title"><Icon name="filter" /><div><strong>Filter analysis</strong><span>Combine dimensions to narrow the commit set</span></div></div>
    <label><span>From</span><input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
    <label><span>Until</span><input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
    <label><span>Author</span><select value={draft.author} onChange={(e) => setDraft({ ...draft, author: e.target.value })}>
      <option value="">All authors</option>{result.available.authors.map((author) => <option key={author.key} value={author.key}>{author.name} — {author.email}</option>)}
    </select></label>
    <label><span>Object path</span><input list="rat-path-options" value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} placeholder="Entire repository" />
      <datalist id="rat-path-options">{result.available.paths.map((item) => <option key={`${item.kind}:${item.path}`} value={item.path}>{item.kind}</option>)}</datalist>
      {result.available.pathsTruncated && <small>Searchable input; type any exact path.</small>}
    </label>
    <label className="commit-select"><span>Specific commits</span><input value={draft.commits} onChange={(event) => setDraft({ ...draft, commits: event.target.value })} placeholder="SHA prefixes, comma-separated" /></label>
    <div className="filter-actions"><button className="text-button" onClick={reset}>Reset</button><button className="primary" onClick={apply}>Apply</button></div>
  </section>;
}

function MergeModal({ repository, result, onClose, onSaved }: {
  repository: RepositorySummary;
  result: AnalysisResult;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      await api.updateAliases(repository.id, { ...repository.aliases, [source]: target });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not merge authors');
    } finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="modal compact">
    <button className="icon-button modal-close" onClick={onClose}><Icon name="x" /></button>
    <p className="eyebrow">IDENTITY MANAGEMENT</p><h2>Merge authors</h2>
    <p className="modal-copy">Map an alias to its canonical identity. Existing <code>.mailmap</code> rules are already applied.</p>
    <label className="field"><span>Alias to merge</span><select value={source} onChange={(e) => setSource(e.target.value)}><option value="">Select an author</option>{result.available.authors.map((a) => <option key={a.key} value={a.key}>{a.name} — {a.email}</option>) }</select></label>
    <label className="field"><span>Canonical author</span><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select an author</option>{result.available.authors.filter((a) => a.key !== source).map((a) => <option key={a.key} value={a.key}>{a.name} — {a.email}</option>)}</select></label>
    {error && <div className="error-banner">{error}</div>}
    <button className="primary submit" disabled={!source || !target || busy} onClick={save}><Icon name="merge" /> {busy ? 'Saving…' : 'Merge identities'}</button>
  </section></div>;
}

function BarList({ items, kind }: { items: Array<ObjectMetric | AuthorMetric>; kind: 'path' | 'author' }) {
  const maximum = Math.max(1, ...items.slice(0, 6).map((item) => item.churn));
  return <div className="bar-list">{items.slice(0, 6).map((item) => {
    const label = kind === 'author' ? (item as AuthorMetric).author : (item as ObjectMetric).path;
    return <div className="bar-row" key={kind === 'author' ? (item as AuthorMetric).key : label}>
      <div className="bar-label"><span title={label}>{label}</span><strong>{formatNumber(item.churn)}</strong></div>
      <div className="bar-track"><i style={{ width: `${Math.max(2, item.churn / maximum * 100)}%` }} /></div>
    </div>;
  })}</div>;
}

function exportCsv(result: AnalysisResult, tab: Tab) {
  let rows: Array<Array<string | number>>;
  if (tab === 'authors') rows = [['Author', 'Email', 'Added', 'Removed', 'Growth', 'Churn', 'Modifications', 'Ownership'], ...result.authors.map((a) => [a.author, a.email, a.added, a.removed, a.growth, a.churn, a.modifications, a.ownership])];
  else if (tab === 'commits') rows = [['Commit', 'Date', 'Author', 'Subject', 'Files', 'Added', 'Removed', 'Churn'], ...result.commits.map((c) => [c.hash, new Date(c.timestamp * 1000).toISOString(), c.author, c.subject, c.files, c.added, c.removed, c.churn])];
  else {
    const data = tab === 'files' ? result.files : result.directories;
    rows = [['Path', 'Added', 'Removed', 'Growth', 'Churn', 'Modifications', 'Frequency', 'Churn rate'], ...data.map((m) => [m.path, m.added, m.removed, m.growth, m.churn, m.modifications, m.modificationFrequency, m.churnRate])];
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  anchor.download = `${result.repositoryName}-${tab}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function DataTable({ result, tab }: { result: AnalysisResult; tab: Tab }) {
  if (tab === 'commits') return <div className="table-wrap"><table><thead><tr><th>Commit</th><th>Message</th><th>Author</th><th>Date</th><th>Files</th><th className="positive">+Added</th><th className="negative">−Removed</th><th>Churn</th></tr></thead><tbody>{result.commits.map((commit) => <tr key={commit.hash}><td><code>{commit.shortHash}</code></td><td className="wide" title={commit.subject}>{commit.subject}</td><td>{commit.author}</td><td>{new Date(commit.timestamp * 1000).toLocaleDateString()}</td><td>{commit.files}</td><td className="positive">+{formatNumber(commit.added)}</td><td className="negative">−{formatNumber(commit.removed)}</td><td>{formatNumber(commit.churn)}</td></tr>)}</tbody></table></div>;
  if (tab === 'authors') return <div className="table-wrap"><table><thead><tr><th>Author</th><th>Email</th><th>Ownership</th><th>Commits</th><th className="positive">+Added</th><th className="negative">−Removed</th><th>Churn</th><th>Churn / commit</th></tr></thead><tbody>{result.authors.map((author) => <tr key={author.key}><td className="identity"><span>{author.author.slice(0, 1).toUpperCase()}</span><strong>{author.author}</strong></td><td>{author.email}</td><td><div className="ownership"><i style={{ width: `${author.ownership * 100}%` }} /><span>{formatPercent(author.ownership)}</span></div></td><td>{author.modifications}</td><td className="positive">+{formatNumber(author.added)}</td><td className="negative">−{formatNumber(author.removed)}</td><td>{formatNumber(author.churn)}</td><td>{formatNumber(author.churnRate)}</td></tr>)}</tbody></table></div>;
  const data = tab === 'files' ? result.files : result.directories;
  return <div className="table-wrap"><table><thead><tr><th>{tab === 'files' ? 'File' : 'Directory'}</th><th className="positive">+Added</th><th className="negative">−Removed</th><th>Growth</th><th>Churn</th><th>Modifications</th><th>Frequency</th><th>Churn / commit</th></tr></thead><tbody>{data.map((metric) => <tr key={metric.path}><td className="path-cell"><Icon name={tab === 'files' ? 'file' : 'folder'} size={15} /><span title={metric.path}>{metric.path === '.' ? 'Repository root' : metric.path}</span></td><td className="positive">+{formatNumber(metric.added)}</td><td className="negative">−{formatNumber(metric.removed)}</td><td className={metric.growth >= 0 ? 'positive' : 'negative'}>{metric.growth > 0 ? '+' : ''}{formatNumber(metric.growth)}</td><td>{formatNumber(metric.churn)}</td><td>{metric.modifications}</td><td>{formatPercent(metric.modificationFrequency)}</td><td>{formatNumber(metric.churnRate)}</td></tr>)}</tbody></table></div>;
}

export default function App() {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showIngest, setShowIngest] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [tab, setTab] = useState<Tab>('files');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [searchDraft, setSearchDraft] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [draft, setDraft] = useState<FilterDraft>(emptyFilters);
  const [activeFilters, setActiveFilters] = useState<AnalysisFilters>({});

  const selectedRepository = repositories.find((repository) => repository.id === selectedId);
  const filterCount = Object.values(activeFilters).filter((value) => Array.isArray(value) ? value.length : value !== undefined).length;

  async function reloadRepositories(preferredId?: string) {
    const list = await api.listRepositories();
    setRepositories(list);
    setSelectedId(preferredId ?? selectedId ?? list[0]?.id ?? '');
  }

  useEffect(() => {
    api.listRepositories().then((list) => {
      setRepositories(list); setSelectedId(list[0]?.id ?? ''); setLoading(false);
    }).catch((reason) => { setError(reason.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!selectedId) { setResult(null); return; }
    let cancelled = false;
    setLoading(true); setError('');
    api.analyze(selectedId, activeFilters, { view: tab, page, pageSize, query: tableSearch })
      .then((data) => { if (!cancelled) setResult(data); })
      .catch((reason) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, activeFilters, tab, page, pageSize, tableSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setTableSearch(searchDraft.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  function applyFilters() {
    const next: AnalysisFilters = {};
    if (draft.from) next.from = new Date(`${draft.from}T00:00:00`).getTime() / 1000;
    if (draft.to) next.to = new Date(`${draft.to}T00:00:00`).getTime() / 1000 + 86400;
    if (draft.author) next.authors = [draft.author];
    if (draft.path) next.paths = [draft.path];
    const commits = draft.commits.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
    if (commits.length) next.commits = commits;
    setPage(1); setActiveFilters(next); setShowFilters(false);
  }

  async function deleteSelected() {
    if (!selectedRepository || !window.confirm(`Remove ${selectedRepository.name} from RAT?`)) return;
    await api.deleteRepository(selectedRepository.id);
    const list = repositories.filter((repository) => repository.id !== selectedRepository.id);
    setRepositories(list); setSelectedId(list[0]?.id ?? '');
  }

  const topFiles = useMemo(() => result?.insights.files ?? [], [result]);
  const pageInfo = result?.pages[tab];
  if (!loading && repositories.length === 0) return <><EmptyState onAdd={() => setShowIngest(true)} />{showIngest && <IngestModal onClose={() => setShowIngest(false)} onAdded={(repo) => { setShowIngest(false); setRepositories([repo]); setSelectedId(repo.id); }} />}</>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span><Icon name="branch" /></span><div><strong>RAT</strong><small>REPO ANALYTICS</small></div></div>
      <div className="repo-heading"><span>REPOSITORIES</span><button className="icon-button" onClick={() => setShowIngest(true)} aria-label="Add repository"><Icon name="plus" /></button></div>
      <nav className="repo-list" aria-label="Repositories">{repositories.map((repository) => <button key={repository.id} className={selectedId === repository.id ? 'active' : ''} onClick={() => { setSelectedId(repository.id); setActiveFilters({}); setDraft(emptyFilters); setPage(1); setSearchDraft(''); setTableSearch(''); }}><span className="repo-icon"><Icon name="branch" size={16} /></span><span><strong>{repository.name}</strong><small>{repository.branch} · {formatNumber(repository.commitCount)} commits</small></span></button>)}</nav>
      <div className="sidebar-foot"><span className="status-dot" /> Git engine ready</div>
    </aside>
    <main className="dashboard">
      <header className="topbar">
        <div><div className="breadcrumb">Repositories <span>/</span> Analysis</div><h1>{selectedRepository?.name ?? 'Repository'}</h1><p><Icon name="branch" size={14} /> {selectedRepository?.branch} <code>{selectedRepository?.head.slice(0, 8)}</code></p></div>
        <div className="top-actions"><button className="secondary" onClick={() => setShowMerge(true)} disabled={!result}><Icon name="merge" /> Merge authors</button><button className={`secondary ${filterCount ? 'has-filter' : ''}`} onClick={() => setShowFilters((open) => !open)}><Icon name="filter" /> Filters {filterCount > 0 && <b>{filterCount}</b>}</button><button className="icon-button danger" onClick={deleteSelected} title="Remove repository"><Icon name="trash" /></button></div>
      </header>
      {showFilters && result && <FilterPanel result={result} draft={draft} setDraft={setDraft} apply={applyFilters} reset={() => { setDraft(emptyFilters); setActiveFilters({}); setShowFilters(false); }} />}
      {error && <div className="error-banner page-error">{error}</div>}
      {!result ? <div className="loading-state"><span className="spinner large-spinner" /><strong>Walking Git history</strong><p>Calculating changes across non-merge commits…</p></div> : <>
        <div className="scope-line"><span>ANALYSIS SCOPE</span><strong>{formatNumber(result.commitCount)} of {formatNumber(result.totalCommitCount)} commits</strong><i /> <span>Generated {new Date(result.generatedAt).toLocaleTimeString()}</span></div>
        <section className="metrics-grid">
          <MetricCard label="Lines added" value={`+${formatNumber(result.totals.added)}`} tone="green" detail="Across selected objects" />
          <MetricCard label="Lines removed" value={`−${formatNumber(result.totals.removed)}`} tone="red" detail="Across selected objects" />
          <MetricCard label="Net growth" value={`${result.totals.growth > 0 ? '+' : ''}${formatNumber(result.totals.growth)}`} tone="blue" detail="Added minus removed" />
          <MetricCard label="Code churn" value={formatNumber(result.totals.churn)} tone="amber" detail={`${formatNumber(result.totals.churnRate)} per commit`} />
          <MetricCard label="Modifications" value={formatNumber(result.totals.modifications)} tone="violet" detail={`${metricValue(result.totals, 'modificationFrequency')} frequency`} />
        </section>
        <section className="insights-grid">
          <article className="panel"><div className="panel-head"><div><p className="eyebrow">VOLATILITY</p><h2>Top hotspots</h2></div><span>CHURN</span></div>{topFiles.length ? <BarList items={topFiles} kind="path" /> : <p className="no-data">No matching file changes</p>}</article>
          <article className="panel"><div className="panel-head"><div><p className="eyebrow">OWNERSHIP</p><h2>Contributor impact</h2></div><span>CHURN</span></div>{result.insights.authors.length ? <BarList items={result.insights.authors} kind="author" /> : <p className="no-data">No matching authors</p>}</article>
        </section>
        <section className="data-panel">
          <div className="tabs-row"><div className="tabs" role="tablist" aria-label="Analysis views">{([['files', 'file', 'Files', result.pages.files.total], ['directories', 'folder', 'Directories', result.pages.directories.total], ['authors', 'users', 'Authors', result.pages.authors.total], ['commits', 'commit', 'Commits', result.pages.commits.total]] as const).map(([key, icon, label, count]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setPage(1); setSearchDraft(''); setTableSearch(''); }}><Icon name={icon} size={16} /> {label}<span>{formatNumber(count)}</span></button>)}</div></div>
          <div className="table-toolbar">
            <label className="table-search"><span>Search {tab}</span><input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={`Filter ${tab}…`} /></label>
            <label><span>Rows</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="50">50</option><option value="100">100</option><option value="250">250</option></select></label>
            {loading && <span className="refresh-indicator"><span className="spinner" /> Updating view…</span>}
            <button className="export" onClick={() => exportCsv(result, tab)} title="Export the visible page"><Icon name="download" size={15} /> Export page CSV</button>
          </div>
          <DataTable result={result} tab={tab} />
          {pageInfo && <div className="table-pagination"><span>Showing {pageInfo.total ? (pageInfo.page - 1) * pageInfo.pageSize + 1 : 0}–{Math.min(pageInfo.page * pageInfo.pageSize, pageInfo.total)} of {formatNumber(pageInfo.total)}</span><div><button disabled={pageInfo.page === 1} onClick={() => setPage(1)}>First</button><button disabled={pageInfo.page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button><strong>Page {pageInfo.page} of {pageInfo.totalPages}</strong><button disabled={pageInfo.page === pageInfo.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button><button disabled={pageInfo.page === pageInfo.totalPages} onClick={() => setPage(pageInfo.totalPages)}>Last</button></div></div>}
        </section>
      </>}
    </main>
    {showIngest && <IngestModal onClose={() => setShowIngest(false)} onAdded={(repository) => { setShowIngest(false); setRepositories((current) => [repository, ...current]); setSelectedId(repository.id); setActiveFilters({}); setPage(1); setSearchDraft(''); setTableSearch(''); }} />}
    {showMerge && selectedRepository && result && <MergeModal repository={selectedRepository} result={result} onClose={() => setShowMerge(false)} onSaved={async () => { setShowMerge(false); await reloadRepositories(selectedRepository.id); setActiveFilters((current) => ({ ...current })); }} />}
  </div>;
}
