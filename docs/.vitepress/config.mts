import { withMermaid } from 'vitepress-plugin-mermaid'
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForReactNative'

// Only ever the published address. `base` below is a path, not an origin, so it
// cannot build an absolute og:url on its own.
const SITE_URL = 'https://cri-middleware.github.io/SSPlayerForReactNative'

// Close to SSPlayerForWeb's shelves, with two deliberate divergences.
//
// What that site calls "Customize" is "Going further" here, and its pages stay
// under /usage/. Nothing on that shelf customizes *the package* — this port
// exposes no custom shaders and no extension points, so the sibling's name would
// promise a surface that does not exist. It is the same audience as Usage, one
// step in.
//
// And ROADMAP is not in the nav, where the sibling puts it. Every entry here
// stays on the site; the sibling's fifth bounced to raw markdown on GitHub;
// more to the point, it is a contributor's document — vertex ceilings, packaging
// decisions, a thread-safety note — sitting at the same level as Usage. The
// reader's version of "what is missing" is /limitations. Individual pages still
// link ROADMAP where a specific caveat is tracked there, which is sourcing
// rather than navigation.
//
// English at the root, Japanese under /ja/, and the TypeDoc reference shared by
// both at /api/ because it is language neutral.
//
// **Every linked Japanese heading carries an explicit ASCII id**, the same one
// its English page uses — `## プリロード {#preloading}`. This is not a style
// choice. VitePress slugifies through NFKD, which *decomposes* voiced kana, so
// the id it emits for `プリロード` starts フ+U+309A… and a hand-written
// `#プリロード` never matches the heading it points at. Nothing catches it
// either: VitePress's dead-link check does not look at anchors at all.
//
// The sidebar is a difficulty gradient rather than a table of contents. Reading
// top to bottom, the effort rises: install and copy a snippet, get one animation
// playing, then the things a real app needs, then the reference to look names up
// in, then what to do when it breaks and what this port cannot do at all.
export default withMermaid({
  title: 'SpriteStudio Player for React Native',
  description: 'SpriteStudio player for React Native (Nitro Modules + React Native Skia)',
  lastUpdated: true,
  cleanUrls: true,
  lang: 'en',
  base: '/SSPlayerForReactNative/',


  head: [['meta', { property: 'og:site_name', content: 'SpriteStudio Player for React Native' }]],

  // mermaid 12 defaults to the ELK layout and the redux-color theme, which draws
  // the diagram on setup/assets as a thin strip too small to read, and wraps
  // flowchart labels at 120px, which splits ネイティブビルド mid-word.
  mermaid: { layout: 'dagre', theme: 'default', flowchart: { wrappingWidth: 200 } },

  // mermaid imports CommonJS packages (dayjs among them), and nothing pre-bundles it:
  // the plugin imports it from inside node_modules, where Vite's scan does not look.
  // Left out, the dev server hands the browser the raw CJS file and the import of
  // its default export throws at module scope — the whole site renders blank, not
  // just the diagrams. `vitepress build` is unaffected, since Rollup handles CJS:
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
    plugins: [
      llmstxt({
        domain: new URL(SITE_URL).origin,
        ignoreFilesPerOutput: {
          llmsTxt: ['ja.md', 'ja/**', 'api/*/**'],
          llmsFullTxt: ['ja.md', 'ja/**', 'api/*/**'],
        },
        customTemplateVariables: {
          title: 'SpriteStudio Player for React Native',
          description: 'SpriteStudio player for React Native (Nitro Modules + React Native Skia)',
          details: [
            'React Native player for SpriteStudio on the New Architecture: a `<SpriteStudioView>` component',
            'over Nitro Modules and React Native Skia. It needs a development build, not Expo Go.',
            '`setup/install` and `setup/quickstart` get a first animation on screen, `setup/assets`',
            'converts a `.sspj` into an `.ssab`, `components` is the components at a glance, and `api-guide`',
            'says where to start in the API. `troubleshooting` is for when it breaks and `limitations` lists',
            'what is not supported. The generated reference keeps its index page in this file; each class,',
            'interface, function, type alias and variable has its own page at `api/<kind>/<Name>.md`, where',
            '`<kind>` is `classes`, `interfaces`, `functions`, `type-aliases` or `variables`. This file is the',
            'English pages only; each Japanese page is the same path under `ja/` with `.md` appended.',
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
              { text: 'Working from a checkout', link: '/development/from-source' },
            ],
          },
          // The family entry point, carried in the nav of every sibling site so a reader who
          // arrives from a search can reach the portal and the other players.
          { text: 'SpriteStudio Docs', link: 'https://cri-middleware.github.io/SpriteStudio-Docs/' },
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
              { text: 'Transport', link: '/usage/transport' },
              { text: 'Many animations: a scene', link: '/usage/scene' },
            ],
          },
          {
            text: 'Going further',
            items: [
              { text: 'Events & user data', link: '/usage/events' },
              { text: 'Part overrides & following', link: '/usage/parts' },
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
            text: 'Development',
            items: [
              { text: 'Working from a checkout', link: '/development/from-source' },
              { text: 'Working on this repository', link: `${GITHUB}/blob/HEAD/CONTRIBUTING.md` },
            ],
          },
        ],
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
              { text: 'チェックアウトから動かす', link: '/ja/development/from-source' },
            ],
          },
          // ポータルへの戻り導線。日本語ロケール（/ja/）を指すこと。
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
              { text: '複数アニメーション: シーン', link: '/ja/usage/scene' },
            ],
          },
          {
            text: 'さらに進む',
            items: [
              { text: 'イベントとユーザーデータ', link: '/ja/usage/events' },
              { text: 'パーツの上書きと追従', link: '/ja/usage/parts' },
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
            text: '開発',
            items: [
              { text: 'チェックアウトから動かす', link: '/ja/development/from-source' },
              { text: 'このリポジトリで作業する', link: `${GITHUB}/blob/HEAD/CONTRIBUTING.md` },
            ],
          },
        ],
      },
    },
  },
})
