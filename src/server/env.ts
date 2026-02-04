// src/server/env.ts
type EnvConfig = {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  host: string;
  redisUrl: string;
  authSecret: string;
  analyticsSecret: string;
  analyticsPrefix: string;
  adminUsername: string;
  adminPassword: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`[startup] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function normalizePrefix(prefix: string): string {
  if (!prefix) return 'koelker.tech:';
  return prefix.endsWith(':') ? prefix : `${prefix}:`;
}

export const env: EnvConfig = {
  nodeEnv: optionalEnv('NODE_ENV') || 'development',
  isProd: (optionalEnv('NODE_ENV') || 'development') === 'production',
  port: Number(optionalEnv('PORT') || '4000'),
  host: optionalEnv('HOST') || '0.0.0.0',
  redisUrl: requireEnv('REDIS_URL'),
  authSecret: requireEnv('AUTH_SECRET'),
  analyticsSecret: requireEnv('ANALYTICS_SECRET'),
  analyticsPrefix: normalizePrefix(optionalEnv('ANALYTICS_PREFIX') || 'koelker.tech:'),
  adminUsername: optionalEnv('ADMIN_USERNAME'),
  adminPassword: optionalEnv('ADMIN_PASSWORD'),
};
