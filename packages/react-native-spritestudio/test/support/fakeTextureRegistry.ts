import { SsRuntimeModule } from './fakeRuntime'

/**
 * Stands in for `core/SsTextureRegistry`, which needs Skia to build a paint.
 *
 * Keeps the real one's two load-bearing properties: entries are keyed by the
 * **Brain's** hash of the cellmap name, and `dispose` / `unregister` are what a
 * player uses to take back exactly what it put in. `size` is what
 * `useSpriteStudioPlayer` reads to call a player drawable.
 */
export class SsTextureRegistry {
  /** Every one built in this test, newest last. */
  static readonly created: SsTextureRegistry[] = []

  static reset(): void {
    this.created.length = 0
  }

  private readonly entries = new Map<number, unknown>()
  /** Mirrors the real registry's base-paint capture, so restore is exact. */
  private readonly baseUnderOverride = new Map<number, unknown>()
  disposed = false

  constructor() {
    SsTextureRegistry.created.push(this)
  }

  register(cellmapName: string, image: unknown): void {
    this.registerByHash(SsRuntimeModule.hashString(cellmapName), image)
  }

  registerByHash(textureHash: number, image: unknown): void {
    this.entries.set(textureHash, image)
  }

  has(textureHash: number): boolean {
    return this.entries.has(textureHash)
  }

  /** Test-only: what is bound under a hash right now, or undefined. */
  bound(textureHash: number): unknown {
    return this.entries.get(textureHash)
  }

  override(textureHash: number, image: unknown): void {
    if (!this.baseUnderOverride.has(textureHash)) {
      this.baseUnderOverride.set(textureHash, this.entries.get(textureHash) ?? null)
    }
    this.entries.set(textureHash, image)
  }

  isOverridden(textureHash: number): boolean {
    return this.baseUnderOverride.has(textureHash)
  }

  restore(textureHash: number): boolean {
    if (!this.baseUnderOverride.has(textureHash)) return false
    const base = this.baseUnderOverride.get(textureHash) ?? null
    this.baseUnderOverride.delete(textureHash)
    if (base == null) this.entries.delete(textureHash)
    else this.entries.set(textureHash, base)
    return true
  }

  get size(): number {
    return this.entries.size
  }

  unregister(textureHash: number): boolean {
    this.baseUnderOverride.delete(textureHash)
    return this.entries.delete(textureHash)
  }

  dispose(): void {
    this.disposed = true
    this.entries.clear()
    this.baseUnderOverride.clear()
  }
}
