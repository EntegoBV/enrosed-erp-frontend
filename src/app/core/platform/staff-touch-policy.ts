/** Keep the staff UI at its designed scale on touch devices, without cancelling ordinary taps or scrolling. */
export function installStaffTouchPolicy(document: Document): () => void {
  if ((document.defaultView?.navigator.maxTouchPoints ?? 0) <= 0) return () => {};

  const root = document.documentElement;
  const hadClass = root.classList.contains('staff-touch-fixed');
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const originalViewport = viewport?.getAttribute('content') ?? null;
  if (viewport) {
    const options = (originalViewport ?? '').split(',')
      .map(option => option.trim()).filter(option => option && !/^(?:minimum-scale|maximum-scale|user-scalable)\s*=/i.test(option));
    viewport.setAttribute('content', [...options, 'minimum-scale=1', 'maximum-scale=1', 'user-scalable=no'].join(', '));
  }
  root.classList.add('staff-touch-fixed');

  // Safari can ignore viewport scale limits. Its gesture events and a
  // multi-touch fallback complement CSS touch-action, including in overlays.
  const preventGesture = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
  };
  const preventPinch = (event: TouchEvent): void => {
    if (event.touches.length > 1) preventGesture(event);
  };
  const options: AddEventListenerOptions = { passive: false, capture: true };
  document.addEventListener('gesturestart', preventGesture, options);
  document.addEventListener('gesturechange', preventGesture, options);
  document.addEventListener('touchstart', preventPinch, options);
  document.addEventListener('touchmove', preventPinch, options);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('gesturestart', preventGesture, true);
    document.removeEventListener('gesturechange', preventGesture, true);
    document.removeEventListener('touchstart', preventPinch, true);
    document.removeEventListener('touchmove', preventPinch, true);
    if (!hadClass) root.classList.remove('staff-touch-fixed');
    if (viewport) {
      if (originalViewport === null) viewport.removeAttribute('content');
      else viewport.setAttribute('content', originalViewport);
    }
  };
}
