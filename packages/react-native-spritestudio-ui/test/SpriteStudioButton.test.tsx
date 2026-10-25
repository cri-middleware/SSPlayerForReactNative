import { createRef } from 'react'
import type { SpriteStudioViewRef } from 'react-native-spritestudio'
import type { ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SpriteStudioButton } from '../src/SpriteStudioButton'
import { FakePlayer } from './support/fakePlayer'
import { act, findHosts, render } from './support/render'
import { reduceMotion } from './support/stubs/react-native'
import { viewState } from './support/stubs/spritestudio'

const PACK = 'ss/ui/Button.ssab'

beforeEach(() => {
  viewState.player = new FakePlayer()
  viewState.props = null
  viewState.ready = true
  reduceMotion.reset()
})

function pressable(renderer: ReactTestRenderer): Record<string, (...args: unknown[]) => unknown> {
  return findHosts(renderer, 'Pressable')[0]?.props as Record<string, (...args: unknown[]) => unknown>
}

function region(renderer: ReactTestRenderer): Record<string, unknown> {
  return findHosts(renderer, 'View')[0]?.props ?? {}
}

async function fire(renderer: ReactTestRenderer, handler: string): Promise<void> {
  await act(async () => {
    pressable(renderer)[handler]?.({})
  })
}

function sections(): unknown[] {
  return viewState.player.calls.filter(([name]) => name === 'setAnimationSection')
}

describe('the view', () => {
  it('gets the view’s props, and is never played by them', async () => {
    await render(
      <SpriteStudioButton source={PACK} animation="button" fit="cover" onPress={() => {}} />
    )

    expect(viewState.props).toMatchObject({ source: PACK, animation: 'button', fit: 'cover', playing: false })
    expect(viewState.props).not.toHaveProperty('onPress')
  })

  it('hands out the view’s player through the ref', async () => {
    const ref = createRef<SpriteStudioViewRef>()
    await render(<SpriteStudioButton ref={ref} source={PACK} />)

    expect(ref.current?.player as unknown).toBe(viewState.player)
  })
})

describe('the states', () => {
  it('shows normal, then each state the press, hover and focus callbacks raise', async () => {
    const onPressIn = vi.fn()
    const { renderer } = await render(<SpriteStudioButton source={PACK} onPressIn={onPressIn} />)
    expect(sections()).toEqual([['setAnimationSection', 0, 19]])

    await fire(renderer, 'onHoverIn')
    await fire(renderer, 'onPressIn')
    await fire(renderer, 'onPressOut')
    await fire(renderer, 'onHoverOut')
    await fire(renderer, 'onFocus')
    await fire(renderer, 'onBlur')

    expect(sections()).toEqual([
      ['setAnimationSection', 0, 19],
      ['setAnimationSection', 20, 39],
      ['setAnimationSection', 40, 59],
      ['setAnimationSection', 20, 39],
      ['setAnimationSection', 0, 19],
      ['setAnimationSection', 0, 19],
      ['setAnimationSection', 0, 19],
    ])
    expect(onPressIn).toHaveBeenCalledOnce()
  })

  it('shows disabled over a press, and drops the press when disabled', async () => {
    const { renderer, update } = await render(<SpriteStudioButton source={PACK} />)
    await fire(renderer, 'onPressIn')

    await update(<SpriteStudioButton source={PACK} disabled />)
    expect(sections().at(-1)).toEqual(['setAnimationSection', 60, 79])
    expect(pressable(renderer).disabled).toBe(true)

    await update(<SpriteStudioButton source={PACK} />)
    expect(sections().at(-1)).toEqual(['setAnimationSection', 0, 19])
  })

  it('shows the state again once the player loads another pack', async () => {
    await render(<SpriteStudioButton source={PACK} />)
    viewState.player.calls.length = 0

    await act(async () => viewState.player.reload())

    expect(sections()).toEqual([['setAnimationSection', 0, 19]])
  })

  it('plays nothing until the view is drawable', async () => {
    viewState.ready = false
    await render(<SpriteStudioButton source={PACK} />)

    expect(viewState.player.calls).toEqual([])
  })
})

describe('reduced motion', () => {
  it('holds each state when asked to', async () => {
    const { renderer } = await render(<SpriteStudioButton source={PACK} reducedMotion />)
    await fire(renderer, 'onPressIn')

    expect(viewState.player.names().filter((name) => name === 'play' || name === 'stop')).toEqual([
      'play',
      'stop',
    ])
    expect(sections()).toEqual([
      ['setAnimationSection', 80, 99],
      ['setAnimationSection', 40, 59],
    ])
  })

  it('follows the system setting when not asked, and shows nothing before it is known', async () => {
    reduceMotion.enabled = true
    let resolve: (value: boolean) => void = () => {}
    const pending = new Promise<boolean>((r) => (resolve = r))
    const { AccessibilityInfo } = await import('./support/stubs/react-native')
    vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(pending)

    await render(<SpriteStudioButton source={PACK} />)
    expect(viewState.player.calls).toEqual([])

    await act(async () => resolve(true))
    expect(viewState.player.names().at(-1)).toBe('play')
    expect(sections().at(-1)).toEqual(['setAnimationSection', 80, 99])

    await act(async () => reduceMotion.set(false))
    expect(sections().at(-1)).toEqual(['setAnimationSection', 0, 19])
  })

  it('stops listening to the system setting on unmount', async () => {
    const { unmount } = await render(<SpriteStudioButton source={PACK} />)
    expect(reduceMotion.listeners.size).toBe(1)

    await unmount()

    expect(reduceMotion.listeners.size).toBe(0)
  })
})

describe('the pressable area', () => {
  it('is the whole box unless parts are named', async () => {
    const { renderer } = await render(<SpriteStudioButton source={PACK} />)

    expect(region(renderer).onStartShouldSetResponderCapture).toBeUndefined()
  })

  it('refuses a touch that starts on none of the parts named', async () => {
    const { renderer } = await render(<SpriteStudioButton source={PACK} hitParts={['face']} />)
    const capture = region(renderer).onStartShouldSetResponderCapture as (event: unknown) => boolean
    const touch = { nativeEvent: { locationX: 12, locationY: 34 } }

    expect(capture(touch)).toBe(true)
    viewState.player.hits = 3
    expect(capture(touch)).toBe(false)
    expect(viewState.player.calls.filter(([name]) => name === 'hitTestPart')).toEqual([
      ['hitTestPart', 12, 34, ['face']],
      ['hitTestPart', 12, 34, ['face']],
    ])
  })

  it('tests every part on hitOnArtwork', async () => {
    const { renderer } = await render(<SpriteStudioButton source={PACK} hitOnArtwork />)
    const capture = region(renderer).onStartShouldSetResponderCapture as (event: unknown) => boolean

    capture({ nativeEvent: { locationX: 1, locationY: 2 } })

    expect(viewState.player.calls.at(-1)).toEqual(['hitTestPart', 1, 2, undefined])
  })
})

describe('screen readers', () => {
  it('see decoration when the button has no label', async () => {
    const { renderer } = await render(<SpriteStudioButton source={PACK} />)

    expect(pressable(renderer)).toMatchObject({
      accessible: false,
      importantForAccessibility: 'no-hide-descendants',
    })
  })

  it('read a button with the label it is given', async () => {
    const { renderer } = await render(<SpriteStudioButton source={PACK} accessibilityLabel="Start" />)

    expect(pressable(renderer)).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'Start' })
    expect(pressable(renderer)).not.toHaveProperty('accessible', false)
  })
})
