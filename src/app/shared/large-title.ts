/**
 * The iOS large-title behaviour, shared by IosNav and PageHeader: a 1 px
 * sentinel sits right under the large title; once it has scrolled under
 * the bar, the title is gone and the bar takes it over (glass background,
 * small title). Returns the stop function. The bar's height (44 px + the
 * status inset; in the native host the spacer's --safe-t, which may be 0)
 * changes when an iPhone Duo folds or turns, so the observers are rebuilt
 * from the new line.
 *
 * Two observers give the flip hysteresis (Emre, 2026-10-30: "wanneer ik te
 * snel scrol flikkert alles"). The title condenses the moment the sentinel
 * passes under the bar's line, as before; it comes back only once the
 * sentinel is at least RELEASE_PX below that line again. A sentinel resting
 * on the line (a scroll that stops there, a rubber-band, the host's own
 * bar) no longer flips the bar, the small title and the native title on
 * every jitter.
 */
const RELEASE_PX = 24;

export function observeLargeTitle(
  bar: HTMLElement,
  sentinel: HTMLElement,
  onChange: (condensed: boolean) => void,
): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const measure = (): number => Math.round(bar.getBoundingClientRect().height);
  let height = -1;
  let condensed = false;
  let condense: IntersectionObserver | null = null;
  let release: IntersectionObserver | null = null;
  const set = (next: boolean): void => {
    if (next === condensed) return;
    condensed = next;
    onChange(next);
  };
  const start = (): void => {
    condense?.disconnect();
    release?.disconnect();
    height = measure();
    /* Gone under the bar: the sentinel has left the root that starts at the bar's bottom, upwards (touching that
       edge still counts as intersecting; below the viewport it is not condensed either). */
    condense = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && entry.boundingClientRect.top < height) set(true);
    }, { rootMargin: `-${height}px 0px 0px 0px`, threshold: 0 });
    /* Back in view: the sentinel is inside the root that starts RELEASE_PX under the bar's bottom. Between the two
       lines neither observer speaks, so the state holds. */
    release = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) set(false);
    }, { rootMargin: `-${height + RELEASE_PX}px 0px 0px 0px`, threshold: 0 });
    condense.observe(sentinel);
    release.observe(sentinel);
  };
  start();
  /* Folding, unfolding or turning changes --safe-t and so the bar: rebuild from the new height (the transient
     466 x 498 resize of a fold runs it twice, harmlessly). */
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (measure() !== height) start(); });
  resize?.observe(bar);
  return () => { condense?.disconnect(); release?.disconnect(); resize?.disconnect(); };
}
