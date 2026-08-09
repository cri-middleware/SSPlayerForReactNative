/**
 * Where a URI's bytes come from, and so which door opens them.
 *
 * The three are exhaustive on purpose: every reference a pack carries is
 * resolved by joining it onto the `.ssab`'s own URI, so a pack's siblings are
 * always the same kind as the pack. Adding a fourth means teaching every reader
 * about it.
 */
export type SsUriScheme =
  /** Relative to the app's asset directory — the shipped case. C++ reads it. */
  | 'asset'
  /** A real path, or `file://`. Downloads, `Documents/`, anything unpacked. */
  | 'file'
  /** `http(s)://` and friends. A dev server, or a CDN. */
  | 'remote'

/**
 * How `uri` will be opened.
 *
 * A bare relative path means the asset directory. That is the default because
 * it is the only form that reaches a release build on both platforms with its
 * *directory* intact — and a directory is what a pack is. `image_path`, an
 * `external_textures` entry, an Instance part's external `.ssab` and a
 * `.ssqb`'s `ref_anime_pack` are all names of siblings.
 */
export function schemeOf(uri: string): SsUriScheme {
  if (uri.startsWith('file://') || uri.startsWith('/')) return 'file'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return 'remote'
  return 'asset'
}

/**
 * The filesystem path behind `uri`, or null when it is not a local file.
 *
 * The Brain opens files with `fopen`, which does not speak `file://`.
 */
export function fileSystemPathOf(uri: string): string | null {
  if (uri.startsWith('file://')) return decodeURIComponent(uri.slice(7))
  // An absolute path with no scheme at all.
  if (uri.startsWith('/')) return uri
  return null
}

/**
 * Resolves `ref` — a name a pack carries — against the URI the pack came from.
 *
 * **The one place a sibling reference becomes something openable.** Textures go
 * through it today; the external `.ssab` of an Instance part and a `.ssqb`'s
 * `ref_anime_pack` are the same question and get the same answer.
 *
 * Deliberately string surgery rather than `new URL`: `baseUri` is an
 * asset-relative path, a filesystem path *or* a URL depending on where the
 * `.ssab` came from, and the join is the same operation for all three. A
 * `?query` on the base belongs to the `.ssab` and not to its directory, so it
 * goes.
 */
export function resolveAgainst(baseUri: string, ref: string): string {
  if (schemeOf(ref) !== 'asset') return normalizeUri(ref)

  const withoutQuery = baseUri.replace(/[?#].*$/, '')
  const slash = withoutQuery.lastIndexOf('/')
  const parent = slash < 0 ? '' : withoutQuery.slice(0, slash)
  return normalizeUri(parent === '' ? ref : `${parent}/${ref}`)
}

/**
 * `uri` with `.`, `..` and empty segments collapsed, scheme and root intact.
 *
 * `..` is collapsed here rather than left to whoever opens the file, because
 * `image_path` is authored relative to the `.ssae` and `../images/common.png`
 * is an ordinary thing for a pack to contain — and `AAssetManager_open` does
 * not resolve one.
 */
export function normalizeUri(uri: string): string {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(uri)?.[0] ?? ''
  let rest = uri.slice(authority.length)
  const rooted = rest.startsWith('/')
  if (rooted) rest = rest.slice(1)

  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    // A `..` with nothing left to cancel is kept rather than dropped: silently
    // rewriting it would turn "this pack points outside its own directory" into
    // a read of some other file. Left in, whoever opens it names it.
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return `${authority}${rooted ? '/' : ''}${parts.join('/')}`
}
