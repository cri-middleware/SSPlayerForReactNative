import { describe, expect, it, vi } from 'vitest'
import type { SpriteStudioPlayer } from 'react-native-spritestudio'

import {
  SsUiStateDriver,
  resolveUiSection,
  ssUiStateOf,
  type SsUiClips,
  type SsUiState,
} from '../src/uiState'
import { FakePlayer, TABLES } from './support/fakePlayer'

function resolve(
  state: SsUiState,
  animation: string,
  options: { clips?: SsUiClips; reducedMotion?: boolean; missing?: string[] } = {}
): [string, number, number, boolean] | null {
  const section = resolveUiSection(state, {
    animation,
    tableOf: (name) => TABLES[name] ?? null,
    clips: options.clips,
    reducedMotion: options.reducedMotion,
    onMissingClip: (s, clip) => options.missing?.push(`${s}:${JSON.stringify(clip)}`),
  })
  return section && [section.animation, section.startFrame, section.endFrame, section.hold]
}

describe('the UI state rule', () => {
  it('lets one state win: disabled, pressed, hover, focused, normal', () => {
    expect(ssUiStateOf({ disabled: true, pressed: true, hovered: true, focused: true })).toBe('disabled')
    expect(ssUiStateOf({ pressed: true, hovered: true, focused: true })).toBe('pressed')
    expect(ssUiStateOf({ hovered: true, focused: true })).toBe('hover')
    expect(ssUiStateOf({ focused: true })).toBe('focused')
    expect(ssUiStateOf({})).toBe('normal')
  })

  it('runs each state from its label to the frame before the next, the last to the end', () => {
    expect(resolve('normal', 'button')).toEqual(['button', 0, 19, false])
    expect(resolve('hover', 'button')).toEqual(['button', 20, 39, false])
    expect(resolve('pressed', 'button')).toEqual(['button', 40, 59, false])
    expect(resolve('disabled', 'button')).toEqual(['button', 60, 79, false])
    expect(resolve('hover', 'with_hover')).toEqual(['with_hover', 25, 49, false])
  })

  it('ends a section at any next label, not only a state’s', () => {
    expect(resolve('normal', 'only_normal')).toEqual(['only_normal', 10, 29, false])
  })

  it('falls a state without a label back: pressed to hover then normal, the rest to normal', () => {
    for (const state of ['hover', 'focused', 'disabled', 'pressed'] as const) {
      expect(resolve(state, 'only_normal'), state).toEqual(['only_normal', 10, 29, false])
    }
    expect(resolve('pressed', 'with_hover')).toEqual(['with_hover', 25, 49, false])
    expect(resolve('focused', 'button')).toEqual(['button', 0, 19, false])
  })

  it('plays the whole animation with no normal either', () => {
    expect(resolve('hover', 'plain')).toEqual(['plain', 0, 29, false])
  })

  it('matches labels exactly', () => {
    expect(resolve('hover', 'caps')).toEqual(['caps', 0, 9, false])
  })

  it('lets a clip replace a state, and the states that fall back to it', () => {
    const clips: SsUiClips = {
      hover: { animation: 'glow' },
      disabled: { label: 'reduced_motion' },
      focused: { animation: 'glow', label: 'calm' },
    }
    expect(resolve('hover', 'button', { clips })).toEqual(['glow', 0, 39, false])
    expect(resolve('pressed', 'only_normal', { clips })).toEqual(['glow', 0, 39, false])
    expect(resolve('disabled', 'button', { clips })).toEqual(['button', 80, 99, false])
    expect(resolve('focused', 'button', { clips })).toEqual(['glow', 5, 39, false])
  })

  it('treats a clip the pack does not have as absent, and says which', () => {
    const missing: string[] = []
    const clips: SsUiClips = { hover: { animation: 'nope' }, pressed: { label: 'nope' } }

    expect(resolve('hover', 'button', { clips, missing })).toEqual(['button', 20, 39, false])
    expect(resolve('pressed', 'button', { clips, missing })).toEqual(['button', 40, 59, false])
    expect(missing).toEqual(['hover:{"animation":"nope"}', 'pressed:{"label":"nope"}'])
  })

  it('holds each state under reduced motion, and plays reduced_motion for normal', () => {
    expect(resolve('hover', 'button', { reducedMotion: true })).toEqual(['button', 20, 39, true])
    expect(resolve('normal', 'button', { reducedMotion: true })).toEqual(['button', 80, 99, false])
    expect(resolve('focused', 'button', { reducedMotion: true })).toEqual(['button', 80, 99, false])
    expect(resolve('normal', 'with_hover', { reducedMotion: true })).toEqual(['with_hover', 0, 24, true])
  })

  it('plays reduced_motion where normal falls back to the whole animation', () => {
    expect(resolve('normal', 'calm_only', { reducedMotion: true })).toEqual(['calm_only', 40, 59, false])
    expect(resolve('hover', 'calm_only', { reducedMotion: true })).toEqual(['calm_only', 40, 59, false])
    // A state with a label of its own still holds it.
    expect(resolve('pressed', 'calm_only', { reducedMotion: true })).toEqual(['calm_only', 20, 39, true])
  })

  it('knows no section for an animation the pack does not have', () => {
    expect(resolve('normal', 'nope')).toBeNull()
  })
})

