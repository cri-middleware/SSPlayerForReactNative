import type { DefaultTheme } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForReactNative'

// Only ever the published address. `base` below is a path, not an origin, so it
// cannot build an absolute og:url on its own.
const SITE_URL = 'https://cri-middleware.github.io/SSPlayerForReactNative'

// The sidebar is a difficulty gradient rather than a table of contents. Reading
// top to bottom, the effort rises: install and copy a snippet, get one animation
// playing, then the things a real app needs, then the reference to look names up
// in, then what to do when it breaks and what this port cannot do at all.
const DEVELOPERS = 'For Player & SDK Developers'
const enSidebar: DefaultTheme.SidebarItem[] = [
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
      { text: 'Transport', link: '/usage/transport' },
      { text: 'Motion blending', link: '/usage/motion-blending' },
      { text: 'Many animations: a scene', link: '/usage/scene' },
    ],
  },
  {
    text: 'Going further',
    items: [
      { text: 'Events & user data', link: '/usage/events' },
      { text: 'Part overrides & following', link: '/usage/parts' },
      { text: 'UI buttons', link: '/usage/ui' },
      { text: 'Textures & resources', link: '/usage/textures' },
      { text: 'Reanimated', link: '/usage/reanimated' },
      { text: 'Performance', link: '/usage/performance' },
    ],
  },
  {
    text: 'API Reference',
    items: [
      { text: 'Where to start', link: '/api-guide' },
      { text: 'Components at a glance', link: '/components' },
      { text: 'Generated reference', link: '/api/' },
    ],
  },
  {
    text: 'Troubleshooting & Limits',
    items: [
      { text: 'Troubleshooting', link: '/troubleshooting' },
      { text: 'Limitations & Scope', link: '/limitations' },
      { text: 'License & notices', link: '/licenses' },
    ],
  },
  {
    text: DEVELOPERS,
    items: [
      { text: 'Build Guide', link: '/development/build' },
      { text: 'How the Player Is Put Together', link: '/development/architecture' },
      { text: 'Contributing', link: `${GITHUB}/blob/HEAD/CONTRIBUTING.md` },
    ],
  },
]

// What llms.txt lists: two sections by audience, since a file an assistant reads has no
// difficulty gradient to follow. The first holds every other section's pages in sidebar
// order, the second is the developer section as it stands. Derived from `enSidebar`, so a
// page added there is listed here without a second edit.
const llmsSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Using the Player',
    items: enSidebar.filter(({ text }) => text !== DEVELOPERS).flatMap(({ items }) => items ?? []),
  },
  ...enSidebar.filter(({ text }) => text === DEVELOPERS),
]

