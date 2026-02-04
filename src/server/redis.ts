// src/server/redis.ts
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { env } from './env';

const CONNECT_TIMEOUT_MS = 2000;
const RETRY_BACKOFF_MS = 30_000;

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;
let lastFailureAt = 0;
let lastFailureLoggedAt = 0;

function logRedisError(error: unknown) {
  const now = Date.now();
  if (now - lastFailureLoggedAt < RETRY_BACKOFF_MS) return;
  lastFailureLoggedAt = now;
  const message = error instanceof Error ? error.message : String(error);
  console.warn('[redis] unavailable:', message);
}

async function connectOnce(): Promise<RedisClientType> {
  const nextClient = createClient({
    url: env.redisUrl,
    socket: {
      reconnectStrategy: false,
    },
  });

  nextClient.on('error', (err: unknown) => {
    logRedisError(err);
  });

  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Redis connect timeout'));
    }, CONNECT_TIMEOUT_MS);
  });

  try {
    await Promise.race([nextClient.connect(), timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
  return nextClient as RedisClientType;
}

export async function getRedisClientSafe(): Promise<RedisClientType | null> {
  if (client?.isOpen) return client;

  const now = Date.now();
  if (now - lastFailureAt < RETRY_BACKOFF_MS) {
    return null;
  }

  if (!connecting) {
    connecting = connectOnce()
      .then((connected) => {
        client = connected;
        return client;
      })
      .catch((error) => {
        lastFailureAt = Date.now();
        logRedisError(error);
        client?.disconnect();
        client = null;
        return null;
      })
      .finally(() => {
        connecting = null;
      });
  }

  return connecting;
}
