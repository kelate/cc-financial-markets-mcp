/**
 * Redis cache layer using ioredis.
 * Stores parsed market data JSON — not raw HTML.
 * Degrades gracefully when Redis is unavailable (returns null, logs warn).
 */

import { Redis } from 'ioredis';
import { logger } from '../logger.js';

export class RedisCache {
  private readonly client: Redis | null = null;
  readonly enabled: boolean;

  constructor(url: string) {
    this.enabled = !!url;
    if (!this.enabled) return;

    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.client.on('error', (err: Error) => {
      logger.warn('Redis connection error', { message: err.message });
    });
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const val = await this.client.get(key);
      return val ? (JSON.parse(val) as T) : null;
    } catch (e) {
      logger.warn('Redis get failed', { key, error: (e as Error).message });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    try {
      const s = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.setex(key, ttlSeconds, s);
      } else {
        await this.client.set(key, s);
      }
    } catch (e) {
      logger.warn('Redis set failed', { key, error: (e as Error).message });
    }
  }

  async getRaw(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (e) {
      logger.warn('Redis getRaw failed', { key, error: (e as Error).message });
      return null;
    }
  }

  async setRaw(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (e) {
      logger.warn('Redis setRaw failed', { key, error: (e as Error).message });
    }
  }

  /**
   * Distributed lock using SET NX EX.
   * Returns true if lock was acquired (or Redis is disabled).
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return true;
    try {
      const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return true; // fail-open: let the caller proceed
    }
  }

  async releaseLock(key: string): Promise<void> {
    if (!this.client) return;
    try { await this.client.del(key); } catch { /* noop */ }
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
