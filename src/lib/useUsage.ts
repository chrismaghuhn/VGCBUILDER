import {useEffect, useState} from 'react';
import {loadUsage, type UsageSource} from './data';

/**
 * Usage stats of the chosen source. Null only until the first source has loaded; while switching
 * sources the previous one stays visible until the new one is there.
 */
export function useUsage(source: string): {usage: UsageSource | null; error: string} {
  const [usage, setUsage] = useState<UsageSource | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadUsage(source).then(
      u => { if (live) { setUsage(u); setError(''); } },
      e => { if (live) setError((e as Error).message); },
    );
    return () => { live = false; };
  }, [source]);
  return {usage, error};
}
