import {
  SS_ROOT_TRANSFORM_IDENTITY,
  SsPlaybackDirection,
  SsPlaybackStyle,
  type SsRootTransform,
} from '../../src/core/types'
import type {
  SsAudioEvent,
  SsBox,
  SsLabelTable,
  SsPartQuad,
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
 * SDK's table**: a pause is a hold, so
 * `isPlaying` stays true and `isPausing` is what tells the two apart — get that
 * wrong and the `playing` prop's resume-vs-restart branch cannot be tested at
 * all. And **`setupAnimation` answers from the pack**, so a name that is not in
 * it fails and leaves a reason behind.
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
  justLooped = false
  isPlayingForward = true
  /** What `needsDraw` answers; a test sets it false to stand for an unchanged frame. */
  needsDraw = true
  /** Whether the pack has an effect or instance part, which a pause leaves running. */
  hasOwnClocks = true

  /** The real one's rule: playing, and not paused unless something keeps its own clock. */
  get advances(): boolean {
    return this.isPlaying && (!this.isPausing || this.hasOwnClocks)
  }
  frameNo = 0
  frameRate = 30
  startFrame = 0
  endFrame = 0

  /** What `setupAnimation` reports when the name is not in the pack. */
  setupFailure: string | null = 'Animation not found'
  /** Part names in index order; `findPartIndex` answers from this. */
  parts: string[] = []
  readonly partTransforms = new Map<number, SsPartTransform>()
  readonly partQuads = new Map<number, SsPartQuad>()
  hitPart = -1
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
    // The Brain forgets what the last update reported.
    this.justLooped = false
    this.isFinished = false
    this.passedEventCount = 0
    this.userDataEvents = []
    this.audioEvents = []
    this.signalEvents = []
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
    this.frameRate = fps
  }

  setPlaybackDirection(
    direction: SsPlaybackDirection,
    style: SsPlaybackStyle
  ): void {
    this.record('setPlaybackDirection', direction, style)
    this.playbackDirection = direction
    this.playbackStyle = style
  }

  /** Refuses an end before the start, as the real one does when both are inside the animation. */
  setSection(startFrame: number, endFrame: number): boolean {
    this.record('setSection', startFrame, endFrame)
    if (startFrame >= 0 && endFrame >= 0 && endFrame < startFrame) {
      this.lastError = 'Invalid parameter'
      return false
    }
    this.lastError = null
    this.startFrame = startFrame
    this.endFrame = endFrame
    return true
  }

  get partCount(): number {
    return this.parts.length
  }

  get totalFrames(): number {
    return this.endFrame - this.startFrame + 1
  }

  // --- parts -------------------------------------------------------------

  findPartIndex(partName: string): number {
    this.record('findPartIndex', partName)
    return this.parts.indexOf(partName)
  }

  getPartTransform(partIndex: number): SsPartTransform {
    return this.partTransforms.get(partIndex) ?? ABSENT_TRANSFORM
  }

  getPartQuad(partIndex: number): SsPartQuad {
    return (
      this.partQuads.get(partIndex) ?? {
        valid: false,
        leftTopX: 0,
        leftTopY: 0,
        rightTopX: 0,
        rightTopY: 0,
        leftBottomX: 0,
        leftBottomY: 0,
        rightBottomX: 0,
        rightBottomY: 0,
      }
    )
  }

  hitTestPart(x: number, y: number, parts: number[]): number {
    this.record('hitTestPart', x, y, parts)
    return this.hitPart
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

  labelTables: Record<string, Omit<SsLabelTable, 'valid'>> = {}

  getLabelTable(animationName: string): SsLabelTable {
    if (!this.resource.pack.animations.includes(animationName)) {
      return { valid: false, startFrame: 0, endFrame: 0, labels: [] }
    }
    const table = this.labelTables[animationName] ?? { startFrame: 0, endFrame: 0, labels: [] }
    return { valid: true, ...table, labels: [...table.labels] }
  }

  // --- the rest ----------------------------------------------------------

  /** What `measureContentBox` hands back — the pack's, until a test says otherwise. */
  contentBox: SsBox

  measureContentBox(animations: string[], maxFrames = 0): SsBox {
    this.record('measureContentBox', animations, maxFrames)
    return this.contentBox
  }

  /** What `canvasBox` hands back. Zero-sized — no animation set up — until a test says otherwise. */
  canvas: SsBox = { x: 0, y: 0, width: 0, height: 0 }

  canvasBox(): SsBox {
    return this.canvas
  }

  getTextures(): SsTextureInfo[] {
    return [...this.textureInfos]
  }

  /** Placeholder bytes for any hash: the loader asks only after `embeddedLength` said there are some. */
  copyEmbeddedTexture(textureHash: number): ArrayBuffer {
    this.record('copyEmbeddedTexture', textureHash)
    return new Uint8Array([1, 2, 3]).buffer as ArrayBuffer
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

  // --- the track stack ---------------------------------------------------
  //
  // A ledger, not a mixer: which animation each track holds and the settings it
  // was given, answering with the C API's sentinels. Track 0 switches the way
  // the real Layer 2 does — `currentAnimation` follows it from the call. Pulses
  // and finishing are fields a test sets.

  /** The animation on each track; track 0's is `currentAnimation`. */
  readonly trackAnimations = new Map<number, string>()
  readonly trackSettings = new Map<number, Record<string, number | boolean>>()
  readonly finishedTracks = new Set<number>()
  readonly loopedTracks = new Set<number>()

  get trackCount(): number {
    if (this.setUpAnimation == null) return 0
    return Math.max(1, ...[...this.trackAnimations.keys(), ...this.trackSettings.keys()].map((t) => t + 1))
  }

  private lay(call: string, track: number, name: string, ...rest: unknown[]): boolean {
    this.record(call, track, name, ...rest)
    if (this.setUpAnimation == null || !this.resource.pack.animations.includes(name)) {
      this.lastError = this.setupFailure
      return false
    }
    this.lastError = null
    if (track === 0) this.setUpAnimation = name
    else this.trackAnimations.set(track, name)
    return true
  }

  private setting(call: string, track: number, key: string, value: number | boolean): boolean {
    this.record(call, track, value)
    if (this.setUpAnimation == null) {
      this.lastError = 'SSAB data is not loaded'
      return false
    }
    this.lastError = null
    const settings = this.trackSettings.get(track) ?? {}
    settings[key] = value
    this.trackSettings.set(track, settings)
    return true
  }

  private read(track: number, key: string, absent: number): number {
    if (track >= this.trackCount) return absent
    const value = this.trackSettings.get(track)?.[key]
    return typeof value === 'number' ? value : absent
  }

  setTrackAnimation(track: number, name: string): boolean {
    return this.lay('setTrackAnimation', track, name)
  }
  crossfade(track: number, name: string, durationMs: number): boolean {
    return this.lay('crossfade', track, name, durationMs)
  }
  clearTrack(track: number): boolean {
    this.record('clearTrack', track)
    if (track === 0) {
      this.lastError = 'Invalid parameter'
      return false
    }
    return this.trackAnimations.delete(track)
  }
  fadeTrack(track: number, targetAlpha: number, durationMs: number): boolean {
    this.record('fadeTrack', track, targetAlpha, durationMs)
    return track < this.trackCount
  }
  getTrackFadeProgress(_track: number): number {
    return NaN
  }
  cancelTrackFade(track: number): boolean {
    this.record('cancelTrackFade', track)
    return track < this.trackCount
  }
  setTrackAlpha(track: number, alpha: number): boolean {
    if (track >= this.trackCount) {
      this.record('setTrackAlpha', track, alpha)
      this.lastError = 'Invalid parameter'
      return false
    }
    return this.setting('setTrackAlpha', track, 'alpha', alpha)
  }
  getTrackAlpha(track: number): number {
    return this.read(track, 'alpha', NaN)
  }
  setTrackBlend(track: number, blend: number): boolean {
    return this.setting('setTrackBlend', track, 'blend', blend)
  }
  getTrackBlend(track: number): number {
    return this.read(track, 'blend', -1)
  }
  setTrackSync(track: number, sync: number): boolean {
    return this.setting('setTrackSync', track, 'sync', sync)
  }
  getTrackSync(track: number): number {
    return this.read(track, 'sync', -1)
  }
  setTrackFrame(track: number, frameNo: number): boolean {
    return this.setting('setTrackFrame', track, 'frame', frameNo)
  }
  getTrackFrame(track: number): number {
    return this.read(track, 'frame', NaN)
  }
  setTrackSpeed(track: number, speed: number): boolean {
    return this.setting('setTrackSpeed', track, 'speed', speed)
  }
  getTrackSpeed(track: number): number {
    return this.read(track, 'speed', NaN)
  }
  setTrackFrameRate(track: number, fps: number): boolean {
    return this.setting('setTrackFrameRate', track, 'frameRate', fps)
  }
  getTrackFrameRate(track: number): number {
    return this.read(track, 'frameRate', -1)
  }
  setTrackSkipFrames(track: number, skip: boolean): boolean {
    return this.setting('setTrackSkipFrames', track, 'skip', skip)
  }
  getTrackSkipFrames(track: number): boolean {
    return this.trackSettings.get(track)?.skip === true
  }
  setTrackPlaybackDirection(track: number, direction: number, style: number): boolean {
    this.setting('setTrackPlaybackDirection', track, 'style', style)
    return this.setting('setTrackPlaybackDirection', track, 'direction', direction)
  }
  getTrackPlaybackDirection(track: number): number {
    return this.read(track, 'direction', -1)
  }
  getTrackPlaybackStyle(track: number): number {
    return this.read(track, 'style', -1)
  }
  setTrackLoopCount(track: number, loops: number): boolean {
    return this.setting('setTrackLoopCount', track, 'loops', loops)
  }
  getTrackLoopCount(track: number): number {
    return this.read(track, 'loops', 0)
  }
  isTrackFinished(track: number): boolean {
    return this.finishedTracks.has(track)
  }
  trackJustLooped(track: number): boolean {
    return this.loopedTracks.has(track)
  }
  setTrackOutgoingEventThreshold(track: number, threshold: number): boolean {
    return this.setting('setTrackOutgoingEventThreshold', track, 'outgoing', threshold)
  }
  getTrackOutgoingEventThreshold(track: number): number {
    return this.read(track, 'outgoing', NaN)
  }
  getTrackMainSource(track: number): number {
    if (track === 0) return this.setUpAnimation == null ? -1 : 0
    return this.trackAnimations.has(track) ? track : -1
  }
  addTrackSource(track: number, name: string, weight: number): number {
    return this.lay('addTrackSource', track, name, weight) ? 100 + track : -1
  }
  setSourceWeight(source: number, weight: number): boolean {
    this.record('setSourceWeight', source, weight)
    return source >= 100
  }
  getSourceWeight(source: number): number {
    return source >= 100 ? 1 : NaN
  }
  setSourceFrame(source: number, frameNo: number): boolean {
    this.record('setSourceFrame', source, frameNo)
    return source >= 100
  }
  getSourceFrame(source: number): number {
    return source >= 100 ? 0 : NaN
  }
  setSourceEventThreshold(source: number, threshold: number): boolean {
    this.record('setSourceEventThreshold', source, threshold)
    return source >= 100
  }
  getSourceEventThreshold(source: number): number {
    return source >= 100 ? Infinity : NaN
  }
}
