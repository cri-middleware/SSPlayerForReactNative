import { Skia, type SkPicture } from 'react-native-skia'
import { useCallback, useMemo, useRef } from 'react'
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

export interface SsFramePicture {
  /** What the canvas draws. Seeded with an empty recording, since `<Picture>` has no null state. */
  picture: SharedValue<SkPicture>
  /** Hands the canvas a new picture. */
  publish(picture: SkPicture): void
}

/**
 * The picture a frame loop hands its canvas, and the disposal of every one it
 * replaces.
 *
 * Left to the collectors, a picture lives until both runtimes have collected
 * their wrappers of it, and RN Skia charges those wrappers for the recording
 * alone, not for the vertices it holds — so memory climbs with every frame
 * until a collection happens to run.
 *
 * Only the UI thread knows when the canvas has moved past a picture, and it
 * does not see every one: two pictures published between its turns reach it
 * as the second alone. So each picture is numbered, the UI thread reports the
 * number it has reached, and every picture published before that one is
 * disposed here, the skipped ones included. Disposing drops only this side's
 * reference: the canvas keeps its own while it replays a picture.
 */
export function useFramePicture(): SsFramePicture {
  const empty = useMemo(() => {
    const recorder = Skia.PictureRecorder()
    recorder.beginRecording()
    return recorder.finishRecordingAsPicture()
  }, [])
  const picture = useSharedValue<SkPicture>(empty)
  // Written after `picture`, so a reaction that sees a number sees its picture.
  const published = useSharedValue(0)
  // Pictures not yet known to be behind the canvas, oldest first; `pending[0]`
  // is number `first`, and the numbers run on without gaps.
  const queue = useRef({ pending: [empty], first: 0, next: 1 }).current

  const retire = useCallback(
    (reached: number) => {
      while (queue.first < reached && queue.pending.length > 0) {
        queue.pending.shift()?.dispose()
        queue.first += 1
      }
    },
    [queue]
  )

  useAnimatedReaction(
    () => published.value,
    (current, previous) => {
      if (previous != null && current !== previous) runOnJS(retire)(current)
    }
  )

  const publish = useCallback(
    (next: SkPicture) => {
      queue.pending.push(next)
      picture.value = next
      published.value = queue.next
      queue.next += 1
    },
    [picture, published, queue]
  )

  return useMemo(() => ({ picture, publish }), [picture, publish])
}
