/**
 * Smooth scrolling from script respects prefers-reduced-motion.
 *
 * CSS motion stops through styles/motion.scss, but about two dozen
 * scrollIntoView / scrollTo calls ask for behavior:'smooth' in code. This
 * patch turns 'smooth' into 'auto' while the user asks for reduced motion,
 * so none of those callers has to change. It wraps
 * Element.prototype.scrollIntoView, scrollTo and scrollBy and
 * window.scrollTo and scrollBy; the media query is read at call time, so a
 * changed system setting applies at once. Installed once from the App
 * constructor; returns the uninstall function. Import-free: node-tested
 * with a fake window.
 */

type ScrollFn = (this: unknown, ...args: unknown[]) => unknown;

interface ScrollTarget {
  scrollTo?: ScrollFn;
  scrollBy?: ScrollFn;
  scrollIntoView?: ScrollFn;
}

export interface ReducedMotionWindow {
  matchMedia?: (query: string) => { matches: boolean };
  Element?: { prototype: ScrollTarget };
  scrollTo?: ScrollFn;
  scrollBy?: ScrollFn;
}

const QUERY = '(prefers-reduced-motion: reduce)';
const INSTALLED = Symbol.for('enrosed.reducedMotionScroll');

/** The options object with behavior 'smooth' turned into 'auto'; anything else passes unchanged. */
export function calmScrollArgs(args: readonly unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (first && typeof first === 'object' && (first as { behavior?: unknown }).behavior === 'smooth') {
    return [{ ...(first as object), behavior: 'auto' }, ...rest];
  }
  return [...args];
}

export function installReducedMotionScroll(win: ReducedMotionWindow): () => void {
  const flagged = win as ReducedMotionWindow & { [INSTALLED]?: boolean };
  if (flagged[INSTALLED] || typeof win.matchMedia !== 'function') return () => {};
  flagged[INSTALLED] = true;

  const reduced = (): boolean => {
    try { return !!win.matchMedia?.(QUERY).matches; } catch { return false; }
  };
  const restores: Array<() => void> = [];
  const wrap = (target: ScrollTarget | undefined, name: keyof ScrollTarget): void => {
    const original = target?.[name];
    if (!target || typeof original !== 'function') return;
    target[name] = function (this: unknown, ...args: unknown[]) {
      return original.apply(this, reduced() ? calmScrollArgs(args) : args);
    };
    restores.push(() => { target[name] = original; });
  };

  const proto = win.Element?.prototype;
  wrap(proto, 'scrollIntoView');
  wrap(proto, 'scrollTo');
  wrap(proto, 'scrollBy');
  wrap(win as ScrollTarget, 'scrollTo');
  wrap(win as ScrollTarget, 'scrollBy');

  return () => {
    for (const restore of restores.reverse()) restore();
    flagged[INSTALLED] = false;
  };
}