function driverOf(
  player: FakePlayer,
  options?: { animation?: string; clips?: SsUiClips }
): SsUiStateDriver {
  return new SsUiStateDriver(player as unknown as SpriteStudioPlayer, options)
}

describe('SsUiStateDriver', () => {
  it('plays a state’s section from its first frame, looping', () => {
    const player = new FakePlayer()
    driverOf(player).show('hover')

    expect(player.calls).toEqual([
      ['setAnimation', 'button'],
      ['setAnimationSection', 20, 39],
      ['setLoopCount', 0],
      ['play'],
    ])
  })

  it('stops on the section’s first frame under reduced motion', () => {
    const player = new FakePlayer()
    driverOf(player).show('pressed', true)

    expect(player.calls).toEqual([
      ['setAnimation', 'button'],
      ['setAnimationSection', 40, 59],
      ['stop'],
    ])
  })

  it('does nothing for the state it shows, and shows it again after a load', () => {
    const player = new FakePlayer()
    const driver = driverOf(player)
    driver.show('hover')
    player.calls.length = 0

    driver.show('hover')
    expect(player.calls).toEqual([])

    player.reload()
    driver.show('hover')
    expect(player.names()).toEqual(['setAnimation', 'setAnimationSection', 'setLoopCount', 'play'])
  })

  it('shows the state again when another hand switched the animation', () => {
    const player = new FakePlayer()
    const driver = driverOf(player)
    driver.show('normal')
    player.currentAnimation = 'plain'
    player.calls.length = 0

    driver.show('normal')

    expect(player.calls[0]).toEqual(['setAnimation', 'button'])
  })

  it('reads the labels from the animation it is given, or the player’s own', () => {
    const named = new FakePlayer()
    driverOf(named, { animation: 'with_hover' }).show('hover')
    expect(named.calls[1]).toEqual(['setAnimationSection', 25, 49])

    const own = new FakePlayer('only_normal')
    driverOf(own).show('hover')
    expect(own.calls[1]).toEqual(['setAnimationSection', 10, 29])
  })

  it('plays a clip of another animation, and keeps reading the states from its own', () => {
    const player = new FakePlayer()
    const driver = driverOf(player, { clips: { hover: { animation: 'glow' } } })

    driver.show('hover')
    driver.show('pressed')
    driver.show('disabled')

    expect(player.calls.filter(([name]) => name !== 'setLoopCount' && name !== 'play')).toEqual([
      ['setAnimation', 'glow'],
      ['setAnimationSection', 0, 39],
      ['setAnimation', 'button'],
      ['setAnimationSection', 40, 59],
      ['setAnimation', 'button'],
      ['setAnimationSection', 60, 79],
    ])
  })

  it('says once that a clip names what the pack does not have', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = new FakePlayer()
    const driver = driverOf(player, { clips: { hover: { label: 'over' } } })

    driver.show('hover')
    driver.show('normal')
    driver.show('hover')

    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain("label 'over'")
  })

  it('shows nothing before a load', () => {
    const player = new FakePlayer()
    player.internal = null

    driverOf(player).show('hover')

    expect(player.calls).toEqual([])
  })
})
