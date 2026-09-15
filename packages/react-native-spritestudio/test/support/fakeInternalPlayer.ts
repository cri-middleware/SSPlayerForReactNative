import {
  SS_ROOT_TRANSFORM_IDENTITY,
  SsPlaybackDirection,
  SsPlaybackStyle,
  type SsRootTransform,
} from '../../src/core/types'
import type {
  SsAudioEvent,
  SsBox,
  SsPartTransform,
  SsSignalEvent,
  SsTextureInfo,
  SsUserDataEvent,
} from '../../src/specs/SsRuntime.nitro'
import { live, type FakeResource } from './fakeRuntime'

const ABSENT_TRANSFORM: SsPartTransform = {
  valid: false,
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  determinant: 1,
}

/**
 * Stands in for Layer 2.
 *
 * Two things it does rather than merely record. **Playback state follows the
 * SDK's table** (`30_core/20_playback_control.md`): a pause is a hold, so
 * `isPlaying` stays true and `isPausing` is what tells the two apart — get that
 * wrong and the `playing` prop's resume-vs-restart branch cannot be tested at
 * all. And **`setupAnimation` answers from the pack**, so a name that is not in
 * it fails and leaves a reason behind, which is the whole of ForRN #78.
 *
 * Everything else is a field a test sets. Nothing here simulates the Brain:
 * frames do not advance and events do not fire on their own.
 */
export class SsInternalPlayer {
  /** Every one built in this test, newest last. */
  static readonly created: SsInternalPlayer[] = []

  static last(): SsInternalPlayer {
    const player = this.created[this.created.length - 1]
    if (player == null) throw new Error('no SsInternalPlayer has been built')
    return player
  }

  static reset(): void {
    this.created.length = 0
  }

  /** Every call Layer 3 made, in order — `setLoopCount` before `play` is an assertion. */
  readonly calls: Array<{ name: string; args: unknown[] }> = []

  readonly bound: FakeResource[] = []
  rootTransform: SsRootTransform = { ...SS_ROOT_TRANSFORM_IDENTITY }

  isPlaying = false
  isPausing = false
  isFinished = false
  isLooped = false
  isPlayingForward = true
  frameNo = 0
  fps = 30
  startFrame = 0
  endFrame = 0

  /** What `setupAnimation` reports when the name is not in the pack. */
  setupFailure: string | null = 'Animation not found'
  /** Part names in index order; `findPartIndex` answers from this. */
  parts: string[] = []
  readonly partTransforms = new Map<number, SsPartTransform>()
  readonly hiddenParts = new Set<number>()
  readonly skinnedParts = new Set<number>()

  passedEventCount = 0
  userDataEvents: SsUserDataEvent[] = []
  audioEvents: SsAudioEvent[] = []
  signalEvents: SsSignalEvent[] = []

  textureInfos: SsTextureInfo[] = []
  cellmaps: Record<string, string[]> = {}

  isDisposed = false
  private lastError: string | null = null
  private setUpAnimation: string | null = null

  constructor(
    readonly resource: FakeResource,
    readonly textures: { dispose(): void; size: number }
  ) {
    SsInternalPlayer.created.push(this)
    live.contexts.add(this)
    this.textureInfos = [...resource.pack.textures]
    this.contentBox = resource.pack.contentBox
  }

  /** The call names in order, optionally only the ones named. */
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

  // --- lifecycle ---------------------------------------------------------

  bindInstancePack(pack: FakeResource): boolean {
    this.record('bindInstancePack', pack.uri)
    this.bound.push(pack)
    return true
  }

  getAnimationNames(): string[] {
    return [...this.resource.pack.animations]
  }

  get currentAnimation(): string | null {
    return this.setUpAnimation
  }

  setupAnimation(name: string): boolean {
    this.record('setupAnimation', name)
    if (!this.resource.pack.animations.includes(name)) {
      this.lastError = this.setupFailure
      return false
    }
    this.setUpAnimation = name
    this.lastError = null
    return true
  }

  get lastErrorMessage(): string | null {
    return this.lastError
  }

  dispose(): void {
    this.record('dispose')
    this.isDisposed = true
    live.contexts.delete(this)
  }

  // --- transport ---------------------------------------------------------
  //
  // The SDK's state table: play heads out, pause holds (still "playing"),
  // resume lifts the hold, stop ends it.

  play(startFrame?: number): void {
    this.record('play', startFrame)
    this.isPlaying = true
    this.isPausing = false
    this.isFinished = false
    this.frameNo = startFrame ?? 0
  }

  pause(): void {
    this.record('pause')
    if (this.isPlaying) this.isPausing = true
  }

  resume(): void {
    this.record('resume')
    this.isPausing = false
  }

