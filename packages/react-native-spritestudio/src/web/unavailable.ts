/**
 * What every non-portable entry point resolves to on web.
 *
 * This package has no web implementation and is not trying to have one (see
 * ROADMAP.md). What the web build exists for is narrower: an app that ships
 * **both** web and native, and plays SpriteStudio only on the native half,
 * should still be able to build its web bundle. Without it that app does not
 * get a broken player — it gets no bundle at all, because `runtime.ts` reaches
 * `NitroModules.createHybridObject` at module scope and Nitro's web shim throws
 * on any property access, so the failure lands at *import* and names Nitro
 * rather than this package.
 *
 * Hence: importing is free, using throws. A stub is a plain throwing function
 * rather than a Proxy so that React sees `typeof === 'function'` and calls it,
 * which puts the message in the render that asked for it.
 */

const message = (name: string): string =>
  `react-native-spritestudio: ${name} has no web implementation. Drawing needs ` +
  'React Native Skia and a Nitro (JSI) module, and neither is ported — for ' +
  'SpriteStudio on the web use @spritestudio/ssplayer-webgl (SSPlayerForWeb).'

/**
 * A stub standing in for `name`, typed as whatever the native export is.
 *
 * Callers pass the native type through `typeof import(...)`, which is erased,
 * so the two barrels keep one type surface without the web one importing a
 * single module that touches Skia or Nitro.
 */
export function unavailableOnWeb<T>(name: string): T {
  // A `function`, not an arrow: the classes here are constructed, and `new` on
  // an arrow throws "is not a constructor" instead of running the body.
  function stub(): never {
    throw new Error(message(name))
  }
  return stub as unknown as T
}

/** The same, for the one export that is an object rather than a callable. */
export function unavailableObjectOnWeb<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, key) {
      throw new Error(`${message(name)} (reading ${String(key)})`)
    },
  })
}
