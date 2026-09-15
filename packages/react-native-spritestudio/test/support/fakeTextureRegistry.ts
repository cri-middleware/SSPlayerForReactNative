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

  get size(): number {
    return this.entries.size
  }

  unregister(textureHash: number): boolean {
    return this.entries.delete(textureHash)
  }

  dispose(): void {
    this.disposed = true
    this.entries.clear()
  }
}
