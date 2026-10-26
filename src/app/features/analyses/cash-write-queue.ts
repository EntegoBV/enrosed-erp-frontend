/**
 * Writes of one container must reach the server in the same order: a slow
 * save must finish before a reset or a newer save starts. Different
 * containers remain independent, and a failed request never jams the queue.
 */
export class CashWriteQueue {
  private readonly tails = new Map<number, Promise<void>>();

  run<T>(orderId: number, operation: () => Promise<T>): Promise<T> {
    const task = (this.tails.get(orderId) ?? Promise.resolve()).then(operation);
    const tail = task.then(() => undefined, () => undefined);
    this.tails.set(orderId, tail);
    void tail.then(() => {
      if (this.tails.get(orderId) === tail) this.tails.delete(orderId);
    });
    return task;
  }
}
