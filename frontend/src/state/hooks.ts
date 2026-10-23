import { DependencyList, useCallback, useEffect, useRef, useState } from "react";

/** Current unix time in seconds, ticking every second. A display aid only — never authorises actions. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type AsyncState<T> = { data: T | undefined; error: unknown; loading: boolean; reload: () => void };

/** Run an async loader when deps change; optionally refresh every `pollMs`. Keeps the last data while reloading. */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList, pollMs?: number): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRef.current().then(
      (value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => setTick((n) => n + 1), pollMs);
    return () => clearInterval(t);
  }, [pollMs]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}
