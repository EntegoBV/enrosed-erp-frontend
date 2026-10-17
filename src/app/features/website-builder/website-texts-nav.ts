/**
 * Where the phone back control of Teksten and SEO goes (critique N11.2,
 * design §3.4): the returnTo page an editor was opened from, the list it
 * was pushed from, else its site part; an area goes back to the Teksten
 * list, SEO's page texts to Overzicht. The page compares the target with
 * the history entry below: history back when they match, otherwise the
 * address is replaced. Pure and import-free (node-tested).
 */
export type TextsPhoneView = 'parts' | 'area' | 'editor';

export interface TextsBackInput {
  view: TextsPhoneView;
  seoMode: boolean;
  /** An internal returnTo path (a homepage block), or ''. */
  returnPath: string;
  /** The list the editor was pushed from on this page, or null after an inbound link. */
  pushedFrom: 'parts' | 'area' | null;
  /** The editor's site part (websiteTextArea(key).key). */
  editorArea: string | null;
}

export type TextsBackTarget =
  | { kind: 'url'; url: string }
  | { kind: 'query'; query: Record<string, string | null> };

export function textsBackTarget(input: TextsBackInput): TextsBackTarget {
  if (input.view === 'editor') {
    if (input.returnPath) return { kind: 'url', url: input.returnPath };
    /* SEO's page texts have their list under ?tab=paginas; a search hit or the language banner opened from the parts list. */
    if (input.seoMode || input.pushedFrom === 'parts') return { kind: 'query', query: { key: null, gebied: null } };
    return { kind: 'query', query: { key: null, gebied: input.editorArea } };
  }
  if (input.seoMode) return { kind: 'url', url: '/website' };
  return { kind: 'query', query: { gebied: null } };
}
