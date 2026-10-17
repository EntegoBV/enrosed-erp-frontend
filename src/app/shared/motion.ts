/**
 * Motion helpers for script-driven movement. CSS motion uses the tokens
 * and mo-* utilities of styles/motion.scss; these two cover the rare case
 * where code moves something itself.
 */

/** True while the user asks the system for less motion. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The behavior for scrollTo / scrollIntoView in new code: 'smooth', or 'auto' under reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
