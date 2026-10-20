// tokenmaxx fork: query parameters of the hash route, read straight from window.location.
// PageTransition renders routes with a location snapshot that only changes with the pathname, so
// react-router's useSearchParams never sees a new query on the same page.
import { useCallback, useEffect, useState } from 'react';

export function parseHashQuery(hash: string): URLSearchParams {
  const q = hash.indexOf('?');
  return new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '');
}

export function useHashQuery(): [URLSearchParams, (next: URLSearchParams) => void] {
  const [params, setParams] = useState(() => parseHashQuery(window.location.hash));
  useEffect(() => {
    const onChange = () => setParams(parseHashQuery(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const update = useCallback((next: URLSearchParams) => {
    const hash = window.location.hash;
    const path = hash.slice(1).split('?')[0] || '/';
    const qs = next.toString();
    window.location.hash = qs ? `${path}?${qs}` : path;
  }, []);
  return [params, update];
}
