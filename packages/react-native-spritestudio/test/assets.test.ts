import { describe, expect, it } from 'vitest'

import {
  fileSystemPathOf,
  normalizeUri,
  resolveAgainst,
  schemeOf,
} from '../src/core/assets'

describe('schemeOf', () => {
  it('reads a bare relative path as an asset', () => {
    expect(schemeOf('ss/Ringo.ssab')).toBe('asset')
    expect(schemeOf('common.png')).toBe('asset')
    expect(schemeOf('../images/common.png')).toBe('asset')
  })

  it('reads a rooted path and file:// as a file', () => {
    expect(schemeOf('/var/mobile/Documents/a.ssab')).toBe('file')
    expect(schemeOf('file:///var/mobile/a.ssab')).toBe('file')
  })

  it('reads anything else with an authority as remote', () => {
    expect(schemeOf('https://cdn.example/a.ssab')).toBe('remote')
    expect(schemeOf('http://localhost:8081/a.ssab')).toBe('remote')
  })

  // The Metro dev server hands out `http://…` and a release build hands out a
  // bare name for the same pack, so the two have to land on different doors.
  it('separates the dev server from the shipped case', () => {
    expect(schemeOf('http://10.0.2.2:8081/assets/ss/a.ssab')).not.toBe(
      schemeOf('assets/ss/a.ssab')
    )
  })
})

describe('fileSystemPathOf', () => {
  // The Brain opens files with fopen, which does not speak file://.
  it('strips the file:// scheme', () => {
    expect(fileSystemPathOf('file:///var/mobile/a.ssab')).toBe('/var/mobile/a.ssab')
  })

  it('percent-decodes what the scheme escaped', () => {
    expect(fileSystemPathOf('file:///var/My%20Games/a.ssab')).toBe(
      '/var/My Games/a.ssab'
    )
  })

  it('passes a scheme-less absolute path through', () => {
    expect(fileSystemPathOf('/var/mobile/a.ssab')).toBe('/var/mobile/a.ssab')
  })

  it('answers null for anything not local', () => {
    expect(fileSystemPathOf('ss/a.ssab')).toBeNull()
    expect(fileSystemPathOf('https://cdn.example/a.ssab')).toBeNull()
  })
})

describe('normalizeUri', () => {
  it('collapses . and empty segments', () => {
    expect(normalizeUri('ss//./a.ssab')).toBe('ss/a.ssab')
  })

  it('collapses .. against the segment before it', () => {
    expect(normalizeUri('ss/anime/../images/common.png')).toBe('ss/images/common.png')
  })

  it('keeps the root', () => {
    expect(normalizeUri('/var/./mobile/../mobile/a.ssab')).toBe('/var/mobile/a.ssab')
  })

  it('keeps scheme and authority intact', () => {
    expect(normalizeUri('https://cdn.example/ss/../a.ssab')).toBe(
      'https://cdn.example/a.ssab'
    )
    expect(normalizeUri('file:///var/ss/../a.ssab')).toBe('file:///var/a.ssab')
  })

  // Documented rule: silently dropping a leading `..` would turn "this pack
  // points outside its own directory" into a read of some other file.
  it('keeps a .. that has nothing left to cancel', () => {
    expect(normalizeUri('../common.png')).toBe('../common.png')
    expect(normalizeUri('../../a/b.png')).toBe('../../a/b.png')
    expect(normalizeUri('a/../../b.png')).toBe('../b.png')
  })

  it('is idempotent', () => {
    for (const uri of [
      'ss/anime/../images/common.png',
      '../common.png',
      'https://cdn.example/ss/../a.ssab',
      '/var/./mobile/a.ssab',
    ]) {
      expect(normalizeUri(normalizeUri(uri))).toBe(normalizeUri(uri))
    }
  })
})

describe('resolveAgainst', () => {
  it('joins a sibling onto the pack’s own directory', () => {
    expect(resolveAgainst('ss/overall/Basic.ssab', 'common.png')).toBe(
      'ss/overall/common.png'
    )
  })

  it('joins onto a file path and a URL the same way', () => {
    expect(resolveAgainst('/var/ss/Basic.ssab', 'common.png')).toBe(
      '/var/ss/common.png'
    )
    expect(resolveAgainst('https://cdn.example/ss/Basic.ssab', 'common.png')).toBe(
      'https://cdn.example/ss/common.png'
    )
    expect(resolveAgainst('file:///var/ss/Basic.ssab', 'common.png')).toBe(
      'file:///var/ss/common.png'
    )
  })

  it('resolves image_path’s ../ out of the pack directory', () => {
    expect(resolveAgainst('ss/overall/Basic.ssab', '../images/common.png')).toBe(
      'ss/images/common.png'
    )
  })

  it('leaves a ref that already names its own door alone', () => {
    expect(resolveAgainst('ss/overall/Basic.ssab', 'https://cdn.example/c.png')).toBe(
      'https://cdn.example/c.png'
    )
    expect(resolveAgainst('ss/overall/Basic.ssab', '/var/c.png')).toBe('/var/c.png')
    expect(resolveAgainst('ss/overall/Basic.ssab', 'file:///var/c.png')).toBe(
      'file:///var/c.png'
    )
  })

  // A ?query belongs to the .ssab, not to its directory: a dev server hands out
  // `a.ssab?platform=ios` and the atlas beside it is not under that query.
  it('drops a query or fragment on the base', () => {
    expect(
      resolveAgainst('http://localhost:8081/ss/a.ssab?platform=ios', 'common.png')
    ).toBe('http://localhost:8081/ss/common.png')
    expect(resolveAgainst('ss/a.ssab#frag', 'common.png')).toBe('ss/common.png')
  })

  it('handles a base with no directory at all', () => {
    expect(resolveAgainst('Basic.ssab', 'common.png')).toBe('common.png')
  })

  // Textures go through this today; an Instance part's external .ssab and a
  // .ssqb's ref_anime_pack are the same question, so the answer has to hold for
  // a pack naming a pack.
  it('resolves an external pack, not just a texture', () => {
    expect(resolveAgainst('ss/overall/Instance.ssab', 'Instance_SourceAnime.ssab')).toBe(
      'ss/overall/Instance_SourceAnime.ssab'
    )
  })
})
