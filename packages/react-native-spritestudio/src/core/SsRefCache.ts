/**
 * A refcounted, URI-keyed cache for things that are expensive to build and safe
 * to share.
 *
 * Two of them exist: one for `SsResource` (parsing a `.ssab` and handing the
 * bytes to the Brain) and one for decoded `SkImage` atlases. Without them,
 * twenty `<SpriteStudioSprite>`s of one character parse the pack twenty times
 * and decode its atlas twenty times, which is the cost that stops a list or a
 * scene being practical.
 *
 * Sharing an `SsResource` across players is not a liberty taken here — the
 * C-API states it: "To save memory, a single Resource can be bound to multiple
 * Contexts", and `SsInternalPlayer` already documents that it does not own the
 * resource it is built against.
 *
 * ## Why refcounts and not an LRU
 *
 * Because `SsRuntime.liveHandles` has to keep meaning what it means. The leak
 * check loads and disposes N times and asserts the counts come back **exactly**
 * to their baseline, which only works while release is eager. An LRU would hold
 * packs past their last user and read as a leak — so an entry is destroyed the
 * moment its last lease is released, and anything that wants to outlive that
 * says so through `retain()`.
 */
export interface SsRefCacheOptions<T> {
  /** Called when the last lease on a value is released. */
  destroy?: (value: T) => void
}

interface Entry<T> {
  /** Live leases. The entry dies at zero. */
  refs: number
  promise: Promise<T>
  /** Set once `promise` settles; null while a first load is still in flight. */
  value: T | null
  /** Leases `retain()` took, which only `releaseRetained`/`clear` give back. */
  retained: number
}

export class SsRefCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly destroy: (value: T) => void

  constructor(options?: SsRefCacheOptions<T>) {
    this.destroy = options?.destroy ?? (() => {})
  }

  /**
   * Takes a lease on `key`, building it with `create` on the first one.
   *
   * The refcount is incremented **synchronously**, before any await, so two
   * mounts racing on one pack share a single build rather than each starting
   * their own — and so a caller that releases while the build is still in
   * flight is counted correctly rather than dropping a lease that was never
   * taken.
   *
   * Every successful `acquire` must be balanced by exactly one `release`.
   */
  async acquire(key: string, create: () => Promise<T>): Promise<T> {
    let entry = this.entries.get(key)
    if (entry == null) {
      entry = { refs: 0, promise: create(), value: null, retained: 0 }
      this.entries.set(key, entry)
    }
    entry.refs++

    try {
      const value = await entry.promise
      entry.value = value
      // A release that arrived while this was in flight left the refcount at
      // zero with nothing to destroy yet. Settle it now — the caller awaiting
      // this is the one that released, and it is about to drop the value.
      if (entry.refs <= 0) this.evict(key, entry)
      return value
    } catch (error) {
      // A failed build must not be cached: the next caller should get a fresh
      // attempt rather than the same rejection forever.
      entry.refs--
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    }
  }

  /** Gives back one lease, destroying the value when it was the last. */
  release(key: string): void {
    const entry = this.entries.get(key)
    if (entry == null) return
    entry.refs--
    // No `retained` test needed: `retain()` took a lease of its own, so a
    // retained entry cannot reach zero here.
    if (entry.refs <= 0) this.evict(key, entry)
  }

  /**
   * Takes a lease that no `release` will ever balance — what `preload` holds.
   *
   * Counted, one `releaseRetained` each: two packs that share an atlas each
   * retain it, and unloading one must leave it for the other. Preloading the
   * same pack twice is `ssPreload`'s to fold, and it does.
   */
  retain(key: string): void {
    const entry = this.entries.get(key)
    if (entry == null) return
    entry.retained++
    entry.refs++
  }

  /** Gives back one `retain()` lease, if one is held. */
  releaseRetained(key: string): void {
    const entry = this.entries.get(key)
    if (entry == null || entry.retained === 0) return
    entry.retained--
    entry.refs--
    if (entry.refs <= 0) this.evict(key, entry)
  }

  /**
   * Drops everything, retained entries included.
   *
   * The leak check runs this first: a cache holding packs is indistinguishable
   * from a leak when the measurement is a count of live handles.
   */
  clear(): void {
    for (const [key, entry] of [...this.entries]) this.evict(key, entry)
  }

  /** Entries currently held, for diagnostics and the leak check's readout. */
  get size(): number {
    return this.entries.size
  }

  private evict(key: string, entry: Entry<T>): void {
    if (this.entries.get(key) === entry) this.entries.delete(key)
    // Null while a build is still in flight. The `acquire` that started it
    // checks the refcount when it settles and evicts again, which is what
    // covers that window.
    if (entry.value != null) {
      this.destroy(entry.value)
      entry.value = null
    }
  }
}
