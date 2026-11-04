// SPDX-License-Identifier: Apache-2.0
/**
 * Modern TanStack Query integration patterns for Bun OS frontends.
 * Provides query cache, reactive state subscriptions, stale-while-revalidate,
 * and optimistic mutations.
 */

export const authQueryKeys = {
  all: ["auth"] as const,
  session: () => [...authQueryKeys.all, "session"] as const,
  presence: () => [...authQueryKeys.all, "presence"] as const,
  accounts: () => [...authQueryKeys.all, "accounts"] as const,
  passkeys: (userId: string) => [...authQueryKeys.all, "passkeys", userId] as const,
};

export interface QueryCacheEntry<T> {
  data: T;
  updatedAt: number;
  isStale: boolean;
}

export type QueryObserver<T> = (data: T) => void;

export class SovereignQueryClient {
  private cache = new Map<string, QueryCacheEntry<unknown>>();
  private observers = new Map<string, Set<QueryObserver<unknown>>>();
  private defaultStaleTime: number;

  constructor(options: { defaultStaleTime?: number } = {}) {
    this.defaultStaleTime = options.defaultStaleTime ?? 30_000;
  }

  private serializeKey(key: readonly unknown[]): string {
    return JSON.stringify(key);
  }

  public getQueryData<T>(key: readonly unknown[]): T | undefined {
    const entry = this.cache.get(this.serializeKey(key));
    return entry ? (entry.data as T) : undefined;
  }

  public setQueryData<T>(key: readonly unknown[], data: T): void {
    const sKey = this.serializeKey(key);
    this.cache.set(sKey, {
      data,
      updatedAt: Date.now(),
      isStale: false,
    });
    this.notify(sKey, data);
  }

  public invalidateQueries(key: readonly unknown[]): void {
    const prefix = this.serializeKey(key).slice(0, -1);
    for (const [k, entry] of this.cache.entries()) {
      if (k.startsWith(prefix)) {
        entry.isStale = true;
      }
    }
  }

  public subscribe<T>(key: readonly unknown[], observer: QueryObserver<T>): () => void {
    const sKey = this.serializeKey(key);
    if (!this.observers.has(sKey)) {
      this.observers.set(sKey, new Set());
    }
    const set = this.observers.get(sKey)!;
    set.add(observer as QueryObserver<unknown>);

    const existing = this.getQueryData<T>(key);
    if (existing !== undefined) {
      observer(existing);
    }

    return () => {
      set.delete(observer as QueryObserver<unknown>);
      if (set.size === 0) {
        this.observers.delete(sKey);
      }
    };
  }

  private notify(sKey: string, data: unknown): void {
    const set = this.observers.get(sKey);
    if (set) {
      for (const observer of set) {
        try {
          observer(data);
        } catch (e) {
          console.error("[TanStack QueryClient] Observer error:", e);
        }
      }
    }
  }

  /**
   * Fetch with stale-while-revalidate pattern
   */
  public async fetchQuery<T>(
    key: readonly unknown[],
    fetcher: () => Promise<T>,
    options: { staleTime?: number } = {},
  ): Promise<T> {
    const sKey = this.serializeKey(key);
    const entry = this.cache.get(sKey);
    const staleTime = options.staleTime ?? this.defaultStaleTime;

    if (entry && !entry.isStale && Date.now() - entry.updatedAt < staleTime) {
      return entry.data as T;
    }

    // If cached but stale, return stale while revalidating in background
    if (entry) {
      fetcher()
        .then(fresh => this.setQueryData(key, fresh))
        .catch(err => console.warn("[TanStack QueryClient] Background refetch failed:", err));
      return entry.data as T;
    }

    const fresh = await fetcher();
    this.setQueryData(key, fresh);
    return fresh;
  }
}
