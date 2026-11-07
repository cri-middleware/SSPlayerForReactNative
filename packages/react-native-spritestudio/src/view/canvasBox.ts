import type { ViewStyle } from 'react-native'

/**
 * The box a canvas fills, inside the view a caller styles.
 *
 * Measured rather than the outer view, whose layout includes its padding and
 * border: the fit, a part follower and a touch all need the box the canvas draws
 * into. `alignSelf` because a caller's `alignItems` would otherwise collapse it.
 */
export const CANVAS_BOX: ViewStyle = { flex: 1, alignSelf: 'stretch' }
