<div align="center">

# RAT — Repo Analysis Tool

### Turn Git history into clear, actionable engineering insight.

RAT is a full-stack repository analytics dashboard that reveals code growth, churn, ownership, hotspots, and contributor activity across every non-merge commit reachable from `HEAD`.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=061A23)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-5-111111?logo=express&logoColor=white)](https://expressjs.com/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Tests](https://img.shields.io/badge/tests-5%2F5-63E6A5)](#testing)
[![Project](https://img.shields.io/badge/project-repository%20analytics-8B95A7)](#what-rat-answers)

[Quick start](#quick-start) · [Navigation guide](#app-navigation-guide) · [Features](#features) · [Metrics](#metrics) · [Design docs](#design-documentation)

</div>

---

## What RAT answers

| Question | RAT insight |
| --- | --- |
| Where is the code changing most? | File and directory churn hotspots |
| Who owns the codebase? | Contributor ownership and impact |
| Is the project growing or shrinking? | Added, removed, and net-growth trends |
| Which commits shaped the repository? | Searchable, filterable commit analytics |
| How stable is each object? | Modification frequency and churn rate |

## Design documentation

| Document | What it covers |
| --- | --- |
| [Architecture and metric computation](docs/ARCHITECTURE.md) | System boundaries, algorithms, caching, security, complexity, trade-offs, and correctness evidence |
| [UI and visualization design](docs/UI_DESIGN.md) | Information hierarchy, visual encoding, navigation, responsive behavior, and accessibility |
| [Usability and 100k-commit scale](docs/USABILITY_AND_SCALE.md) | Streamed parsing, bounded caches, pagination, search, and reproducible performance evidence |

These documents map implementation decisions directly to the assessment's **Architectural & UI Design** and **Usability** criteria.

## Quick start

### Prerequisites

- Node.js 18+
- Git 2.30+
- npm

### Production-style start

```bash
git clone https://github.com/LegadimaW/Repo_Analysis_Tool.git
cd Repo_Analysis_Tool
./start.sh
```

Open **<http://localhost:4000>**. The script installs dependencies, builds the React client, and starts the Express server.

### Development mode

```bash
npm install
npm run dev
```

| Service | URL |
| --- | --- |
| React + Vite | <http://localhost:5173> |
| Express API | <http://localhost:4000> |

Vite automatically proxies `/api` requests to the Express server.

## App navigation guide

RAT is organized into three focused views, so every task has a clear starting point.

### 1. Home — manage repositories

The **Repositories** page is the app's home screen.

- Select a repository card to open its analytics dashboard.
- Select **Add repository** to open the import page.
- Use the trash icon on a card to remove that repository and its stored data.
- Select the **RAT** logo from any page to return home.

### 2. Import — add a codebase

Choose one of the two import tabs:

| Method | Input |
| --- | --- |
| **Clone URL** | A public HTTP(S) or `git://` repository URL |
| **Upload ZIP** | A ZIP archive containing the repository's `.git` directory |

Select **Import and analyze** after entering the URL or choosing a file. RAT opens the new dashboard automatically when processing completes. Use **Back to repositories** to leave without importing.

### 3. Analysis — explore repository history

The analysis dashboard is arranged from high-level summaries to detailed records:

1. **Metric cards** summarize additions, removals, growth, churn, and modifications.
2. **Top hotspots** identifies files with the highest churn.
3. **Contributor impact** highlights authors with the greatest activity.
4. **Files**, **Directories**, **Authors**, and **Commits** tabs provide detailed tables.

Use the controls as follows:

| Control | Purpose |
| --- | --- |
| Repository selector | Switch directly between imported repositories |
| **Merge authors** | Combine aliases that represent the same contributor |
| **Filters** | Limit analysis by date, author, path, or commit SHA prefix |
| Table search | Search within the currently selected results tab |
| Rows selector | Display 50, 100, or 250 records per page |
| First / Previous / Next / Last | Move through large result sets |
| **Export page CSV** | Download the currently visible table page |
| **All repositories** | Return to the home page without using the browser back button |

> [!TIP]
> The first analysis reads the repository's Git history. Repeated analysis, filtering, searching, and table navigation are substantially faster because parsed history and filtered snapshots are cached.

> [!NOTE]
> Filters can be combined. Select **Reset** in the filter panel to restore the complete repository scope.

## Testing

```bash
npm test          # metric, filtering, pagination, and 100k-commit tests
npm run build     # TypeScript validation and production bundle
```

The deterministic large-history test analyses **100,000 synthetic commits** while keeping the paginated response below **1 MB**.

## Features

### Repository ingestion

- Deep clone from public HTTP(S) and `git://` URLs
- ZIP upload with path-traversal protection
- Multiple persistent repositories with quick dashboard switching
- Dedicated home, import, and analysis views with in-app back navigation

### Analysis and identity

- Repository, file, recursive-directory, commit-set, and author views
- Date, author, object-path, and commit-SHA-prefix filters
- Native `.mailmap` support plus manual identity merging
- Required 50% rename-similarity detection
- Automatic binary-file exclusion

### Usability and scale

- Responsive interactive dashboard for desktop and mobile
- Server-side pagination with 50, 100, or 250 rows per page
- Debounced table search and bounded API responses
- CSV export for the visible table page
- Streamed Git parsing and bounded LRU caches for large histories
- Clear loading, empty, success, and error states

## Metrics

| Metric | Definition |
| --- | --- |
| **Added** | Text lines introduced into the selected object |
| **Removed** | Text lines deleted from the selected object |
| **Growth** | `added − removed` |
| **Churn** | `added + removed` |
| **Modifications** | Commits that changed the selected object |
| **Modification frequency** | `modifications ÷ selected commits` |
| **Churn rate** | `churn ÷ selected commits` |
| **Ownership** | Author churn as a share of repository churn |

## How analysis works

```text
Git repository
      │
      ▼
streamed git log --numstat
      │
      ▼
rename-aware history index ──── bounded history cache
      │
      ▼
filter + aggregate snapshot ─── bounded analysis cache
      │
      ▼
search + paginate ───────────── bounded JSON response
      │
      ▼
React dashboard
```

RAT streams `git log` once per repository revision and stores parsed history in a bounded in-memory LRU cache. Filtered aggregate snapshots are cached separately, so table search and pagination do not repeat Git traversal or metric computation.

Merge commits are excluded. Text-line additions and removals are attributed to the post-rename path. Directory metrics recursively aggregate descendants, with `.` representing the repository root. A modification is counted once per commit for each affected object, and rate denominators use the selected commit-set size.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Production HTTP port |
| `RAT_DATA_DIR` | `.rat-data/` | Repository and metadata storage |
| `RAT_HISTORY_CACHE_SIZE` | `2` | Parsed-history LRU capacity |
| `RAT_ANALYSIS_CACHE_SIZE` | `2` | Filtered-analysis LRU capacity |

## Project structure

```text
├── src/                 React dashboard and API client
├── server/              Express API, ingestion, and metric engine
├── shared/              Shared TypeScript contracts
├── docs/                Architecture, UI, and scalability rationale
├── start.sh             Assessment-compatible startup script
└── vite.config.ts       Client build and development proxy
```

---

<div align="center">

Built with **TypeScript**, **React**, **Express**, and the **Git CLI**.

</div>
