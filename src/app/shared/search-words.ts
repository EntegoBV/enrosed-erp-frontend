/**
 * The typed text as words: every one must occur, in any order, so
 * "slim dome" finds "Rose Dome Slim 23 cm". Both sides are expected in the
 * caller's own normalised form (lower case). An empty needle matches.
 */
export function matchesWords(haystack: string, needle: string): boolean {
  return needle.trim().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}
