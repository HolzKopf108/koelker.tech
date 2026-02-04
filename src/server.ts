// src/server.ts
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import cookieParser from 'cookie-parser';
import RedisStore from 'connect-redis';
import bcrypt from 'bcryptjs';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import type { RedisClientType } from 'redis';

import { env } from './server/env';
import { getRedisClientSafe } from './server/redis';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const SESSION_TTL_SECONDS = 6 * 60 * 60;
const BF_WINDOW_SECONDS = 10 * 60;
const BF_LOCK_SECONDS = 10 * 60;
const ANALYTICS_TTL_SECONDS = 370 * 24 * 60 * 60;
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('invalid-password', 10);

let redisClient: RedisClientType | null = await getRedisClientSafe();
const sessionStore = redisClient
  ? new RedisStore({
      client: redisClient,
      prefix: `${env.analyticsPrefix}sess:`,
      ttl: SESSION_TTL_SECONDS,
    })
  : new session.MemoryStore();

if (!redisClient) {
  console.warn('[redis] unavailable at startup. Admin/analytics disabled until Redis is reachable.');
}

async function ensureRedis(): Promise<RedisClientType | null> {
  if (redisClient?.isOpen) return redisClient;
  redisClient = await getRedisClientSafe();
  return redisClient;
}

app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(
  session({
    name: 'koelker_admin_session',
    store: sessionStore,
    secret: env.authSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: env.isProd,
      sameSite: 'lax',
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  }),
);

type RepoCard = {
  id: string; 
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  languages: string[];
};

type RepoLanguageNode = {
  name?: string | null;
};

type RepoNode = {
  id?: string;
  name?: string;
  url?: string;
  description?: string | null;
  owner?: { login?: string | null } | null;
  languages?: { nodes?: Array<RepoLanguageNode | null> } | null;
};

type GraphQlResponse = {
  data?: {
    user?: {
      pinnedItems?: {
        nodes?: Array<RepoNode | null>;
      };
    };
  };
  errors?: Array<{ message?: string }>;
  message?: string;
};

let cache: { expiresAt: number; data: RepoCard[] } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ADMIN_CREDENTIALS_KEY = `${env.analyticsPrefix}admin:credentials`;

function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function usernameKeySegment(normalized: string): string {
  if (!normalized) return 'empty';
  return Buffer.from(normalized).toString('base64url');
}

function hmacBase64Url(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastUtcDates(days: number): string[] {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - offset);
    dates.push(utcDateString(d));
  }
  return dates;
}

function headerValue(req: Request, name: string): string {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(', ');
  return raw ?? '';
}

function shouldSkipAnalytics(req: Request): boolean {
  if (req.method !== 'GET') return true;
  const accept = headerValue(req, 'accept');
  if (!accept.includes('text/html')) return true;
  const path = req.path ?? '';
  if (path.startsWith('/api') || path.startsWith('/admin') || path.startsWith('/login')) return true;
  const gpc = headerValue(req, 'sec-gpc');
  const dnt = headerValue(req, 'dnt');
  if (gpc === '1' || dnt === '1') return true;
  return false;
}

async function recordAnalytics(req: Request): Promise<void> {
  const client = await ensureRedis();
  if (!client) return;
  const date = utcDateString(new Date());
  const pvKey = `${env.analyticsPrefix}analytics:pv:${date}`;
  const uuKey = `${env.analyticsPrefix}analytics:uu:${date}`;

  const ip = req.ip ?? '';
  const userAgent = headerValue(req, 'user-agent');
  const acceptLanguage = headerValue(req, 'accept-language');

  const dailySecret = hmacBase64Url(env.analyticsSecret, date);
  const token = hmacBase64Url(dailySecret, `${ip}|${userAgent}|${acceptLanguage}`);

  const pipeline = client.multi();
  pipeline.incr(pvKey);
  pipeline.expire(pvKey, ANALYTICS_TTL_SECONDS);
  pipeline.pfAdd(uuKey, token);
  pipeline.expire(uuKey, ANALYTICS_TTL_SECONDS);
  await pipeline.exec();
}

function analyticsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (shouldSkipAnalytics(req)) {
    next();
    return;
  }

  res.once('finish', () => {
    if (res.statusCode >= 400) return;
    void recordAnalytics(req).catch((err) => {
      if (!env.isProd) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[analytics] failed:', message);
      }
    });
  });
  next();
}

function requireAdminApi(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isAdmin) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

function requireAdminPage(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isAdmin) {
    next();
    return;
  }
  res.redirect('/login');
}

