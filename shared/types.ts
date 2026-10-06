export interface MetricTotals {
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
}

export interface ObjectMetric extends MetricTotals {
  path: string;
  kind: 'file' | 'directory';
}

export interface AuthorMetric extends MetricTotals {
  key: string;
  author: string;
  email: string;
  ownership: number;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  added: number;
  removed: number;
  churn: number;
  files: number;
}

export interface AnalysisFilters {
  from?: number;
  to?: number;
  commits?: string[];
  authors?: string[];
  paths?: string[];
}

export type AnalysisView = 'files' | 'directories' | 'authors' | 'commits';

export interface AnalysisTableRequest {
  view?: AnalysisView;
  page?: number;
  pageSize?: number;
  query?: string;
}

export interface AnalysisRequest {
  filters?: AnalysisFilters;
  table?: AnalysisTableRequest;
}

export interface AnalysisPageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AnalysisResult {
  repositoryId: string;
  repositoryName: string;
  generatedAt: string;
  commitCount: number;
  totalCommitCount: number;
  totals: MetricTotals;
  files: ObjectMetric[];
  directories: ObjectMetric[];
  authors: AuthorMetric[];
  commits: CommitInfo[];
  insights: {
    files: ObjectMetric[];
    authors: AuthorMetric[];
  };
  pages: Record<AnalysisView, AnalysisPageInfo>;
  available: {
    authors: Array<{ key: string; name: string; email: string }>;
    paths: Array<{ path: string; kind: 'file' | 'directory' }>;
    pathCount: number;
    pathsTruncated: boolean;
    dateRange: { from: number; to: number } | null;
  };
}

export interface RepositorySummary {
  id: string;
  name: string;
  source: string;
  branch: string;
  head: string;
  addedAt: string;
  commitCount: number;
  aliases: Record<string, string>;
}

export interface ApiError {
  error: string;
  detail?: string;
}
