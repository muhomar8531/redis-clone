interface Entry {
  value: string;
  expiresAt: number | null;
}

export class Store {
  private data = new Map<string, Entry>();

  private getActiveEntry(key: string): Entry | undefined {
    const entry = this.data.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: string, ttlMs?: number): void {
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
    this.data.set(key, { value, expiresAt });
  }

  get(key: string): string | null {
    const entry = this.getActiveEntry(key);
    return entry ? entry.value : null;
  }

  expire(key: string, seconds: number): number {
    const entry = this.getActiveEntry(key);
    if (!entry) {
      return 0;
    }
    if (seconds <= 0) {
      this.data.delete(key);
      return 1;
    }
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  ttl(key: string): number {
    const entry = this.getActiveEntry(key);
    if (!entry) {
      return -2;
    }
    if (entry.expiresAt === null) {
      return -1;
    }
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  del(keys: string[]): number {
    let deleted = 0;
    for (const key of keys) {
      if (this.getActiveEntry(key) !== undefined) {
        this.data.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}