function parseDays(value: unknown): number {
  const parsed = Number(value);
  const allowed = new Set([1, 7, 30, 90, 365]);
  if (!Number.isFinite(parsed) || !allowed.has(parsed)) return 30;
  return parsed;
}

function resolveSample(days: number, sample: string | undefined): { mode: 'daily' | 'weekly'; step: number } {
  if (sample === 'daily') return { mode: 'daily', step: 1 };
  if (sample === 'weekly') return { mode: 'weekly', step: 7 };
  if (days > 90) return { mode: 'weekly', step: 7 };
  return { mode: 'daily', step: 1 };
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function ensureAdminCredentials(): Promise<void> {
  if (!env.adminUsername || !env.adminPassword) return;
  const client = await ensureRedis();
  if (!client) {
    console.warn('[redis] cannot refresh admin credentials (redis unavailable).');
    return;
  }
  const username = env.adminUsername.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(env.adminPassword, 12);
  const updatedAt = new Date().toISOString();

  await client
    .multi()
    .del(ADMIN_CREDENTIALS_KEY)
    .hSet(ADMIN_CREDENTIALS_KEY, { username, passwordHash, updatedAt })
    .exec();
}

await ensureAdminCredentials();

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

  const json = (await ghRes.json().catch(() => null)) as GraphQlResponse | null;

  if (!ghRes.ok) {
    const msg = json?.message ? ` | ${json.message}` : '';
    throw new Error(`GitHub GraphQL error: ${ghRes.status}${msg}`);
  }

  if (json?.errors?.length) {
    const messages = json.errors.map((error) => error.message ?? 'unknown error').join(' | ');
    throw new Error(`GitHub GraphQL errors: ${messages}`);
  }

  const nodes = json?.data?.user?.pinnedItems?.nodes ?? [];

  return nodes
    .filter(
      (repo): repo is RepoNode =>
        Boolean(repo && typeof repo.id === 'string' && typeof repo.name === 'string' && typeof repo.url === 'string'),
    )
    .map((r) => {
      const owner = r.owner?.login ?? username;
      const languages = Array.isArray(r.languages?.nodes)
        ? r.languages.nodes
            .map((lang) => lang?.name ?? null)
            .filter((name): name is string => Boolean(name))
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    res.status(500).json({
      error: message,
      hint: tokenHint(message),
    });
  }
});

app.use(analyticsMiddleware);

const adminRouter = express.Router();

adminRouter.get('/auth/v1/me', (req, res) => {
  const isAdmin = Boolean(req.session?.isAdmin);
  res.json({
    isAdmin,
    username: isAdmin ? (req.session?.adminUsername ?? null) : null,
  });
});

adminRouter.post('/auth/v1/login', async (req, res) => {
  try {
    const client = await ensureRedis();
    if (!client) {
      res.status(503).json({ error: 'redis_unavailable' });
      return;
    }
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password ?? '');
    const userKey = usernameKeySegment(username);
    const countKey = `${env.analyticsPrefix}auth:bf:count:${userKey}`;
    const lockKey = `${env.analyticsPrefix}auth:bf:lock:${userKey}`;

    const lockTtl = await client.ttl(lockKey);
    if (lockTtl > 0) {
      const retryAfterMinutes = Math.max(1, Math.ceil(lockTtl / 60));
      res.set('Retry-After', String(lockTtl));
      res.status(429).json({
        error: 'locked',
        retryAfterMinutes,
        message: `Versuche es in ${retryAfterMinutes} Minuten erneut.`,
      });
      return;
    }

    const stored = await client.hGetAll(ADMIN_CREDENTIALS_KEY);
    const storedUsername = (stored['username'] ?? '').toLowerCase();
    const storedHash = stored['passwordHash'] ?? DUMMY_BCRYPT_HASH;

    const passwordOk = await bcrypt.compare(password, storedHash);
    const usernameOk = storedUsername.length > 0 && storedUsername === username;
    const isValid = usernameOk && passwordOk;

    if (!isValid) {
      const count = await client.incr(countKey);
      if (count <= 5) {
        await client.expire(countKey, BF_WINDOW_SECONDS);
      }
      if (count > 5) {
        await client
          .multi()
          .set(lockKey, '1', { EX: BF_LOCK_SECONDS })
          .del(countKey)
          .exec();
        const retryAfterMinutes = Math.max(1, Math.ceil(BF_LOCK_SECONDS / 60));
        res.set('Retry-After', String(BF_LOCK_SECONDS));
        res.status(429).json({
          error: 'locked',
          retryAfterMinutes,
          message: `Versuche es in ${retryAfterMinutes} Minuten erneut.`,
        });
        return;
      }

      res.status(401).json({
        error: 'invalid',
        message: 'Falsche Kombination',
      });
      return;
    }

    await client.del([countKey, lockKey]);
    await regenerateSession(req);
    req.session.isAdmin = true;
    req.session.adminUsername = storedUsername;
    await saveSession(req);

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'internal_error' });
  }
});

