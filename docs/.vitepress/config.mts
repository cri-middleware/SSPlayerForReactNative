import { withMermaid } from 'vitepress-plugin-mermaid'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForReactNative'

// Only ever the published address. `base` below is '/' during local dev, and a
// social card must advertise where the page really lives.
const SITE_URL = 'https://cri-middleware.github.io/SSPlayerForReactNative'

// Same shape as SSPlayerForWeb's: English at the root, Japanese under /ja/, and
// the TypeDoc-generated reference shared by both at /api/ because it is language
// neutral.
//
// The sidebar is a difficulty gradient rather than a table of contents. Reading
// top to bottom, the effort rises: install and copy a snippet, then the things a
// real app needs, then the reference, then what this port cannot do.
export default withMermaid({
  title: 'SSPlayerForReactNative',
  description: 'SpriteStudio 7 player for React Native (Nitro Modules + React Native Skia)',
  lastUpdated: true,
  cleanUrls: true,
  lang: 'en',
  base: '/SSPlayerForReactNative/',

  head: [['meta', { property: 'og:site_name', content: 'SSPlayerForReactNative' }]],

  transformPageData(pageData) {
    const title = pageData.frontmatter.title ?? pageData.title ?? 'SSPlayerForReactNative'
    const description = pageData.frontmatter.description ?? pageData.description ?? ''
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: `${SITE_URL}/${pageData.relativePath.replace(/\.md$/, '')}` }],
      ['meta', { property: 'og:locale', content: pageData.relativePath.startsWith('ja/') ? 'ja_JP' : 'en_US' }],
      ['meta', { name: 'twitter:card', content: 'summary' }],
      ['meta', { name: 'twitter:site', content: '@spritestudio' }]
    )
  },

  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: GITHUB },
      { icon: 'x', link: 'https://x.com/spritestudio' },
    ],
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        outline: { level: [2, 3], label: 'On this page' },
        nav: [
          { text: 'Setup', link: '/setup/install' },
          { text: 'Usage', link: '/usage/basic' },
          { text: 'API', link: '/api-guide' },
          { text: 'ROADMAP', link: `${GITHUB}/blob/main/ROADMAP.md` },
        ],
        sidebar: [
          {
            text: 'Setup',
            items: [
              { text: 'Installation', link: '/setup/install' },
              { text: 'Quick Start', link: '/setup/quickstart' },
              { text: 'Preparing assets (.sspj → .ssab)', link: '/setup/assets' },
            ],
          },
          {
            text: 'Usage',
            items: [
              { text: 'Basic playback', link: '/usage/basic' },
              { text: 'Many animations: a scene', link: '/usage/scene' },
              { text: 'Events & user data', link: '/usage/events' },
              { text: 'Part overrides & following', link: '/usage/parts' },
            ],
          },
          {
            text: 'API Reference',
            items: [
              { text: 'Where to start', link: '/api-guide' },
              { text: 'Generated reference', link: '/api/' },
            ],
          },
          {
            text: 'Limitations & Scope',
            items: [{ text: 'Limitations & Scope', link: '/limitations' }],
          },
          {
            text: 'Development',
            items: [
              { text: 'The measurement behind the design', link: '/phase0-spike' },
              { text: 'Working on this repository', link: `${GITHUB}/blob/main/AGENTS.md` },
            ],
          },
        ],
      },
    },
  },
})
