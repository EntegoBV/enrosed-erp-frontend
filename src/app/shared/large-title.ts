/**
 * The iOS large-title behaviour, shared by IosNav and PageHeader: a 1 px
 * sentinel sits right under the large title; once it has scrolled under
 * the bar, the title is gone and the bar takes it over (glass background,
 * small title). Returns the stop function.
 */
export function observeLargeTitle(
  bar: HTMLElement,
  sentinel: HTMLElement,
  onChange: (condensed: boolean) => void,
): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const height = Math.round(bar.getBoundingClientRect().height);
  const observer = new IntersectionObserver(([entry]) => {
    onChange(!entry.isIntersecting && entry.boundingClientRect.top < height);
  }, { rootMargin: `-${height}px 0px 0px 0px`, threshold: 0 });
  observer.observe(sentinel);
  return () => observer.disconnect();
}
