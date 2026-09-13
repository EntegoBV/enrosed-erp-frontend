export interface ProofFile {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly type: string;
}

export const MAX_PROOF_BYTES = 25 * 1024 * 1024;
export const PROOF_ACCEPT = '.pdf,.jpg,.jpeg,.png';

export function proofFileKey(file: ProofFile): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/** Repeated selections and drops add to the same queue without replacing earlier proofs. */
export function appendPaymentProofs<T extends ProofFile>(
  current: readonly T[], incoming: readonly T[], maximum = 5,
): { files: T[]; errors: string[] } {
  const limit = Number.isFinite(maximum) ? Math.max(0, Math.floor(maximum)) : 5;
  const files = [...current];
  const keys = new Set(files.map(proofFileKey));
  const errors: string[] = [];
  let overflow = 0;
  for (const file of incoming) {
    if (keys.has(proofFileKey(file))) continue;
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
      errors.push(`${file.name}: kies een PDF, JPG of PNG.`);
      continue;
    }
    if (file.size <= 0 || !Number.isFinite(file.size)) {
      errors.push(`${file.name}: dit bestand is leeg.`);
      continue;
    }
    if (file.size > MAX_PROOF_BYTES) {
      errors.push(`${file.name}: maximaal 25 MB per bestand.`);
      continue;
    }
    if (files.length >= limit) { overflow++; continue; }
    files.push(file);
    keys.add(proofFileKey(file));
  }
  if (overflow) errors.push(`${limit ? `Er is ruimte voor ${limit} nieuwe bestanden.` : 'Deze betaling heeft al het maximale aantal betaalbewijzen.'} ${overflow} ${overflow === 1 ? 'bestand is' : 'bestanden zijn'} niet toegevoegd.`);
  return { files, errors };
}
