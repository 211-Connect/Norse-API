/**
 * Remembers which cache keys this process wrote, oldest first, so the caller
 * can delete the oldest ones once a cap is passed. Redis has no per-prefix
 * cap, so this keeps the per-word rarity entries bounded. The count is per
 * process: with several pods, each pod bounds its own writes.
 */
export class BoundedKeyRegistry {
  private readonly keys = new Set<string>();

  constructor(private readonly cap: number) {}

  get size(): number {
    return this.keys.size;
  }

  /** Records the keys; returns the oldest keys that must now be deleted. */
  add(keys: string[]): string[] {
    for (const key of keys) {
      this.keys.delete(key);
      this.keys.add(key);
    }
    const evicted: string[] = [];
    for (const key of this.keys) {
      if (this.keys.size <= this.cap) break;
      this.keys.delete(key);
      evicted.push(key);
    }
    return evicted;
  }
}
