/**
 * The iOS large-title behaviour, shared by IosNav and PageHeader: a 1 px
 * sentinel sits right under the large title; once it has scrolled under
 * the bar, the title is gone and the bar takes it over (glass background,
 * small title). Returns the stop function. The bar's height (44 px + the
 * status inset) changes when an iPhone Duo folds or turns, so the observer
 * is rebuilt from the new line.
 */
export function observeLargeTitle(
  bar: HTMLElement,
  sentinel: HTMLElement,
  onChange: (condensed: boolean) => void,
): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const measure = (): number => Math.round(bar.getBoundingClientRect().height);
  let height = -1;
  let observer: IntersectionObserver | null = null;
  const start = (): void => {
    observer?.disconnect();
    height = measure();
    observer = new IntersectionObserver(([entry]) => {
      onChange(!entry.isIntersecting && entry.boundingClientRect.top < height);
    }, { rootMargin: `-${height}px 0px 0px 0px`, threshold: 0 });
    observer.observe(sentinel);
  };
  start();
  /* Folding, unfolding or turning changes --safe-t and so the bar: rebuild from the new height (the transient
     466 x 498 resize of a fold runs it twice, harmlessly). */
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (measure() !== height) start(); });
  resize?.observe(bar);
  return () => { observer?.disconnect(); resize?.disconnect(); };
}
