import { beforeEach, describe, expect, it } from 'vitest'

import { useFramePicture, type SsFramePicture } from '../src/view/useFramePicture'
import { renderHook } from './support/render'
import { flushReactions, resetReactions } from './support/stubs/reanimated'
import { Skia, type StubPicture } from './support/stubs/skia'

beforeEach(resetReactions)

function recorded(): StubPicture {
  const recorder = Skia.PictureRecorder()
  recorder.beginRecording()
  return recorder.finishRecordingAsPicture()
}

async function framePicture(): Promise<SsFramePicture> {
  const harness = await renderHook(() => useFramePicture(), {})
  flushReactions()
  return harness.result.current
}

const publish = (frame: SsFramePicture, picture: StubPicture): void =>
  frame.publish(picture as never)

describe('useFramePicture', () => {
  // Left to the collectors, a picture outlives its frame by as long as both
  // runtimes take to collect it, holding every vertex it recorded.
  it('disposes each picture once the canvas has moved past it', async () => {
    const frame = await framePicture()
    const empty = frame.picture.value as unknown as StubPicture

    const first = recorded()
    publish(frame, first)
    flushReactions()
    expect(empty.disposed).toBe(true)
    expect(first.disposed).toBe(false)
    expect(frame.picture.value).toBe(first)

    const second = recorded()
    publish(frame, second)
    flushReactions()
    expect(first.disposed).toBe(true)
    expect(second.disposed).toBe(false)
  })

  // Two pictures published between the UI thread's turns reach it as the
  // second alone; the first must not be left to the collectors.
  it('disposes a picture the UI thread never saw', async () => {
    const frame = await framePicture()
    const first = recorded()
    const skipped = recorded()
    const latest = recorded()

    publish(frame, first)
    flushReactions()
    publish(frame, skipped)
    publish(frame, latest)
    flushReactions()

    expect(first.disposed).toBe(true)
    expect(skipped.disposed).toBe(true)
    expect(latest.disposed).toBe(false)
  })
})
