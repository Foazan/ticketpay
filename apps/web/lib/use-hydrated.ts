import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * False in the server HTML and until React has hydrated the page, then true.
 * Interactive controls stay disabled until then, so an early click or tap is never lost and a form
 * is never submitted natively (which would put its fields, a password included, into the URL).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
