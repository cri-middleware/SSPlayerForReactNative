import type { SsBox, SsTextureInfo } from '../../src/specs/SsRuntime.nitro'

/**
 * Stands in for `src/runtime` — the module whose Nitro `createHybridObject` at
 * import time is what makes Layer 3 need a device.
 *
 * It is a **pack table**, not a playback model: `definePack` says what the Brain
 * finds at a URI, and everything downstream of a load reads from it. The
 * playback semantics live in `fakeInternalPlayer`, one layer up.
 */

/** What the fake Brain finds at a URI. Defaults are "a one-animation pack". */
export interface FakePack {
  animations: string[]
  /** External packs its Instance parts reach, without the `.ssab`. */
  instancePacks: string[]
  textures: SsTextureInfo[]
  /** What `measureContentBox` finds in it. A zero-sized box is a valid answer. */
  contentBox: SsBox
}

const packs = new Map<string, FakePack>()

/** Handles handed out and not yet given back — what `liveHandles` counts. */
export const live = {
  resources: new Set<FakeResource>(),
  contexts: new Set<object>(),
}

export class FakeResource {
  readonly byteLength = 0
  disposed = false

  constructor(
    readonly uri: string,
    readonly pack: FakePack
  ) {
    live.resources.add(this)
  }

  getExternalInstancePackNames(): string[] {
    return [...this.pack.instancePacks]
  }

  dispose(): void {
    this.disposed = true
    live.resources.delete(this)
  }
}

export function definePack(uri: string, pack: Partial<FakePack> = {}): FakePack {
  const entry: FakePack = {
    animations: ['Anim'],
    instancePacks: [],
    textures: [],
    contentBox: { x: 0, y: 0, width: 100, height: 100 },
    ...pack,
  }
  packs.set(uri, entry)
  return entry
}

/**
 * Opens a defined pack, or fails the way the Brain does for a path that is not
 * there — which is what `loadInstancePacks` is meant to warn about and skip.
 */
export function openPack(uri: string): FakeResource {
  const pack = packs.get(uri)
  if (pack == null) throw new Error(`fake Brain: nothing at '${uri}'`)
  return new FakeResource(uri, pack)
}

const hashes = new Map<string, number>()

export const SsRuntimeModule = {
  version: '0.0.0-fake',
  hasAssetDirectory: true,

  get liveHandles(): { resources: number; contexts: number } {
    return { resources: live.resources.size, contexts: live.contexts.size }
  },

  createResourceFromAsset: (path: string): FakeResource => openPack(path),
  createResourceFromPath: (path: string): FakeResource => openPack(path),
  /**
   * The remote route hands the Brain bytes and nothing else, so the fake reads
   * the pack's name out of them. A test's `fetch` stub is what puts it there.
   */
  createResourceFromBytes: (bytes: ArrayBuffer): FakeResource =>
    openPack(new TextDecoder().decode(bytes)),

  readAsset: (path: string): ArrayBuffer =>
    new TextEncoder().encode(path).buffer as ArrayBuffer,

  /**
   * Distinct and stable per string, which is all any caller needs of it.
   *
   * Deliberately **not** FNV-1a. A second implementation of the Brain's hash is
   * exactly what `SsTextureRegistry` warns against, and one that happened to
   * agree would let a test assert the right number for the wrong reason.
   */
  hashString: (value: string): number => {
    let hash = hashes.get(value)
    if (hash == null) {
      hash = hashes.size + 1
      hashes.set(value, hash)
    }
    return hash
  },
}

export function resetFakeRuntime(): void {
  packs.clear()
  live.resources.clear()
  live.contexts.clear()
  hashes.clear()
}