// English at the root, Japanese under /ja/, and the TypeDoc reference shared by
// both at /api/ because it is language neutral.
//
// **Every linked Japanese heading carries an explicit ASCII id**, the same one
// its English page uses — `## プリロード {#preloading}`. This is not a style
// choice. VitePress slugifies through NFKD, which *decomposes* voiced kana, so
// the id it emits for `プリロード` starts フ+U+309A…. A link inside these pages
// goes through the same slugify and lands, but one from anywhere else (the
// portal, another repo's README) is typed in NFC and never matches. Nothing
// catches it either: VitePress's dead-link check does not look at anchors at all.
export default withMermaid({
  title: 'SpriteStudio Player for React Native',
  description: 'SpriteStudio player for React Native (Nitro Modules + React Native Skia)',
  lastUpdated: true,
  cleanUrls: true,
  lang: 'en',
  base: '/SSPlayerForReactNative/',


  // VitePress puts no `base` in front of a `head` href, so the icon's spells it out.
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/SSPlayerForReactNative/favicon.svg' }],
    ['meta', { property: 'og:site_name', content: 'SpriteStudio Player for React Native' }],
  ],

  // mermaid 12 defaults to the ELK layout and the redux-color theme, which draws
  // the diagram on setup/assets as a thin strip too small to read, and wraps
  // flowchart labels at 120px, which splits ネイティブビルド mid-word.
  mermaid: { layout: 'dagre', theme: 'default', flowchart: { wrappingWidth: 200 } },

  // mermaid imports CommonJS packages (dayjs among them), and nothing pre-bundles it:
  // the plugin imports it from inside node_modules, where Vite's scan does not look.
  // Left out, the dev server hands the browser the raw CJS file and the import of
  // its default export throws at module scope — the whole site renders blank, not
  // just the diagrams. `vitepress build` is unaffected, since Rolldown handles CJS:
  // this is one of the few faults a green build cannot see.
  //
  // Name mermaid, not its dependencies: pnpm does not hoist them, so they do not
  // resolve from docs/. The plugin names them anyway, which is the "Failed to
  // resolve dependency" the dev server prints at startup.
  vite: {
    optimizeDeps: {
      include: ['mermaid'],
    },

    // `llms.txt` and `llms-full.txt` for readers who hand the docs to an AI assistant, plus a
    // Markdown copy of every page beside its HTML. The two aggregates leave out the Japanese
    // pages (the plugin writes one pair for the whole site) and the TypeDoc symbol pages,
    // which are most of the reference's bytes. Both keep their own `.md`, so the discovery
    // link in every page resolves. `ja.md` is what the plugin calls the Japanese home page,
    // which `ja/**` misses.
    // `llms.txt` lists the pages under one heading per audience, each entry with its page's
    // frontmatter `description`. The plugin reads only a top-level `themeConfig.sidebar`, and
    // this site's sidebars are per locale, so `sidebar` below hands it `llmsSidebar`; without
    // that the list is flat and sorted by title. A page the sidebar does not list falls under
    // Other, and `llms-full.txt` follows the same order.
    plugins: [
      llmstxt({
        domain: new URL(SITE_URL).origin,
        sidebar: llmsSidebar,
        ignoreFilesPerOutput: {
          llmsTxt: ['ja.md', 'ja/**', 'api/*/**'],
          llmsFullTxt: ['ja.md', 'ja/**', 'api/*/**'],
        },
        customTemplateVariables: {
          title: 'SpriteStudio Player for React Native',
          description: 'SpriteStudio player for React Native (Nitro Modules + React Native Skia)',
          details: [
            'React Native player for SpriteStudio on the New Architecture: a `<SpriteStudioView>` component',
            'over Nitro Modules and React Native Skia. It needs a development build, not Expo Go. The',
            'generated reference keeps its index page in this file; each class, interface, function, type',
            'alias and variable has its own page at `api/<kind>/<Name>.md`, where `<kind>` is `classes`,',
            '`interfaces`, `functions`, `type-aliases` or `variables`. This file is the English pages only;',
            'each Japanese page is the same path under `ja/` with `.md` appended.',
          ].join(' '),
        },
      }),
    ],
  },

  // The Copy as Markdown button, inserted after each page's first heading. The component
  // itself is registered in theme/index.ts.
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons)
    },
  },

  transformPageData(pageData) {
    const title = pageData.frontmatter.title ?? pageData.title ?? 'SpriteStudio Player for React Native'
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
          { text: 'Going further', link: '/usage/events' },
          { text: 'API', link: '/api-guide' },
          {
            text: 'More',
            items: [
              { text: 'Troubleshooting', link: '/troubleshooting' },
              { text: 'Limitations & Scope', link: '/limitations' },
              { text: 'License & notices', link: '/licenses' },
              { text: 'Build Guide', link: '/development/build' },
              { text: 'How the Player Is Put Together', link: '/development/architecture' },
            ],
          },
          // The family entry point, carried in the nav of every sibling site so a reader who
          // arrives from a search can reach the portal and the other players.
          { text: 'SpriteStudio Docs', link: 'https://cri-middleware.github.io/SpriteStudio-Docs/' },
        ],
        sidebar: enSidebar,
      },
    },

    ja: {
      label: '日本語',
      lang: 'ja',
      link: '/ja/',
      // Without this every ja page inherits the top-level English description
      // into its <meta> and Open Graph tags.
      description: 'SpriteStudio のアニメーションを React Native で再生するプレイヤー（Nitro Modules + React Native Skia）',
      themeConfig: {
        outline: { level: [2, 3], label: '目次' },
        llms: {
          copyText: 'ページをコピー',
          copiedText: 'コピーしました',
          viewMarkdownText: 'Markdown で表示',
          openInAIText: '{provider} で開く',
        },
        nav: [
          { text: 'はじめに', link: '/ja/setup/install' },
          { text: '使い方', link: '/ja/usage/basic' },
          { text: 'さらに進む', link: '/ja/usage/events' },
          { text: 'API', link: '/ja/api-guide' },
          {
            text: 'その他',
            items: [
              { text: 'トラブルシューティング', link: '/ja/troubleshooting' },
              { text: '制約と適用範囲', link: '/ja/limitations' },
              { text: 'ライセンスと表記', link: '/ja/licenses' },
              { text: 'ビルドガイド', link: '/ja/development/build' },
              { text: 'プレイヤーの構成', link: '/ja/development/architecture' },
            ],
          },
          // Back-link to the portal; must point at the Japanese locale (/ja/).
          { text: 'SpriteStudio Docs', link: 'https://cri-middleware.github.io/SpriteStudio-Docs/ja/' },
        ],
        sidebar: [
          {
            text: 'はじめに',
            items: [
              { text: 'インストール', link: '/ja/setup/install' },
              { text: 'クイックスタート', link: '/ja/setup/quickstart' },
              { text: 'アセットの準備（.sspj → .ssab）', link: '/ja/setup/assets' },
            ],
          },
          {
            text: '使い方',
            items: [
              { text: '基本的な再生', link: '/ja/usage/basic' },
              { text: '再生の制御', link: '/ja/usage/transport' },
              { text: 'モーションブレンディング', link: '/ja/usage/motion-blending' },
              { text: '複数アニメーション: シーン', link: '/ja/usage/scene' },
            ],
          },
          {
            text: 'さらに進む',
            items: [
              { text: 'イベントとユーザーデータ', link: '/ja/usage/events' },
              { text: 'パーツの上書きと追従', link: '/ja/usage/parts' },
              { text: 'UI ボタン', link: '/ja/usage/ui' },
              { text: 'テクスチャとリソース', link: '/ja/usage/textures' },
              { text: 'Reanimated', link: '/ja/usage/reanimated' },
              { text: 'パフォーマンス', link: '/ja/usage/performance' },
            ],
          },
          {
            text: 'API リファレンス',
            items: [
              { text: 'どこから見るか', link: '/ja/api-guide' },
              { text: 'コンポーネント早見', link: '/ja/components' },
              // Language-neutral, so both locales share the one TypeDoc build.
              { text: '生成リファレンス', link: '/api/' },
            ],
          },
          {
            text: '困ったときと制約',
            items: [
              { text: 'トラブルシューティング', link: '/ja/troubleshooting' },
              { text: '制約と適用範囲', link: '/ja/limitations' },
              { text: 'ライセンスと表記', link: '/ja/licenses' },
            ],
          },
          {
            text: 'Player・SDK 開発者向けガイド',
            items: [
              { text: 'ビルドガイド', link: '/ja/development/build' },
              { text: 'プレイヤーの構成', link: '/ja/development/architecture' },
              { text: 'コントリビューション', link: `${GITHUB}/blob/HEAD/CONTRIBUTING.md` },
            ],
          },
        ],
      },
    },
  },
})