  stop(): void {
    this.record('stop')
    this.isPlaying = false
    this.isPausing = false
  }

  seek(frameNo: number): void {
    this.record('seek', frameNo)
    this.frameNo = frameNo
  }

  advance(dtMilliseconds: number): number {
    this.record('advance', dtMilliseconds)
    return 0
  }

  draw(canvas: { drawn?: unknown[] }): number {
    this.record('draw')
    canvas.drawn?.push(this)
    return 0
  }

  // --- settings ----------------------------------------------------------

  speedScale = 1
  loopCount = 0
  frameSkipEnabled = true
  subFrameEnabled = true
  playbackDirection: SsPlaybackDirection = SsPlaybackDirection.forward
  playbackStyle: SsPlaybackStyle = SsPlaybackStyle.normal

  setSpeedScale(rate: number): void {
    this.record('setSpeedScale', rate)
    this.speedScale = rate
  }

  setLoopCount(loops: number): void {
    this.record('setLoopCount', loops)
    this.loopCount = loops
  }

  setFrameSkipEnabled(skip: boolean): void {
    this.record('setFrameSkipEnabled', skip)
    this.frameSkipEnabled = skip
  }

  setSubFrameEnabled(enabled: boolean): void {
    this.record('setSubFrameEnabled', enabled)
    this.subFrameEnabled = enabled
  }

  setFrameRate(fps: number): void {
    this.record('setFrameRate', fps)
    this.fps = fps
  }

  setPlaybackDirection(
    direction: SsPlaybackDirection,
    style: SsPlaybackStyle
  ): void {
    this.record('setPlaybackDirection', direction, style)
    this.playbackDirection = direction
    this.playbackStyle = style
  }

  setSection(startFrame: number, endFrame: number): void {
    this.record('setSection', startFrame, endFrame)
    this.startFrame = startFrame
    this.endFrame = endFrame
  }

  get partCount(): number {
    return this.parts.length
  }

  get totalFrames(): number {
    return this.endFrame - this.startFrame + 1
  }

  // --- parts -------------------------------------------------------------

  findPartIndex(partName: string): number {
    return this.parts.indexOf(partName)
  }

  getPartTransform(partIndex: number): SsPartTransform {
    return this.partTransforms.get(partIndex) ?? ABSENT_TRANSFORM
  }

  isPartHidden(partIndex: number): boolean {
    return this.hiddenParts.has(partIndex)
  }

  isPartSkinnedMesh(partIndex: number): boolean {
    return this.skinnedParts.has(partIndex)
  }

  setPartVisibility(partIndex: number, force: number, cascade = false): boolean {
    this.record('setPartVisibility', partIndex, force, cascade)
    return true
  }

  clearPartVisibility(partIndex: number): boolean {
    this.record('clearPartVisibility', partIndex)
    return true
  }

  setPartColor(
    partIndex: number,
    blendOp: number,
    rgba: number,
    priority = 2
  ): boolean {
    this.record('setPartColor', partIndex, blendOp, rgba, priority)
    return true
  }

  clearPartColor(partIndex: number): boolean {
    this.record('clearPartColor', partIndex)
    return true
  }

  setPartCell(
    partIndex: number,
    cellmapNameHash: number,
    cellNameHash: number,
    priority = 2
  ): boolean {
    this.record('setPartCell', partIndex, cellmapNameHash, cellNameHash, priority)
    return true
  }

  clearPartCell(partIndex: number): boolean {
    this.record('clearPartCell', partIndex)
    return true
  }

  clearPartOverrides(): boolean {
    this.record('clearPartOverrides')
    return true
  }

  partNames(): string[] {
    return [...this.parts]
  }

  cellmapNames(): string[] {
    return Object.keys(this.cellmaps)
  }

  cellNames(cellmapName: string): string[] {
    return [...(this.cellmaps[cellmapName] ?? [])]
  }

  // --- the rest ----------------------------------------------------------

  /** What `measureContentBox` hands back — the pack's, until a test says otherwise. */
  contentBox: SsBox

  measureContentBox(animations: string[], maxFrames = 0): SsBox {
    this.record('measureContentBox', animations, maxFrames)
    return this.contentBox
  }

  getTextures(): SsTextureInfo[] {
    return [...this.textureInfos]
  }

  getUserDataEvents(): SsUserDataEvent[] {
    this.record('getUserDataEvents')
    return this.userDataEvents
  }

  getAudioEvents(): SsAudioEvent[] {
    this.record('getAudioEvents')
    return this.audioEvents
  }

  getSignalEvents(): SsSignalEvent[] {
    this.record('getSignalEvents')
    return this.signalEvents
  }
}