adminRouter.post('/auth/v1/logout', requireAdminApi, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('koelker_admin_session', {
      httpOnly: true,
      secure: env.isProd,
      sameSite: 'lax',
    });
    res.json({ ok: true });
  });
});

adminRouter.get('/auth/v1/health', requireAdminApi, async (_req, res) => {
  try {
    const client = await ensureRedis();
    if (!client) {
      res.status(503).json({ ok: false, redis: 'unavailable' });
      return;
    }
    const pong = await client.ping();
    res.json({ ok: true, redis: pong });
  } catch {
    res.status(500).json({ ok: false });
  }
});

adminRouter.get('/stats/v1/summary', requireAdminApi, async (req, res) => {
  try {
    const client = await ensureRedis();
    if (!client) {
      res.status(503).json({ error: 'redis_unavailable' });
      return;
    }
    const days = parseDays(req.query['days']);
    const dates = lastUtcDates(days);
    const pipeline = client.multi();

    for (const date of dates) {
      pipeline.get(`${env.analyticsPrefix}analytics:pv:${date}`);
      pipeline.pfCount(`${env.analyticsPrefix}analytics:uu:${date}`);
    }

    const results = await pipeline.exec();
    let totalPageviews = 0;
    let totalUniques = 0;
    let idx = 0;

    for (let i = 0; i < dates.length; i += 1) {
      const pvRaw = results?.[idx++];
      const uuRaw = results?.[idx++];
      const pv = Number(pvRaw ?? 0);
      const uu = Number(uuRaw ?? 0);
      totalPageviews += Number.isFinite(pv) ? pv : 0;
      totalUniques += Number.isFinite(uu) ? uu : 0;
    }

    res.json({
      days,
      timezone: 'UTC',
      totalPageviews,
      totalUniques,
      averagePageviews: totalPageviews / days,
      averageUniques: totalUniques / days,
    });
  } catch {
    res.status(500).json({ error: 'internal_error' });
  }
});

adminRouter.get('/stats/v1/timeseries', requireAdminApi, async (req, res) => {
  try {
    const client = await ensureRedis();
    if (!client) {
      res.status(503).json({ error: 'redis_unavailable' });
      return;
    }
    const days = parseDays(req.query['days']);
    const sampleParam = typeof req.query['sample'] === 'string' ? req.query['sample'] : 'auto';
    const { mode, step } = resolveSample(days, sampleParam);
    const dates = lastUtcDates(days);
    const pipeline = client.multi();

    for (const date of dates) {
      pipeline.get(`${env.analyticsPrefix}analytics:pv:${date}`);
      pipeline.pfCount(`${env.analyticsPrefix}analytics:uu:${date}`);
    }

    const results = await pipeline.exec();
    const fullSeries = dates.map((date, index) => {
      const pvRaw = results?.[index * 2];
      const uuRaw = results?.[index * 2 + 1];
      const pageviews = Number(pvRaw ?? 0);
      const uniques = Number(uuRaw ?? 0);
      return {
        date,
        pageviews: Number.isFinite(pageviews) ? pageviews : 0,
        uniques: Number.isFinite(uniques) ? uniques : 0,
      };
    });

    const series =
      step === 1
        ? fullSeries
        : fullSeries.reduce<Array<{ date: string; pageviews: number; uniques: number }>>(
            (acc, point, idx) => {
              if (idx % step === 0) {
                acc.push({ date: point.date, pageviews: 0, uniques: 0 });
              }
              const bucket = acc[acc.length - 1];
              bucket.pageviews += point.pageviews;
              bucket.uniques += point.uniques;
              return acc;
            },
            [],
          );

    res.json({
      days,
      timezone: 'UTC',
      sample: { mode, step },
      series,
    });
  } catch {
    res.status(500).json({ error: 'internal_error' });
  }
});

app.use('/api/admin', adminRouter);
app.use('/admin', requireAdminPage);

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
  app.listen(env.port, env.host, (error) => {
    if (error) throw error;
    console.log(`Node Express server listening on http://${env.host}:${env.port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
