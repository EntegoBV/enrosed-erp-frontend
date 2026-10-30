/**
 * The iOS large-title behaviour, shared by IosNav and PageHeader: a 1 px
 * sentinel sits right under the large title; once it has scrolled under
 * the bar, the title is gone and the bar takes it over (glass background,
 * small title). Returns the stop function. The line is the bar's height
 * (44 px + the status inset; in the native host the spacer's --safe-t, 24 px
 * on an iPhone Duo's strip pose) unless a getter names another one (IosNav's
 * `stuck` reads its sub-bar's own top). It changes when an iPhone Duo folds
 * or turns, so the observers are rebuilt from the new line.
 *
 * Two observers give the flip hysteresis (Emre, 2026-10-30: "wanneer ik te
 * snel scrol flikkert alles"). The title condenses the moment the sentinel
 * passes under the line, as before; it comes back only once the sentinel
 * is at least RELEASE_PX below that line again. A sentinel resting on the
 * line (a scroll that stops there, a rubber-band, the host's own bar) no
 * longer flips the bar, the small title and the native title on every
 * jitter. A band that only says it stands on its line passes `release` 0: it
 * flips nothing native, and held on the way back it hung below the bar with
 * the page showing through the gap.
 */
const RELEASE_PX = 24;

/**
 * The observers' root runs on this far below the viewport. An observer only speaks when the intersection changes: a
 * sentinel below the fold at the top of the page (the sales steps at 678 px high) that a jump takes past the line, or a
 * jump takes back, would never have intersected a root that ends at the viewport's bottom, and the state stayed wrong.
 */
const BELOW_FOLD_PX = 100000;

/** The host's marks on <html> that move the strip poses' top offsets without resizing a bar (styles/host.scss). */
const HOST_LINE_MARKS = ['data-host-strip', 'data-host-bar'];

/**
 * Calls back when those marks change, and again two frames later: under reduced motion every property has a tiny
 * transition (motion.scss), so a computed top is one frame in flight at first. Nothing to watch without a host, so the
 * PWA carries no observer.
 */
export function onHostLineChange(doc: Document, change: () => void): () => void {
  const view = doc.defaultView;
  if (!view || !doc.documentElement.hasAttribute('data-host') || typeof MutationObserver === 'undefined') return () => {};
  let frame = 0;
  const marks = new MutationObserver(() => {
    change();
    view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => { frame = view.requestAnimationFrame(change); });
  });
  marks.observe(doc.documentElement, { attributes: true, attributeFilter: HOST_LINE_MARKS });
  return () => { marks.disconnect(); view.cancelAnimationFrame(frame); };
}

export function observeLargeTitle(
  bar: HTMLElement,
  sentinel: HTMLElement,
  onChange: (condensed: boolean) => void,
  line?: () => number,
  release_px = RELEASE_PX,
): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const measure = line ?? ((): number => Math.round(bar.getBoundingClientRect().height));
  let height = -1;
  let condensed = false;
  let condense: IntersectionObserver | null = null;
  let release: IntersectionObserver | null = null;
  const set = (next: boolean): void => {
    if (next === condensed) return;
    condensed = next;
    /* What stood above the sentinel may have grown since the last measure (a caption, a loaded hero). */
    if (next) armRelease();
    onChange(next);
  };
  /* Back in view: the sentinel is inside the root that starts release_px under the line, or less where its place at the
     top of the page lies nearer than that (a small title under the line of a strip pose): at the top it always comes
     back. Between the two lines neither observer speaks, so the state holds. */
  const armRelease = (): void => {
    release?.disconnect();
    const atTop = Math.floor(sentinel.getBoundingClientRect().bottom + (sentinel.ownerDocument.defaultView?.scrollY ?? 0)) - height - 1;
    release = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) set(false);
    }, { rootMargin: `-${height + Math.max(0, Math.min(release_px, atTop))}px 0px ${BELOW_FOLD_PX}px 0px`, threshold: 0 });
    release.observe(sentinel);
  };
  const start = (): void => {
    condense?.disconnect();
    height = measure();
    /* Gone under the line: the sentinel has left the root that starts there, upwards (touching that edge still counts
       as intersecting). */
    condense = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && entry.boundingClientRect.top < height) set(true);
    }, { rootMargin: `-${height}px 0px ${BELOW_FOLD_PX}px 0px`, threshold: 0 });
    condense.observe(sentinel);
    armRelease();
  };
  start();
  /* Folding, unfolding or turning changes --safe-t and so the bar: rebuild from the new line (the transient
     466 x 498 resize of a fold runs it twice, harmlessly). */
  const check = (): void => { if (measure() !== height) start(); };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
  resize?.observe(bar);
  const stopMarks = onHostLineChange(bar.ownerDocument, check);
  return () => { condense?.disconnect(); release?.disconnect(); resize?.disconnect(); stopMarks(); };
}
