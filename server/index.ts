import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalysisFilters } from '../shared/types.js';
import { analyzeRepository } from './metrics.js';
import { RepositoryStore } from './repository-store.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024, files: 1 },
});
const store = new RepositoryStore();
await store.init();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', git: true });
});

app.get('/api/repositories', (_request, response) => {
  response.json(store.list());
});

app.post('/api/repositories/clone', async (request, response) => {
  const url = String(request.body?.url ?? '').trim();
  if (!url) return response.status(400).json({ error: 'A clone URL is required' });
  const repository = await store.clone(url);
  return response.status(201).json(repository);
});

app.post('/api/repositories/upload', upload.single('repository'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'A zip file is required' });
  if (!request.file.originalname.toLowerCase().endsWith('.zip')) {
    return response.status(400).json({ error: 'Only .zip archives are accepted' });
  }
  const repository = await store.importZip(request.file.buffer, request.file.originalname);
  return response.status(201).json(repository);
});

app.post('/api/repositories/:id/analyze', async (request, response) => {
  const repository = store.get(request.params.id);
  const filters = (request.body ?? {}) as AnalysisFilters;
  const result = await analyzeRepository(repository, filters);
  return response.json(result);
});

app.put('/api/repositories/:id/aliases', async (request, response) => {
  const aliases = request.body?.aliases;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    return response.status(400).json({ error: 'aliases must be an identity-to-identity object' });
  }
  const normalized = Object.fromEntries(
    Object.entries(aliases)
      .map(([source, target]) => [source.trim(), String(target).trim()])
      .filter(([source, target]) => source && target && source !== target),
  );
  return response.json(await store.setAliases(request.params.id, normalized));
});

app.delete('/api/repositories/:id', async (request, response) => {
  await store.remove(request.params.id);
  return response.status(204).send();
});

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(currentDirectory, '../dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDirectory));
  app.get('*all', (_request, response) => response.sendFile(path.join(clientDirectory, 'index.html')));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  console.error(error);
  const status = message === 'Repository not found' ? 404 : 500;
  response.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`RAT API listening on http://localhost:${port}`);
});
