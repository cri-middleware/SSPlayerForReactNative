import type { SsPartOverrides } from '../../src/core/parts'
import { frameChanged, frameShown } from '../../src/player/frames'
import type { SsRootTransform } from '../../src/core/types'
import type {
  SsAudioEvent,
  SsBox,
  SsSignalEvent,
  SsUserDataEvent,
} from '../../src/specs/SsRuntime.nitro'

/** The real module's cap, re-exported because the two frame loops import it. */
export const MAX_STEP_MS = 1000 / 15

/**
 * Stands in for Layer 3 while Layer 4 is under test.
 *
 * Layer 4 is a set of decisions *about* a player — which one exists, when it is
 * torn down, what a boolean prop maps onto — so the player itself is the right
 * thing to make inert here. What it keeps is the two answers those decisions
 * are made against: `setAnimation` fails while there is no resource, and
 * `isPlaying` tells a held transport from a stopped one.
 */
export class SpriteStudioPlayer {
  /** Every one built in this test, newest last. */
  static readonly created: SpriteStudioPlayer[] = []

  /** Makes every load built from here on hang — a load still in flight. */
  static holdLoads = false

  static last(): SpriteStudioPlayer {
    const player = this.created[this.created.length - 1]
    if (player == null) throw new Error('no SpriteStudioPlayer has been built')
    return player
  }

  static reset(): void {
    this.created.length = 0
    this.holdLoads = false
  }

  readonly calls: Array<{ name: string; args: unknown[] }> = []
  readonly textures = {
    size: 0,
    registered: [] as Array<[string, unknown]>,
    register(name: string, image: unknown) {
      this.registered.push([name, image])
      this.size = this.registered.length
    },
  }

  currentAnimation: string | null = null
  isPlaying = false
  /** What a frame loop asks before it records. A test sets it false for a player with nothing new to draw. */
  needsDraw = true
  advances = true
  isLoaded = false
  contentBox: SsBox | null = null
  canvasBox: SsBox | null = null
  /** A new object per load, as the real one builds a new Layer 2 player. */
  internal: object | null = null
  disposed = false

  /** Animations the loaded pack has. `setAnimation` answers from it. */
  animations = ['Idle', 'Walk']
  /** Cellmaps the loaded pack has, which a bare `textures` source resolves against. */
  cellmaps = ['common']

  onAnimationFinished: ((animation: string) => void) | null = null
  onAnimationLooped: ((animation: string) => void) | null = null
  onAnimationStarted: ((animation: string) => void) | null = null
  onAnimationChanged: ((animation: string) => void) | null = null
  onUserData: ((event: SsUserDataEvent) => void) | null = null
  onAudio: ((event: SsAudioEvent) => void) | null = null
  onSignal: ((event: SsSignalEvent) => void) | null = null

  private readonly listeners = new Set<() => void>()
  /** Settles the pending `load`, for a test that needs one in flight. */
  private settleLoad: (() => void) | null = null

  constructor(options?: { textures?: unknown }) {
    SpriteStudioPlayer.created.push(this)
    this.record('constructor', options)
  }

  names(...only: string[]): string[] {
    const all = this.calls.map((call) => call.name)
    return only.length === 0 ? all : all.filter((name) => only.includes(name))
  }

  argsOf(name: string): unknown[][] {
    return this.calls.filter((call) => call.name === name).map((call) => call.args)
  }

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args })
  }

  private holding = SpriteStudioPlayer.holdLoads

  finishLoad(): void {
    this.settleLoad?.()
    this.settleLoad = null
  }

  async load(
    source: unknown,
    options?: { animation?: string; measure?: unknown }
  ): Promise<void> {
    this.record('load', source, options)
    if (this.holding) {
      this.holding = false
      await new Promise<void>((resolve) => (this.settleLoad = resolve))
    }
    this.isLoaded = true
    this.internal = {}
    this.currentAnimation = options?.animation ?? this.animations[0] ?? null
    this.notify()
  }

  setAnimation(name: string): boolean {
    this.record('setAnimation', name)
    // What a prop change arriving mid-load meets: no resource, so no switch.
    if (!this.isLoaded) return false
    this.currentAnimation = name
    return true
  }

  /** Track 0 renames from the call, as the real one does. */
  crossfade(track: number, name: string, durationMs: number): boolean {
    this.record('crossfade', track, name, durationMs)
    if (!this.isLoaded) return false
    if (track === 0) this.currentAnimation = name
    return true
  }

  play(startFrame?: number): void {
    this.record('play', startFrame)
    this.isPlaying = true
  }

  pause(): void {
    this.record('pause')
  }

  resume(): void {
    this.record('resume')
  }

  stop(): void {
    this.record('stop')
    this.isPlaying = false
  }

  advance(dtMilliseconds: number): void {
    this.record('advance', dtMilliseconds)
  }

  draw(canvas: { drawn?: unknown[] }): number {
    this.record('draw')
    canvas.drawn?.push(this)
    frameShown(this)
    return 0
  }

  setSpeedScale(rate: number): void {
    this.record('setSpeedScale', rate)
  }

  setLoopCount(loops: number): void {
    this.record('setLoopCount', loops)
  }

  /** Empty before a load, as the real one is. */
  cellmapNames(): string[] {
    return this.isLoaded ? [...this.cellmaps] : []
  }

  /** Refuses a name the loaded pack has no cellmap for, as the real one does. */
  setCellmapTexture(name: string, image: unknown): boolean {
    this.record('setCellmapTexture', name, image)
    return !this.isLoaded || image == null || this.cellmaps.includes(name)
  }

  setPartOverrides(overrides: SsPartOverrides): void {
    this.record('setPartOverrides', overrides)
  }

  setRootTransform(value: SsRootTransform): void {
    this.record('setRootTransform', value)
  }

  /** What a follower reads. Nothing resolves here; `useSsPartTransform` has its own test. */
  rootTransform: SsRootTransform | null = null
  getPartTransform(part: string | number): null {
    this.record('getPartTransform', part)
    return null
  }
  isPartSkinnedMesh(): boolean {
    return false
  }

  addListener(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Publishes a change the way a load or a measurement does. */
  notify(): void {
    for (const listener of this.listeners) listener()
    frameChanged(this)
  }

  dispose(): void {
    this.record('dispose')
    this.disposed = true
    this.listeners.clear()
  }
}
