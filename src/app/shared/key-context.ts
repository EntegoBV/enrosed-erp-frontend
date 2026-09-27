/**
 * Whether a workspace keyboard shortcut may act on a key press. Shortcuts
 * never fire while the user types, never behind an open sheet, menu or
 * popover, and only when focus is in the workspace (or nowhere in
 * particular). A DOM helper, not node-tested: pages pass the booleans on to
 * their own pure shortcut tables, which are.
 */
export interface KeyContext {
  /** Focus is in a field that takes text. */
  typing: boolean;
  /** A sheet (.overlay), context menu (.cm) or kit overlay ([data-kit-overlay]) is open. */
  overlayOpen: boolean;
  /** Focus is inside the scope, or on the body. */
  inScope: boolean;
  /** ⌘ on a Mac, Ctrl elsewhere. */
  mod: boolean;
}

/** Inputs that take a click, not text: shortcuts still work on them. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

export function keyContext(event: KeyboardEvent, scope: Element | null, doc: Document = document): KeyContext {
  const target = event.target instanceof Element ? event.target : null;
  return {
    typing: isTypingTarget(target),
    overlayOpen: doc.querySelector('.overlay, .cm, [data-kit-overlay]') !== null,
    inScope: !scope || !target || target === doc.body || scope.contains(target),
    mod: event.metaKey || event.ctrlKey,
  };
}

function isTypingTarget(target: Element | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}
