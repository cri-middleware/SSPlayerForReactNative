import { useEffect, type ReactNode } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'

import type { SpriteStudioPlayer } from '../player/SpriteStudioPlayer'
import { useSsViewPlayer } from './SpriteStudioView'
import { useSsPartTransform } from './useSsPartTransform'

export interface SpriteStudioPartAnchorProps {
  /** The part to follow. An unknown name hides the children until it resolves. */
  partName: string
  /**
   * Omitted, the player of the `<SpriteStudioView>` whose `children` this is
   * in. Given, it wins — for an anchor laid over a view by hand.
   */
  player?: SpriteStudioPlayer | null
  /** Turn with the part. Default `true`. */
  rotation?: boolean
  /**
   * Scale with the part. Default `false`: a follower is placed *at* the part,
   * not sized by it — a name plate should not breathe with the chest.
   */
  scale?: boolean
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

/**
 * Pins its children to a part: their top-left corner sits on the part's origin
 * and turns about it. Offset the children to attach a different point of them.
 *
 * The component form of `useSsPartTransform`, for the case that needs no code
 * of its own.
 */
export function SpriteStudioPartAnchor({
  partName,
  player,
  rotation = true,
  scale = false,
  style,
  children,
}: SpriteStudioPartAnchorProps): ReactNode {
  const enclosing = useSsViewPlayer()
  const target = player === undefined ? enclosing : player
  const transform = useSsPartTransform(target, partName)

  useEffect(() => {
    if (player === undefined && enclosing == null) {
      console.warn(
        'react-native-spritestudio: <SpriteStudioPartAnchor> has no player. Put it ' +
          'in a <SpriteStudioView>’s children, or pass the one to follow as `player`.'
      )
    }
  }, [player, enclosing])

  const animated = useAnimatedStyle(() => {
    const t = transform.value
    return {
      opacity: t.valid ? 1 : 0,
      transform: [
        { translateX: t.x },
        { translateY: t.y },
        { rotate: `${rotation ? t.rotation : 0}rad` },
        { scaleX: scale ? t.scaleX : 1 },
        { scaleY: scale ? t.scaleY : 1 },
      ],
    }
  })

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.anchor, style, animated]}
    >
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
})
