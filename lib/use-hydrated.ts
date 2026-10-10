import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** false during SSR + hydration, true once client has hydrated. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
