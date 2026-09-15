import type { ComponentType } from 'react'

/**
 * Stands in for `@shopify/react-native-skia` under vitest.
 *
 * Recording rather than inert: a `<SpriteStudioView>` or a `<SpriteStudioScene>`
 * tick is "record one picture, hand it to the canvas", so the picture is the
 * only observable the frame loop has — `StubPicture.drawn` is what tells a scene
 * test which players drew, and in what order.
 */

/** The canvas a recording hands out. `drawn` is what a tick put on it. */
export interface StubCanvas {
  readonly drawn: unknown[]
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
}

export interface StubPicture {
  readonly canvas: StubCanvas
  readonly drawn: unknown[]
}

function makeCanvas(): StubCanvas {
  return {
    drawn: [],
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
  }
}

/**
 * How a decode turns out. Return null to make one fail, the way a corrupt or
 * missing atlas does — `SsTextureLoader` treats that as unresolved.
 */
export const skiaDecode = {
  image: (source: unknown): unknown | null => ({ skImage: source }),
}

export const Skia = {
  PictureRecorder: () => {
    let canvas = makeCanvas()
    return {
      beginRecording: () => {
        canvas = makeCanvas()
        return canvas
      },
      finishRecordingAsPicture: (): StubPicture => ({
        canvas,
        drawn: canvas.drawn,
      }),
    }
  },
  Paint: () => ({ setShader: (shader: unknown) => void shader }),
  Image: {
    MakeImageFromEncoded: (data: unknown) => skiaDecode.image(data),
  },
  Data: {
    fromBytes: (bytes: Uint8Array) => ({ bytes }),
    fromURI: async (uri: string) => ({ uri }),
  },
}

export const FilterMode = { Nearest: 0, Linear: 1 } as const
export const TileMode = { Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 } as const
export const MipmapMode = { None: 0, Nearest: 1, Linear: 2 } as const

export const Canvas = 'Canvas' as unknown as ComponentType<Record<string, unknown>>
export const Picture = 'Picture' as unknown as ComponentType<Record<string, unknown>>
