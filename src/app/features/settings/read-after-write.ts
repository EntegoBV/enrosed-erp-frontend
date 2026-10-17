/**
 * Keeps a read from landing after a write it raced with. The settings
 * overview re-reads the company profile and the website price switch every
 * time it shows, also while a save of the same thing is on its way. A read
 * that started before that save, or while it ran, may have seen the row
 * before the write committed; if it answers after the save, it would put the
 * old values back on screen (and a later partial save would send them).
 * So such a read is dropped: the save's own answer is the fresher state.
 * Pure (node-tested).
 */
export class ReadAfterWrite {
  private generation = 0;
  private writing = 0;

  /** At the start of a read: its ticket. */
  readStarted(): number {
    return this.generation;
  }

  /** When the read answers: whether it may still be applied. */
  readCurrent(ticket: number): boolean {
    return this.writing === 0 && ticket === this.generation;
  }

  writeStarted(): void {
    this.generation++;
    this.writing++;
  }

  writeEnded(): void {
    this.generation++;
    this.writing = Math.max(0, this.writing - 1);
  }
}
