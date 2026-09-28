import { useCallback, useSyncExternalStore } from 'react';

/** Подписка на медиазапрос: перерисовка только при смене результата, а не на каждый resize. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Боковая колонка помещается рядом с видом; уже — панель открывается шторкой. */
export const WIDE_LAYOUT = '(min-width: 1024px)';
