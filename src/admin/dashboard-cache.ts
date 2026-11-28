interface CacheEntry {
  promise: Promise<unknown>;
  expiresAt: number;
}

/** Per-process, bounded cache. Pending requests share work; failures are never cached. */
export class DashboardCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs = 15_000,
    private readonly maxEntries = 100,
  ) {}

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > Date.now())
      return existing.promise as Promise<T>;
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    const entry: CacheEntry = {
      promise: Promise.resolve(),
      expiresAt: Infinity,
    };
    entry.promise = Promise.resolve()
      .then(load)
      .then(
        (result) => {
          entry.expiresAt = Date.now() + this.ttlMs;
          return result;
        },
        (error: unknown) => {
          // An older failed request must not evict a newer request after clear/expiry.
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    this.entries.set(key, entry);
    return entry.promise as Promise<T>;
  }

  clear() {
    this.entries.clear();
  }
}
