import type { SsLabelTable } from 'react-native-spritestudio'

function table(endFrame: number, labels: Record<string, number>): SsLabelTable {
  const list = Object.entries(labels)
    .map(([name, frame]) => ({ name, frame }))
    .sort((a, b) => a.frame - b.frame)
  return { valid: true, labels: list, startFrame: 0, endFrame }
}

export const TABLES: Record<string, SsLabelTable> = {
  button: table(99, { normal: 0, hover: 20, pressed: 40, disabled: 60, reduced_motion: 80 }),
  only_normal: table(49, { normal: 10, other: 30 }),
  with_hover: table(49, { normal: 0, hover: 25 }),
  plain: table(29, {}),
  glow: table(39, { calm: 5 }),
  calm_only: table(59, { pressed: 20, reduced_motion: 40 }),
  caps: table(9, { Normal: 0, HOVER: 5 }),
}

/** The calls a driver makes, against the label tables above. */
export class FakePlayer {
  readonly calls: Array<[string, ...unknown[]]> = []
  internal: object | null = {}
  currentAnimation: string | null
  hits = -1
  private readonly listeners = new Set<() => void>()

  constructor(animation: string | null = 'button') {
    this.currentAnimation = animation
  }

  getAnimationNames(): string[] {
    return this.internal == null ? [] : Object.keys(TABLES)
  }

  getLabelTable(animation?: string): SsLabelTable | null {
    const name = animation ?? this.currentAnimation
    return name == null ? null : (TABLES[name] ?? null)
  }

  setAnimation(name: string): boolean {
    this.calls.push(['setAnimation', name])
    if (!(name in TABLES)) return false
    if (this.currentAnimation !== name) {
      this.currentAnimation = name
      this.notify()
    }
    return true
  }

  setAnimationSection(start: number, end: number): boolean {
    this.calls.push(['setAnimationSection', start, end])
    this.notify()
    return true
  }

  setLoopCount(loops: number): void {
    this.calls.push(['setLoopCount', loops])
  }

  play(): void {
    this.calls.push(['play'])
    this.notify()
  }

  stop(): void {
    this.calls.push(['stop'])
    this.notify()
  }

  hitTestPart(x: number, y: number, parts?: ReadonlyArray<string | number>): number {
    this.calls.push(['hitTestPart', x, y, parts])
    return this.hits
  }

  addListener(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  notify(): void {
    for (const listener of this.listeners) listener()
  }

  reload(): void {
    this.internal = {}
    this.notify()
  }

  names(): string[] {
    return this.calls.map(([name]) => name)
  }
}
