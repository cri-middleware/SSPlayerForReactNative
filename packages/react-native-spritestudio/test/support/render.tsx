import type { ElementType, ReactElement } from 'react'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer'

/**
 * Concurrent rendering, asked for explicitly.
 *
 * `IS_REACT_NATIVE_TEST_ENVIRONMENT` — which setup.ts sets to stop the
 * deprecation notice landing in a `console.error` spy — also opts the renderer
 * back into the legacy root. React Native itself is concurrent, so this puts it
 * back.
 */
const OPTIONS = { unstable_isConcurrent: true, createNodeMock: () => null }

/**
 * Finds the host elements the stubs render as — `View`, `Canvas`, `Picture`.
 *
 * They are strings rather than components (see `test/support/stubs`), which is
 * what makes them findable at all; `ElementType` does not admit an arbitrary
 * one, so the cast lives here rather than at every call.
 */
export function findHosts(
  renderer: ReactTestRenderer,
  type: string
): ReactTestInstance[] {
  return renderer.root.findAllByType(type as unknown as ElementType)
}

/**
 * Renders a hook for real, effects and all.
 *
 * Layer 4 is almost entirely effects — which player is built, when it is torn
 * down, what the transport props map onto — so a harness that only called the
 * function would test none of it. `react-test-renderer` rather than a DOM
 * library because nothing here renders to a DOM: `react-native` and Skia are
 * stubbed as host elements, and this renderer is the one that does not care.
 */
export interface HookHarness<P, R> {
  /** The hook's latest return value. */
  readonly result: { current: R }
  rerender(props: P): Promise<void>
  unmount(): Promise<void>
  /** Lets pending promises — a load, a decode — settle inside `act`. */
  flush(): Promise<void>
}

export async function renderHook<P, R>(
  hook: (props: P) => R,
  initial: P
): Promise<HookHarness<P, R>> {
  const result = { current: undefined as R }

  function Harness({ props }: { props: P }): null {
    result.current = hook(props)
    return null
  }

  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(<Harness props={initial} />, OPTIONS)
  })

  const flush = async (): Promise<void> => {
    await act(async () => {})
  }

  return {
    result,
    rerender: async (props: P) => {
      await act(async () => renderer?.update(<Harness props={props} />))
    },
    unmount: async () => {
      await act(async () => renderer?.unmount())
    },
    flush,
  }
}

/** Renders a component tree, with the same `act` discipline. */
export async function render(element: ReactElement): Promise<{
  renderer: ReactTestRenderer
  update(next: ReactElement): Promise<void>
  unmount(): Promise<void>
  flush(): Promise<void>
}> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(element, OPTIONS)
  })
  const created = renderer as unknown as ReactTestRenderer
  return {
    renderer: created,
    update: async (next: ReactElement) => {
      await act(async () => created.update(next))
    },
    unmount: async () => {
      await act(async () => created.unmount())
    },
    flush: async () => {
      await act(async () => {})
    },
  }
}

export { act } from 'react-test-renderer'
