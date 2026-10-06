# RAT — Repo Analysis Tool

A full-stack Git repository analytics dashboard. RAT calculates file, directory, repository, commit-set, and author metrics over every non-merge commit reachable from `HEAD`.

## Requirements

- Node.js 18 or newer
- Git 2.30 or newer
- npm

## Run

```bash
./start.sh
```

Then open <http://localhost:4000>.

Alternatively, run the development servers with hot reload:

```bash
npm install
npm run dev
```

The development UI is at <http://localhost:5173> and proxies its API to port 4000.

## Test

```bash
npm test
npm run build
```

## Features

- Deep cloning from public HTTP(S) or `git://` URLs
- ZIP upload with path traversal protection (archive must contain `.git`)
- Multiple persistent repositories
- `.mailmap` support through Git plus manual name/email identity merging
- Filters for date range, author, file/directory, and manually selected commits
- Added lines, removed lines, growth, churn, modifications, modification frequency, churn rate, and author ownership
- File, recursive directory, repository, commit-set, and author views
- Rename detection at the required 50% threshold and binary-file exclusion
- Responsive dashboard, actionable errors, loading states, and CSV export

## Metric behavior

RAT calls `git log` once per repository revision and caches the parsed history in memory. Merge commits are excluded. For each text-file change, line additions and removals are attributed to the post-rename path. Directory metrics recursively aggregate all descendants, with `.` representing the repository root. A modification is counted once per commit for each affected object. Frequencies and churn rates use the selected commit-set size as their denominator.

The application data directory is `.rat-data/` by default. Set `RAT_DATA_DIR` to use another location and `PORT` to change the production port.
