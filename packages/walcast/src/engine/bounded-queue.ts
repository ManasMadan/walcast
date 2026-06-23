/**
 * Bounded blocking queue for the per-sink delivery pipeline. `put` suspends
 * the producer when full — backpressure propagates from a slow sink up
 * through the engine to the replication socket. `takeBatch` collects up to
 * `max` items, waiting at most `lingerMs` after the first for stragglers.
 */
export class BoundedQueue<T> {
  private items: T[] = []
  private putWaiters: Array<() => void> = []
  private takeWaiters: Array<() => void> = []
  private closed = false

  constructor(private capacity: number) {}

  get size(): number {
    return this.items.length
  }

  get isClosed(): boolean {
    return this.closed
  }

  async put(item: T): Promise<void> {
    while (this.items.length >= this.capacity && !this.closed) {
      await new Promise<void>((resolve) => this.putWaiters.push(resolve))
    }
    if (this.closed) return
    this.items.push(item)
    this.takeWaiters.shift()?.()
  }

  /** Take 1..max items; resolves null when closed and drained. */
  async takeBatch(max: number, lingerMs: number): Promise<T[] | null> {
    while (this.items.length === 0) {
      if (this.closed) return null
      await new Promise<void>((resolve) => this.takeWaiters.push(resolve))
    }
    if (lingerMs > 0 && this.items.length < max) {
      await new Promise((resolve) => setTimeout(resolve, lingerMs))
    }
    const batch = this.items.splice(0, max)
    for (const w of this.putWaiters.splice(0)) w()
    return batch
  }

  /** Unblock everyone; puts become no-ops, takes drain then return null. */
  close(): void {
    this.closed = true
    for (const w of this.putWaiters.splice(0)) w()
    for (const w of this.takeWaiters.splice(0)) w()
  }
}
