import type { AnalysisFilters, AnalysisResult, AnalysisTableRequest, ApiError, RepositorySummary } from '../shared/types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      message = ((await response.json()) as ApiError).error || message;
    } catch {
      // Keep the status-based fallback when a proxy returns non-JSON output.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listRepositories: () => request<RepositorySummary[]>('/api/repositories'),

  cloneRepository: (url: string) => request<RepositorySummary>('/api/repositories/clone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }),

  uploadRepository: (file: File) => {
    const body = new FormData();
    body.append('repository', file);
    return request<RepositorySummary>('/api/repositories/upload', { method: 'POST', body });
  },

  analyze: (id: string, filters: AnalysisFilters = {}, table: AnalysisTableRequest = {}) => request<AnalysisResult>(
    `/api/repositories/${id}/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters, table }),
    },
  ),

  updateAliases: (id: string, aliases: Record<string, string>) => request<RepositorySummary>(
    `/api/repositories/${id}/aliases`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases }),
    },
  ),

  deleteRepository: (id: string) => request<void>(`/api/repositories/${id}`, { method: 'DELETE' }),
};
