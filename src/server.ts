// src/server.ts
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

type RepoCard = {
  id: string; 
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  languages: string[];
};

let cache: { expiresAt: number; data: RepoCard[] } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

function tokenHint(msg: string) {
  const lower = msg.toLowerCase();
  if (
    lower.includes('fine-grained') ||
    lower.includes('personal access tokens') ||
    lower.includes('lifetime') ||
    lower.includes('forbids access')
  ) {
    return "Deine Organisation blockt Fine-grained PATs mit Laufzeit > 366 Tage. Erstelle einen neuen Fine-grained Token mit <= 365 Tagen ODER nutze einen Classic PAT.";
  }
  return "Prüfe, ob GITHUB_TOKEN gesetzt ist und Zugriff auf öffentliche Daten hat.";
}

async function fetchPinnedReposViaGraphQL(username: string): Promise<RepoCard[]> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    throw new Error('GitHub token missing (set GITHUB_TOKEN in env)');
  }

  const query = `
    query {
      user(login: "${username}") {
        pinnedItems(first: 6, types: REPOSITORY) {
          nodes {
            ... on Repository {
              id
              name
              url
              description
              owner { login }
              languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
                nodes { name }
              }
            }
          }
        }
      }
    }
  `;

  const ghRes = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const json: any = await ghRes.json().catch(() => null);

  if (!ghRes.ok) {
    const msg = json?.message ? ` | ${json.message}` : '';
    throw new Error(`GitHub GraphQL error: ${ghRes.status}${msg}`);
  }

  if (json?.errors?.length) {
    throw new Error(`GitHub GraphQL errors: ${json.errors.map((e: any) => e.message).join(' | ')}`);
  }

  const nodes = (json?.data?.user?.pinnedItems?.nodes ?? []) as Array<any | null>;

  return nodes
    .filter((r) => !!r && typeof r.id === 'string')
    .map((r) => {
      const owner = r.owner?.login ?? username;
      const languages = Array.isArray(r.languages?.nodes)
        ? r.languages.nodes.map((l: any) => l?.name).filter(Boolean)
        : [];

      return {
        id: r.id as string,
        name: r.name as string,
        fullName: `${owner}/${r.name}`,
        url: r.url as string,
        description: (r.description ?? null) as string | null,
        languages,
      } satisfies RepoCard;
    });
}

app.get('/api/pinned-repos', async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      res.json(cache.data);
      return;
    }

    const data = await fetchPinnedReposViaGraphQL('HolzKopf108');
    cache = { data, expiresAt: now + CACHE_TTL_MS };
    res.json(data);
  } catch (e: any) {
    const message = e?.message ?? 'unknown error';
    res.status(500).json({
      error: message,
      hint: tokenHint(message),
    });
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start server
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
