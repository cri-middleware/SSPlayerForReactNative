import { createContext, forwardRef, useContext, useImperativeHandle, type ReactNode } from 'react'

import { FakePlayer } from '../fakePlayer'

export const viewState = {
  player: new FakePlayer(),
  props: null as Record<string, unknown> | null,
  ready: true,
}

const PlayerContext = createContext<FakePlayer | null>(null)

export function useSsViewPlayer(): FakePlayer | null {
  return useContext(PlayerContext)
}

export const SpriteStudioView = forwardRef<{ player: FakePlayer }, { children?: ReactNode }>(
  function SpriteStudioView(props, ref) {
    viewState.props = props
    useImperativeHandle(ref, () => ({ player: viewState.player }), [])
    const View = 'SpriteStudioView' as unknown as (p: Record<string, unknown>) => ReactNode
    return (
      <View {...props}>
        {viewState.ready ? (
          <PlayerContext.Provider value={viewState.player}>{props.children}</PlayerContext.Provider>
        ) : null}
      </View>
    )
  }
)
