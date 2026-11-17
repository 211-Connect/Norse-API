import { LRUCache } from 'lru-cache';

/**
 * Remembers which cache keys this process wrote, oldest first, so the caller
 * can delete the oldest ones once a cap is passed. Redis has no per-prefix
 * cap, so this keeps the per-word rarity entries bounded. The count is per
 * process: with several pods, each pod bounds its own writes.
 * Built on lru-cache: a re-added key counts as new, the oldest is evicted.
 */
export class BoundedKeyRegistry {
  private readonly keys: LRUCache<string, true>;
  private evicted: string[] = [];

  constructor(cap: number) {
    this.keys = new LRUCache<string, true>({
      max: cap,
      dispose: (_value, key, reason) => {
        if (reason === 'evict') this.evicted.push(key);
      },
    });
  }

  get size(): number {
    return this.keys.size;
  }

  /** Records the keys; returns the oldest keys that must now be deleted. */
  add(keys: string[]): string[] {
    this.evicted = [];
    for (const key of keys) this.keys.set(key, true);
    return this.evicted;
  }
}
