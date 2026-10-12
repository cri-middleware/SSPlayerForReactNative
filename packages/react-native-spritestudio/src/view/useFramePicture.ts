import { Skia, type SkPicture } from '@shopify/react-native-skia'
import { useMemo } from 'react'
import {
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

/**
 * The picture a frame loop hands its canvas, seeded with an empty recording
 * because `<Picture>` has no null state.
 *
 * Each picture is disposed on the UI thread once the canvas has moved past it.
 * Left to the collectors, a picture lives until both runtimes have collected
 * their wrappers of it, and RN Skia charges those wrappers for the recording
 * alone, not for the vertices it holds — so memory climbs with every frame
 * until a collection happens to run. Only the UI thread knows when the canvas
 * stopped drawing a picture, which is why the disposal happens there.
 */
export function useFramePicture(): SharedValue<SkPicture> {
  const empty = useMemo(() => {
    const recorder = Skia.PictureRecorder()
    recorder.beginRecording()
    return recorder.finishRecordingAsPicture()
  }, [])
  const picture = useSharedValue<SkPicture>(empty)

  useAnimatedReaction(
    () => picture.value,
    (current, previous) => {
      if (previous != null && previous !== current) previous.dispose()
    }
  )

  return picture
}
