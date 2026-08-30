import { useEffect, RefObject } from "react";

/**
 * Attaches a native, non-passive "wheel" listener to the given element.
 *
 * React's JSX `onWheel` prop is attached as a PASSIVE listener (a perf
 * optimization for touch/wheel events, standard since React 17), so calling
 * `e.preventDefault()` inside a plain onWheel handler is silently a no-op --
 * confirmed live during this feature's own verification: the value-change
 * logic still runs, but the page/container can still scroll underneath a
 * control the user is spinning with the mouse wheel, since the browser never
 * actually receives the prevented-default. A real
 * `addEventListener("wheel", handler, { passive: false })` is what lets
 * preventDefault() actually suppress that scroll.
 */
export function useNonPassiveWheel<T extends HTMLElement>(ref: RefObject<T | null>, handler: (e: WheelEvent) => void): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  });
}
