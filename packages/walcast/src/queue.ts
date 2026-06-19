/**
 * Bounded producer/consumer queue bridging a push source (the replication
 * socket) to a pull consumer (an async iterator). When the buffer crosses
 * the high-water mark `onPause` fires so the producer can stop reading from
 * the socket — we apply backpressure to Postgres rather than drop events.
 */
function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: Array<(r: IteratorResult<T>) => void> = []
  private rejecters: Array<(e: unknown) => void> = []
  private ended = false
  private failure: unknown = null
  private paused = false

  constructor(
    private opts: {
      highWaterMark?: number
      onPause?: () => void
      onResume?: () => void
    } = {},
  ) {}

  get size(): number {
    return this.items.length
  }

  push(item: T): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) {
      this.rejecters.shift()
      waiter({ value: item, done: false })
      return
    }
    this.items.push(item)
    const hwm = this.opts.highWaterMark ?? Infinity
    if (!this.paused && this.items.length >= hwm) {
      this.paused = true
      this.opts.onPause?.()
    }
  }

  /** No more items will arrive; pending reads resolve as done. */
  end(): void {
    this.ended = true
    for (const w of this.waiters) w({ value: undefined, done: true })
    this.waiters = []
    this.rejecters = []
  }

  /** Propagate a failure to the consumer. */
  fail(err: unknown): void {
    if (this.ended) return
    this.failure = err
    this.ended = true
    for (const r of this.rejecters) r(err)
    this.waiters = []
    this.rejecters = []
  }

  private next(): Promise<IteratorResult<T>> {
    const item = this.items.shift()
    if (item !== undefined) {
      const hwm = this.opts.highWaterMark ?? Infinity
      if (this.paused && this.items.length < hwm / 2) {
        this.paused = false
        this.opts.onResume?.()
      }
      return Promise.resolve({ value: item, done: false })
    }
    if (this.failure !== null) return Promise.reject(toError(this.failure))
    if (this.ended) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve, reject) => {
      this.waiters.push(resolve)
      this.rejecters.push(reject)
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() }
  }
}
