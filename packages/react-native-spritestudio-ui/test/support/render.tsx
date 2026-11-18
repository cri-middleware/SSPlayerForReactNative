import type { ElementType, ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

const OPTIONS = { unstable_isConcurrent: true, createNodeMock: () => null }

export function findHosts(renderer: ReactTestRenderer, type: string): ReactTestInstance[] {
  return renderer.root.findAllByType(type as unknown as ElementType)
}

export async function render(element: ReactElement): Promise<{
  renderer: ReactTestRenderer
  update(next: ReactElement): Promise<void>
  unmount(): Promise<void>
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
  }
}

export { act } from 'react-test-renderer'
