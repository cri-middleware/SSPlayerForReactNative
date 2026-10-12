import { beforeEach, describe, expect, it } from 'vitest'

import { useFramePicture } from '../src/view/useFramePicture'
import { renderHook } from './support/render'
import { flushReactions, resetReactions } from './support/stubs/reanimated'
import { Skia, type StubPicture } from './support/stubs/skia'

beforeEach(resetReactions)

function recorded(): StubPicture {
  const recorder = Skia.PictureRecorder()
  recorder.beginRecording()
  return recorder.finishRecordingAsPicture()
}

describe('useFramePicture', () => {
  // Left to the collectors, a picture outlives its frame by as long as both
  // runtimes take to collect it, holding every vertex it recorded.
  it('disposes each picture once the canvas has moved past it', async () => {
    const harness = await renderHook(() => useFramePicture(), {})
    const picture = harness.result.current as unknown as { value: StubPicture }
    flushReactions()
    const empty = picture.value

    const first = recorded()
    picture.value = first
    flushReactions()
    expect(empty.disposed).toBe(true)
    expect(first.disposed).toBe(false)

    const second = recorded()
    picture.value = second
    flushReactions()
    expect(first.disposed).toBe(true)
    expect(second.disposed).toBe(false)
  })
})
