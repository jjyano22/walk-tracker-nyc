// Client-side stale-while-revalidate over localStorage. The app's data
// changes slowly (new walks a few times a day), so painting instantly
// from the last visit's snapshot and swapping in fresh data when it
// arrives makes opens feel immediate even on a cold CDN cache.

/**
 * Returns the cached value synchronously (or null on first ever visit)
 * plus a promise for the fresh network value. The fresh value is
 * persisted for next time.
 */
export function cachedJson<T>(
  key: string,
  url: string
): { cached: T | null; fresh: Promise<T> } {
  let cached: T | null = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) cached = JSON.parse(raw) as T;
  } catch {
    // ignore quota / parse issues — treat as no cache
  }
  const fresh = fetch(url)
    .then((r) => r.json())
    .then((data: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // storage full — fine, next open just fetches again
      }
      return data;
    });
  return { cached, fresh };
}

/**
 * Fire-and-forget variant for React state: calls `set` immediately with
 * the cached snapshot (if any), then again when fresh data arrives.
 */
export function hydrateJson<T>(
  key: string,
  url: string,
  set: (value: T) => void
): void {
  const { cached, fresh } = cachedJson<T>(key, url);
  if (cached !== null) set(cached);
  fresh.then(set).catch(console.error);
}
