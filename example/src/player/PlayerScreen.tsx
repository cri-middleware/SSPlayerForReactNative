import { useEffect, useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import {
  SpriteStudioView,
  ssCheckForLeaks,
  ssLiveHandles,
  SsSignalParamType,
  type SpriteStudioViewRef,
  type SsAudioEvent,
  type SsSignalEvent,
  type SsSignalParam,
  type SsUserDataEvent,
} from 'react-native-spritestudio'

import { SsAssets } from '../ss-assets'
import { playAudioEvent, releaseAudioPlayers } from './audio'

/**
 * How a pack's art sits relative to its origin, in **player-local units**.
 *
 * A SpriteStudio origin is wherever the author put it, so this cannot be
 * derived from the authored canvas size — `Basic` straddles its origin while
 * `Ringo` stands on it, feet at y = 0 and head 600 units up. Both numbers are
 * *measured* off the baked vertices rather than guessed; drawing a pack that
 * has never been framed shows a corner of it at best.
 */
interface Frame {
  /** Player-local height to fit into the view's shorter axis. */
  height: number
  /** Player-local y of the art's centre. +Y is up, as the root transform flips. */
  centerY: number
}

/** Straddles its origin (measured y ∈ [-109, 240]); the authored 480 canvas fits. */
const CENTRED: Frame = { height: 480, centerY: 0 }

/**
 * `Shader`, which is the one card whose point is seeing **every** part at once:
 * 28 of them, several per built-in, sweeping each effect's parameters through
 * their range.
 *
 * Measured x ∈ [-384, 384], y ∈ [-320, 320] — wider than the authored 480
 * canvas on both axes, so `CENTRED` cropped the grid and left the card
 * unreadable without scrolling. The box `fit` receives is a square of this
 * side, so it is framed on the **wider** axis with a little margin.
 */
const SHADER_GRID: Frame = { height: 800, centerY: 0 }

/**
 * The 40 drawable `.ssab` of the SDK's `ParticleEffect` project, each with its
 * own measured frame.
 *
 * Per pack rather than one figure for the family because they do not share a
 * scale: `e030` spans 463 player-local units and `e037` spans 4198, so a single
 * frame would show one as a speck and clip the other. Measured the same way as
 * every other frame here — the baked vertex bounds over 240 frames — which for
 * an effect means the particle quads, since those are most of what an effect
 * pack draws.
 *
 * `e040b` is deliberately absent: it converts to a 904-byte `.ssab` with no
 * parts and no cellmaps at all, so it would draw an empty canvas and read as a
 * bug in whatever was last changed.
 */
const PARTICLE_FRAMES = {
  e001: { height: 2900, centerY: 0 },
  e002: { height: 1067, centerY: 472 },
  e003: { height: 557, centerY: 46 },
  e004: { height: 964, centerY: -11 },
  e005: { height: 1553, centerY: -117 },
  e006: { height: 1796, centerY: 0 },
  e007: { height: 794, centerY: -12 },
  e008: { height: 1872, centerY: -15 },
  e009: { height: 1833, centerY: 563 },
  e010: { height: 1486, centerY: 91 },
  e011: { height: 1341, centerY: 38 },
  e012: { height: 910, centerY: 0 },
  e013: { height: 1130, centerY: 484 },
  e014: { height: 1218, centerY: 8 },
  e015: { height: 1883, centerY: 736 },
  e016: { height: 1585, centerY: 523 },
  e017: { height: 2649, centerY: -480 },
  e018: { height: 1059, centerY: 23 },
  e019: { height: 2865, centerY: 0 },
  e020: { height: 1147, centerY: 194 },
  e021: { height: 1360, centerY: 45 },
  e022: { height: 1279, centerY: 83 },
  e023: { height: 709, centerY: 0 },
  e024: { height: 552, centerY: 10 },
  e025: { height: 1905, centerY: -40 },
  e026: { height: 634, centerY: 5 },
  e027: { height: 1029, centerY: -108 },
  e028: { height: 3141, centerY: 1463 },
  e029: { height: 1482, centerY: -96 },
  e030: { height: 463, centerY: 51 },
  e031: { height: 2033, centerY: 372 },
  e032: { height: 880, centerY: 327 },
  e033: { height: 1606, centerY: 75 },
  e034: { height: 1808, centerY: 0 },
  e035: { height: 1285, centerY: 0 },
  e036: { height: 2914, centerY: 258 },
  e037: { height: 4198, centerY: 362 },
  e038: { height: 1031, centerY: 0 },
  e039: { height: 480, centerY: 125 },
  e040a: { height: 1729, centerY: -44 },
} as const satisfies Record<string, Frame>

/**
 * One entry in the *Subject* picker: a pack directory, the `.ssab` inside it it
 * can show, and how to frame each.
 *
 * `Basic` is the plain Normal-parts case and the one to check a render change
 * against. `BlendMode` is the SDK's blend test animation — every framebuffer
 * blend type side by side, which is the only way to see `SsBlend.hpp`'s table at
 * all, and in particular the two modes (Sub, Invert) that Skia has no single
 * blend mode for and that `SsSkiaDraw` reconstructs from three passes.
 * `PartsColor` is the *other* blend, the shader-side one: eight tinted quads,
 * all four PartColor modes, half of them with the four corners differing so the
 * gradient reconstruction in `SsPartColorShader.hpp` is actually exercised. It
 * holds two animations and they are two separate variables — `PartsColor_only`
 * is the tint alone and is what opens, `PartsColor_with_Transparent` adds part
 * opacity on top and is the alpha check.
 * `Mask` is the coverage-bitmap path (`SsMask.hpp` / `SsMaskShader.hpp`): both
 * features at once, since the pack carries mask parts (`Mask-Hole`) *and*
 * clipping ones (`Normal-Clipping-True`), which mask in opposite directions —
 * a mask hides what is drawn before it, a clipping part confines what comes
 * after. Its `Mesh-WriteMask-True` and `Shape-Mask-True` parts are the two
 * writers this port deliberately drops for now.
 *
 * `Mesh` is the deformed-geometry case: its vertices arrive from the Brain
 * **already in world space**, so unlike every other kind here the world matrix
 * must not touch them — a mesh drawn with the matrix applied twice lands
 * somewhere else entirely, which is the failure this screen makes obvious.
 *
 * `Effect` is the particle case under the same microscope as the rest: 13
 * effect parts in one animation, each a different authoring of the `EventEffect`
 * keys (`No_effect_keys`, `effect_key_on_0`, `start=0_indep=off`, …), which is
 * what makes it the card that says *which* effect rule broke.
 *
 * `Ringo` is the **character** case, and it is here now because Mesh landed:
 * it is 653 baked vertices against `Basic`'s 80, and 585 of those were missing
 * while Mesh went unbaked. Everything above is a feature under a microscope;
 * Ringo is the thing those features are for, with 24 authored animations to
 * pick from.
 *
 * `ParticleEffect` is the breadth to `Effect`'s depth — the SDK's 40-pack
 * effect showcase, and by some distance the heaviest thing this example draws
 * (1376 baked vertices for `e002` against Ringo's 653) — which is why the
 * vertex ceiling belongs on effects rather than on characters.
 */
interface Subject {
  /**
   * Which pack family; the *Textures* toggle picks the conversion within it.
   *
   * A key of `PACKS` for a card, and the deployed directory's own name for a
   * local subject, which `PACKS` does not list — see `LOCAL_SUBJECTS`.
   */
  pack: string
  /**
   * The `.ssab` this subject shows, each with its own measured frame.
   *
   * Usually one. `ParticleEffect` has 40, which is why the picker for this is a
   * dropdown and not a row — and why the frame lives per file rather than per
   * subject, since those 40 do not share a scale.
   *
   * **A list of frames, not a list of files.** What the dropdown offers comes
   * from the generated manifest — see `filesOf` — so a pack that was never
   * deployed takes its subject off the screen instead of leaving a card that
   * loads nothing.
   */
  files: Readonly<Record<string, Frame>>
  /**
   * Offer **every** `.ssab` in the pack directory, not only the measured ones.
   *
   * For a subject that *is* a pack rather than one card cut out of one. The
   * measured files still open first and keep their frames; the rest follow,
   * framed by `CENTRED`. This is what lets a locally supplied project — one
   * this repository does not ship the source for — appear in full without a
   * hand-written list here to go stale against it.
   */
  ownsPack?: true
  /**
   * Which animation to open on. **Omit it** unless the pack's first is the
   * wrong one to show — the player already defaults to the first, so naming it
   * here would only be a second copy of the same fact, and one that a
   * re-conversion can silently invalidate.
   */
  initialAnimation?: string
}

const SUBJECTS = {
  Basic: { pack: 'overall', files: { Basic: CENTRED } },
  BlendMode: { pack: 'overall', files: { BlendMode: CENTRED } },
  // Its first is `PartsColor_only`, the tint on its own, which is the one to
  // open on: `PartsColor_with_Transparent` adds part opacity and is a second
  // variable, one pick away in the dropdown.
  PartsColor: { pack: 'overall', files: { PartsColor: CENTRED } },
  Mask: { pack: 'overall', files: { Mask: CENTRED } },
  // **The one subject that is not a picture.** `Sound.ssab` holds a Null root
  // and three `PartTypeAudio` parts, so it bakes zero vertices and the stage
  // stays empty by design — everywhere else on this screen a blank canvas is
  // the failure. What it exercises is the audio-key path, and the readout under
  // the panel is where it shows: three keys at frames 0, 10 and 20, each naming
  // a file in the pack's `SoundList`. An empty readout means they never
  // arrived; a key with no `→ path` means the two-hash `SoundList` lookup did
  // not resolve it. **Nothing plays** — the package ships no audio stack, so
  // this reports what an app would feed to its own.
  // User data: the *other* kind of authored key — a bag of values rather than a
  // command. Two are authored, on frames 0 and 10, and **both fill all four
  // payloads** (integer, point, rect, text), which is what makes this the card
  // for the `has*` flags: a payload can legitimately be `0`, so absence and zero
  // have to be distinguishable and this pack fills every slot to prove the
  // reading of each. Its cycle is 10 frames at 30fps, so the keys re-fire about
  // three times a second and the readout is mostly this subject's — expected.
  UserData: { pack: 'overall', files: { UserData: CENTRED } },
  Sound: { pack: 'overall', files: { Sound: CENTRED } },
  // Signals: a named command and its parameters, for the app to dispatch. Two
  // are authored on frame 10 — `test_cmd` with one parameter of **every** type
  // and `play_se` with three — so the readout is where a wrongly-read union
  // shows: the parameter values are what break, not the command name. Both are
  // `active`; **no fixture here authors an inactive signal**, so the rule that
  // those are dropped is asserted in code and exercised by nothing.
  Signal: { pack: 'overall', files: { Signal: CENTRED } },
  Mesh: { pack: 'overall', files: { Mesh: CENTRED } },
  // Two polygons, and the kind with no texture at all: a Shape's colour is
  // entirely its baked vertex colours, so a textured or white-flat shape here
  // means the PartColor bilinear over the Brain's box coords is not reaching
  // them. Measured x ∈ [-248, 132], y ∈ [-144, 144]; the authored 480 frames it.
  Shape: { pack: 'overall', files: { Shape: CENTRED } },
  // The `SHDR` attribute: SpriteStudio's built-in integration shaders (`ss-*`),
  // **all thirteen ported**, several parts each so every effect is seen across
  // its parameter range — including the sign flips, which are separate branches
  // in most of them (`ss-sepia` warms one part and greyscales its twin).
  //
  // A shader that fails to compile degrades to the plain textured draw rather
  // than vanishing, so a sprite with no effect on it is now a *failure* rather
  // than the expected look — but the two are the same picture, which is why
  // `npm run check-shader` exists and this card cannot be the only evidence.
  Shader: { pack: 'overall', files: { Shader: SHADER_GRID } },
  // Measured y ∈ [-184, 237], so the authored 480 canvas frames it.
  Effect: { pack: 'overall', files: { Effect: CENTRED } },
  // 20 instance parts, every one of them mounting the **external** pack
  // `Instance_SourceAnime` — so this is the subject that says whether the
  // sibling-pack walk ran at all. An empty canvas here means the walk found
  // nothing; the parts themselves have no geometry of their own.
  //
  // The frame is composed rather than measured in one pass: the host tool bakes
  // one player, so this is the mounts' own span (x ∈ [-192, 96], y ∈ [-320,
  // 256]) widened by the child's box (±32), with margin.
  Instance: { pack: 'overall', files: { Instance: { height: 700, centerY: -32 } } },
  // **A mask that has to reach into an instance child** — the one composition
  // nothing in the SDK's own samples exercises, because those keep masks and
  // instance parts in separate files. All three scenes here mask the scene and
  // mount the characters as instances, so what the card asks is whether the
  // mask crosses that boundary.
  //
  // **What a failure looks like here is a character drawn unclipped** — walking
  // through the gate rather than behind it, or lit outside the light. The three
  // scenes differ in how many mounts share one coverage (1, 2 and 3), so a
  // composition that only works for a single child names itself too.
  //
  // Frames measured over 120 frames, per file: the two gate scenes share a span
  // (x ∈ [-590, 590], y ∈ [-16, 528]) and `True_light` is taller (y up to 873).
  // Framed on the width, which is the wider axis in all three.
  MaskInstance: {
    pack: 'MaskInstance',
    // The one subject that is a whole pack: its source is not in this
    // repository, so a list written here would describe whatever the author had
    // on disk the day they wrote it. The three character packs the scenes mount
    // come along for the ride, which is the useful half of the accident — a
    // sub-animation on its own, next to the scene that masks it.
    ownsPack: true,
    initialAnimation: 'Walk_gate',
    files: {
      Walk_Gate: { height: 1280, centerY: 256 },
      Into_Gate: { height: 1280, centerY: 256 },
      True_Light: { height: 1280, centerY: 336 },
      // The three packs the scenes mount, framed as characters rather than as
      // scenes: measured over every animation each one carries, x ∈ [-280, 333]
      // and y ∈ [-84, 497] for the two humans (wider on x, so framed on that)
      // and a fifth of that for the butterfly.
      Instance_Maid: { height: 700, centerY: 206 },
      Instance_Princess: { height: 700, centerY: 206 },
      Instance_ButterFly: { height: 260, centerY: -11 },
    },
  },
  Ringo: {
    pack: 'Ringo',
    // Measured across dance/wait1/run/jump: x ∈ [-178, 217], y ∈ [-4, 612].
    // Standing on its origin, so without the shift the feet would sit at the
    // centre of the view and the head would be off the top.
    files: { Ringo: { height: 700, centerY: 300 } },
    // The one subject that names an animation: the pack's first is `attack1`,
    // and a character introducing itself mid-swing is a poor opening frame.
    initialAnimation: 'dance',
  },
  // The character case for instances: nine mounts of `Ringo`'s own `kaiten`,
  // which makes it the one asset here where a *whole rig* — mesh deforms and
  // all — is drawn nine times through the instance path. All nine sit at the
  // origin, so it is framed like Ringo itself.
  RingoInstances: { pack: 'Ringo', files: { Ringo_tyu: { height: 700, centerY: 300 } } },
  /**
   * Instance and effect parts on one rig. Both body packs mount `Eye`'s `Wait`
   * out of a *different* animation pack, and `Action02_Body` authors `EFCT`
   * keys against `Effect01` / `Effect02` beside them. `overall` keeps the two
   * apart, a fixture each, so this is the only asset here where a baked frame
   * has to carry both at once.
   *
   * `ownsPack` because this subject *is* the project: `Eye` belongs on the
   * dropdown too, being the pack the instance parts reach into.
   *
   * `CENTRED` rather than a measured bound — Doll is authored on a 320 canvas
   * with the pivot at its centre, so 480 can only leave margin, never crop.
   */
  Doll: {
    pack: 'Doll',
    files: { Action01_Body: CENTRED, Action02_Body: CENTRED },
    ownsPack: true,
  },
  ParticleEffect: { pack: 'ParticleEffect', files: PARTICLE_FRAMES },
} as const satisfies Record<string, Subject & { pack: PackName }>

/**
 * The same animation converted two ways, so both texture routes are visible.
 *
 * Nothing here selects a route: `SsTextureLoader` decides per texture, taking
 * `embedded` bytes when the `.ssab` carries them and otherwise resolving
 * `image_path` against the `.ssab`'s own directory. The toggle just points at a
 * different directory — `*-embedded/` was converted with `--embedded`, and the
 * plain one keeps its atlas as a sibling file.
 *
 * The reference pack is what React Native used not to be able to draw. While
 * the `.ssab` was named with a `require()` there was no directory for the atlas
 * to be a sibling *of*, and this screen had to hand the texture over by hand.
 * The pack directories ship as app assets now (see the plugin entry in
 * `app.json`), so `ss/overall/` is a real directory on the device.
 *
 * **Both conversions exist per pack**, not once for the project, so the toggle
 * means the same thing whichever subject is selected. `deploy-examples.sh`
 * converts each listed project twice for exactly this.
 *
 * Paths are relative to the app's asset root, which the plugin fills from
 * `example/assets/ss`.
 */
const PACKS = {
  overall: { reference: 'ss/overall', embedded: 'ss/overall-embedded' },
  Ringo: { reference: 'ss/Ringo', embedded: 'ss/Ringo-embedded' },
  Doll: { reference: 'ss/Doll', embedded: 'ss/Doll-embedded' },
  // **No embedded conversion, and that is not an oversight.** Embedding bakes
  // the atlas into every `.ssab` that names it, and this project's two atlases
  // are 1.9 MB and 2.8 MB across 41 packs — roughly 150 MB of app assets to
  // exercise a texture route the other two subjects already cover. So the
  // toggle is disabled for this one and says so, rather than being present and
  // pointing at a directory that is not there.
  ParticleEffect: { reference: 'ss/ParticleEffect' },
  // Reference only as well, for a different reason: this one is here to answer
  // a question about *masking*, and the texture route it would exercise a
  // second time is the one `overall` and `Ringo` already cover both ways.
  MaskInstance: { reference: 'ss/MaskInstance' },
} as const satisfies Record<string, { reference: string; embedded?: string }>

type PackName = keyof typeof PACKS
type Mode = 'embedded' | 'reference'

const MODES = ['embedded', 'reference'] as const satisfies readonly Mode[]

/** The pack directory for a mode, or null when that conversion does not exist. */
function packDir(pack: string, mode: Mode): string | null {
  // A local subject's pack is not in the table: reference only, under its own
  // name, which is where `deploy-examples` puts it.
  const dirs: { reference: string; embedded?: string } =
    pack in PACKS ? PACKS[pack as PackName] : { reference: `ss/${pack}` }
  return mode === 'embedded' ? (dirs.embedded ?? null) : dirs.reference
}

/**
 * Which `.ssab` a subject can actually show, read out of the generated manifest.
 *
 * The manifest is the only enumeration this app has: packs ship as native app
 * assets, and nothing here can list a directory at runtime. Going through it
 * rather than through `subject.files` means a pack that `deploy-examples` did
 * not produce — the SDK submodule missing, or a locally supplied project this
 * repository does not ship the source for — simply is not offered, instead of
 * being offered and then failing to load with a blank stage to explain it.
 *
 * Measured files keep their declared order, because the first is the one the
 * subject opens on and `initialAnimation` names an animation inside it.
 */
function filesOf(subject: Subject): string[] {
  const prefix = `${packDir(subject.pack, 'reference')?.replace(/^ss\//, '') ?? ''}/`
  const present = Object.keys(SsAssets)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
  const measured = Object.keys(subject.files).filter((name) => present.includes(name))
  if (subject.ownsPack !== true) return measured
  return [...measured, ...present.filter((name) => !(name in subject.files)).sort()]
}

/**
 * A subject for every deployed pack directory no card claims — a project put
 * under `example/SpriteStudio_Source/` to be looked at, which `deploy-examples`
 * converts under its directory's name without anything here being told.
 *
 * Read out of the manifest like every file list on this screen, so there is no
 * table to keep: `ownsPack` offers every `.ssab` in the directory, and with no
 * measured frames the view measures each file at load. Reference only, like
 * `MaskInstance`. Named `local/<directory>` so that a project called `Mask` or
 * `Effect` — both are SpriteStudio basic samples — cannot shadow the card.
 */
const LOCAL_SUBJECTS: Readonly<Record<string, Subject>> = (() => {
  const claimed = new Set(
    Object.values(PACKS).flatMap((dirs: { reference: string; embedded?: string }) =>
      [dirs.reference, dirs.embedded ?? ''].map((dir) => dir.replace(/^ss\//, ''))
    )
  )
  const dirs = new Set(Object.keys(SsAssets).map((key) => key.split('/')[0]))
  return Object.fromEntries(
    Array.from(dirs)
      .filter((dir) => !claimed.has(dir))
      .sort()
      .map((dir): [string, Subject] => [`local/${dir}`, { pack: dir, files: {}, ownsPack: true }])
  )
})()

const ALL_SUBJECTS: Readonly<Record<string, Subject>> = { ...SUBJECTS, ...LOCAL_SUBJECTS }

const SUBJECT_NAMES = Object.keys(ALL_SUBJECTS).filter(
  (name) => filesOf(ALL_SUBJECTS[name]).length > 0
)

/**
 * `id=value` for one signal parameter.
 *
 * Switches on the reported `type` rather than guessing from which field is
 * non-zero, because a parameter's value can legitimately *be* zero — the same
 * distinction `SsUserDataEvent`'s `has*` flags exist for, settled here by the
 * discriminant instead. `none` is a parameter the author left unset and is
 * shown as such, not as an empty string.
 */
function formatSignalParam(param: SsSignalParam): string {
  switch (param.type) {
    case SsSignalParamType.bool:
      return `${param.id}=${param.boolValue}`
    case SsSignalParamType.index:
      return `${param.id}=#${param.intValue}`
    case SsSignalParamType.integer:
      return `${param.id}=${param.intValue}`
    case SsSignalParamType.floating:
      return `${param.id}=${param.floatValue}`
    case SsSignalParamType.text:
      return `${param.id}="${param.textValue}"`
    default:
      return `${param.id}=∅`
  }
}

/**
 * The reference case: the SDK's own sample animation, through the real API.
 *
 * It **opens** on `overall/Basic` rather than Ringo, still on purpose: Basic is
 * the SDK's plain Normal-parts case, so what it draws is a statement about the
 * render path itself, while a character asset mixes in authoring choices and a
 * missing part there says nothing about which stage failed.
 *
 * Ringo is in the list now, though, which it could not usefully be before —
 * mesh deforms and masks are the bulk of it, and until those landed most of the
 * character simply was not drawn. It is the check that the features work
 * *together* on real authoring, as opposed to one at a time on a test card.
 *
 * Everything the retired measurement harness did by hand — the context pool,
 * the picture recording, the frame loop, the root transform — is inside
 * `<SpriteStudioView>` here. What is left is props.
 *
 */
export function PlayerScreen() {
  const ref = useRef<SpriteStudioViewRef>(null)
  // Opens on `reference`, the mode with a loading path to get wrong: the atlas
  // is a sibling file that has to be found next to the `.ssab` at runtime, which
  // is exactly what React Native could not do while a source was a `require()`.
  // Embedded is self-contained and works anywhere, so defaulting to it would
  // mean the screen only exercised the fragile route when someone remembered to
  // ask for it.
  const [mode, setMode] = useState<Mode>('reference')
  const [subjectName, setSubjectName] = useState('Basic')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [flipX, setFlipX] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [error, setError] = useState<string | null>(null)
  const [leak, setLeak] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // Newest first and capped, because a looping animation re-crosses its keys
  // every cycle and an unbounded list would be a leak of its own on the one
  // screen that exists to prove there are none.
  const [audio, setAudio] = useState<string[]>([])

  // Which `.ssab` inside the subject, and which animation inside that.
  //
  // All three are **tagged with the subject they belong to and derived**, rather
  // than reset from an effect. An effect would leave one render where the source
  // is already the new pack and the name is still the old pack's — the view
  // reloads on both, so that render loads the new `.ssab` and asks it for an
  // animation it does not have. `setAnimation` returns false and nothing else
  // reports it, so the failure would show as an inexplicably blank frame. The
  // file picker has the same hazard one level up, where the wrong pairing is not
  // a missing animation but a missing file.
  const [pickedFile, setPickedFile] = useState<{
    subject: string
    name: string
  } | null>(null)
  const [picked, setPicked] = useState<{ file: string; name: string } | null>(null)
  const [loaded, setLoaded] = useState<{
    file: string
    names: string[]
    current: string
  } | null>(null)

  const subject = ALL_SUBJECTS[subjectName]
  const fileNames = filesOf(subject)
  // Checked against what the picker offered, not against the measured table:
  // an `ownsPack` subject offers files that table does not have.
  const file =
    pickedFile?.subject === subjectName && fileNames.includes(pickedFile.name)
      ? pickedFile.name
      : fileNames[0]
  // Undefined for a local subject, so the view measures the file itself: a
  // fixed box would be a guess about a pack nobody here has framed.
  const frame: Frame | undefined =
    subject.files[file] ?? (subject.pack in PACKS ? CENTRED : undefined)
  // Falls back to `reference` for a pack with no embedded conversion, so the
  // toggle can never point at a directory that was not deployed.
  const embeddedDir = packDir(subject.pack, 'embedded')
  const dir = (mode === 'embedded' ? embeddedDir : null) ?? packDir(subject.pack, 'reference')
  const source = `${dir}/${file}.ssab`

  // The generated manifest, used the way an app with *computed* paths has to
  // use it: as a check rather than as the source of the string. A pack this
  // screen names but `deploy-examples` never converted is otherwise a blank
  // stage with nothing to say why — `drawInto` skips what it cannot resolve.
  // An app naming its packs literally gets the stronger form for free, because
  // `SsAssets['overall/Basic']` is a type error when the key is wrong.
  if (__DEV__ && !(source.replace(/^ss\/|\.ssab$/g, '') in SsAssets)) {
    console.warn(
      `PlayerScreen: '${source}' is not in ss-assets.ts. Re-run ` +
        '`npm run deploy-examples`, then `npm run generate-assets`.'
    )
  }

  // Left **undefined** when the subject names none, which is most of them: the
  // player then sets up the pack's first, and `loaded.current` reads back which
  // that was. Resolving it here instead would mean either guessing a name before
  // the `.ssab` has been read, or waiting for the names and reloading once they
  // arrived — a second load per subject switch to reach the same frame.
  //
  // Keyed on the **file**, not the subject: `ParticleEffect` switches `.ssab`
  // without switching subject, and `e001`'s animation does not exist in `e002`.
  //
  // `initialAnimation` belongs to the subject's **first** file for the same
  // reason. It names an animation, and an animation only exists inside one
  // `.ssab` — `MaskInstance` opens on `Walk_gate`, which `True_Light.ssab` has
  // never heard of. Switching file therefore starts that file at its own first
  // animation rather than carrying a name across a pack boundary.
  const animation =
    picked?.file === file
      ? picked.name
      : file === fileNames[0]
        ? subject.initialAnimation
        : undefined
  const here = loaded?.file === file ? loaded : null
  const animationNames = here?.names ?? []
  // What the dropdown shows: the explicit pick, else whatever the player chose.
  const currentAnimation = animation ?? here?.current ?? ''

  // Read from the `.ssab` rather than hard-coded: the names are the converter's
  // output, so a list in this file would go stale the next time the project is
  // re-converted — and silently, since `setAnimation` only returns false.
  //
  // Counted in `onLoad` but **read in an effect**, not in `onLoad` itself. The
  // view creates its player and starts the load in the same effect, so `onLoad`
  // can fire before React has committed the render that publishes that player on
  // the ref — a fast (cached) load resolves in a microtask and wins the race.
  // Reading there would then see a null player, return no names, and never try
  // again: an empty picker with nothing else wrong. An effect runs after commit,
  // so the ref is current by construction.
  const [loadSeq, setLoadSeq] = useState(0)
  const onLoad = () => {
    setError(null)
    setLoadSeq((n) => n + 1)
    // A fresh pack has fresh keys; keeping the previous subject's would make the
    // readout say a sound fired that this animation never authored. The players
    // go with them, so a BGM does not outlive the animation that started it.
    setAudio([])
    releaseAudioPlayers()
  }

  /**
   * One line per authored audio key the playhead crosses — **and the sound**.
   *
   * The two halves are deliberately visible separately. The line is what the
   * Player reported (`→ path` is the pack's `SoundList` answering for the key;
   * a key with none did not resolve); anything after `⚠` is `./audio.ts`
   * declining to play it, which is app-side and not the Player's doing. Silence
   * with no `⚠` means the audio session, not the event path — see
   * `ensureAudioMode` there, and the iOS silent switch first of all.
   */
  const pushEvent = (line: string) =>
    setAudio((lines) => [line].concat(lines.slice(0, 5)))

  const onAudio = (event: SsAudioEvent) => {
    const where = event.filePath.length > 0 ? ` → ${event.filePath}` : ' → unresolved'
    const loops = event.loopNum === 1 ? '' : ` ×${event.loopNum}`
    const refused = playAudioEvent(source, event)
    const why = refused == null ? '' : `  ⚠ ${refused}`
    pushEvent(`f${event.frameNo} ${event.partName}: ${event.soundName}${loops}${where}${why}`)
  }

  /**
   * One line per user-data key, listing **only the payloads it actually carries**.
   *
   * Driven off the `has*` flags rather than off the values, which is the whole
   * reason those flags exist: an author can mean `integer: 0`, so a formatter
   * that skipped falsy values would silently drop a real key. A line showing
   * fewer payloads than the pack authors is the failure to look for.
   *
   * Newlines are collapsed because the authored text has one in it and this is a
   * single-line readout.
   */
  const onUserData = (event: SsUserDataEvent) => {
    const payloads: string[] = []
    if (event.hasInteger) payloads.push(`int=${event.integer}`)
    if (event.hasPoint) payloads.push(`point=(${event.pointX}, ${event.pointY})`)
    if (event.hasRect) {
      const r = event.rect
      payloads.push(`rect=(${r.x}, ${r.y} ${r.width}×${r.height})`)
    }
    if (event.hasText) payloads.push(`text="${event.text.replace(/\s+/g, ' ').trim()}"`)
    pushEvent(
      `f${event.frameNo} ${event.partName}: ${payloads.length > 0 ? payloads.join(', ') : 'no payload'}`
    )
  }

  /**
   * One line per active signal — **and its parameter values**, which is the half
   * worth looking at.
   *
   * The command name arrives whatever happens; the values are what a wrongly
   * read union gets wrong, because the authored `type` and the FlatBuffers union
   * tag are offset by one. `text="文字列"` on `test_cmd` is the canary.
   */
  const onSignal = (event: SsSignalEvent) => {
    const params = event.params.map(formatSignalParam).join(', ')
    pushEvent(`f${event.frameNo} ${event.partName}: ${event.commandId}(${params})`)
  }
  useEffect(() => {
    const loadedPlayer = ref.current?.player
    if (loadedPlayer == null) return
    setLoaded({
      file,
      names: loadedPlayer.getAnimationNames(),
      // Which animation the load actually settled on — the only way to show the
      // right thing in the picker when the subject named none.
      current: loadedPlayer.currentAnimation ?? '',
    })
  }, [loadSeq, file])

  // Polled rather than pushed: the counts change in C++ destructors, which have
  // nothing to notify from. Two relaxed atomic loads a second is not a cost, and
  // watching them live is what makes the pack/animation toggles above double as
  // a leak check — switch either and both numbers must come straight back down.
  //
  // The poll keeps the *previous* object when nothing changed, which matters
  // more than it looks: returning a fresh one each tick would re-render this
  // screen twice a second, and a frame here is meant to cost no React render at
  // all. Handle counts move on load and teardown, so in a steady state this
  // settles to zero renders.
  const [live, setLive] = useState(() => ssLiveHandles())
  useEffect(() => {
    const id = setInterval(() => {
      setLive((prev) => {
        const next = ssLiveHandles()
        return prev.resources === next.resources &&
          prev.contexts === next.contexts
          ? prev
          : next
      })
    }, 500)
    return () => clearInterval(id)
  }, [])

  const runLeakCheck = async () => {
    setChecking(true)
    setLeak(null)
    try {
      const result = await ssCheckForLeaks(source, {
        cycles: 8,
        animation,
      })
      // Both numbers, not just the verdict: which one stayed high says where the
      // leak is — a stuck context is a player that was never disposed, a stuck
      // resource with contexts back at baseline is a `.ssab` released out of
      // order. The mounted player above is included in both readings, so the
      // baseline is whatever it happens to be, not zero.
      //
      // The registry line is the same question one level up, and the one the
      // handle counts cannot answer: those cycles are eight *players*, while
      // this is eight loads into one, which is what `load()`'s "replaces
      // whatever was loaded before" claims to survive.
      const line =
        `${result.leaked || result.registryLeaked ? 'LEAKED' : 'clean'} after ` +
        `${result.cycles} cycles — ` +
        `resources ${result.before.resources}→${result.after.resources}, ` +
        `contexts ${result.before.contexts}→${result.after.contexts}, ` +
        `paints ${result.texturesAfterFirstLoad}→${result.texturesAfterReloads}`
      setLeak(line)
      // Also to the log, because on a real device reading a line off the screen
      // is the awkward part of running this — `npx react-native log-ios` /
      // `adb logcat` will carry it off the handset.
      console.log(`[leak check] ${line}`)
    } catch (e) {
      setLeak(`leak check failed: ${String(e)}`)
    } finally {
      setChecking(false)
    }
  }

  const onLayout = (event: LayoutChangeEvent) => {
    setSize(event.nativeEvent.layout)
  }

  // The measured table is now a *`frame` prop*, not arithmetic this screen has
  // to do: `fit` takes the box and lands it in the view. The numbers stayed
  // because supplying the box is the documented way to skip the measurement,
  // and this screen switches packs often enough to care — `measureFrames` on
  // `ParticleEffect` alone would be 240 bakes per switch.
  //
  // `height`/`centerY` are what was measured, so the box is reconstructed from
  // them. Its width is left at the height: `fit="contain"` takes the tighter
  // axis, and the vertical one is the one every entry here was measured on.
  const box =
    frame == null
      ? undefined
      : {
          x: -frame.height / 2,
          y: frame.centerY - frame.height / 2,
          width: frame.height,
          height: frame.height,
        }

  return (
    <View style={styles.root}>
      <View style={styles.stage} onLayout={onLayout}>
        {size.height > 0 && (
          <SpriteStudioView
            ref={ref}
            style={StyleSheet.absoluteFill}
            source={source}
            animation={animation}
            playing={playing}
            speed={speed}
            flipX={flipX}
            fit="contain"
            frame={box}
            onLoad={onLoad}
            onUserData={onUserData}
            onAudio={onAudio}
            onSignal={onSignal}
            onAnimationStarted={(a) => pushEvent(`▶ ${a} started`)}
            onAnimationChanged={(a) => pushEvent(`⇄ ${a}`)}
            onAnimationLooped={(a) => pushEvent(`↻ ${a} looped`)}
            onAnimationFinished={(a) => pushEvent(`■ ${a} finished`)}
            onError={(e) => setError(String(e))}
          />
        )}
      </View>

      {/*
        Scrollable and capped rather than flexed, so the stage keeps most of the
        screen and the panel can never push its own last rows — the texture
        toggle, the leak check — off the bottom on a short handset. The animation
        picker is a dropdown precisely so this list does not have to grow with
        the pack: Ringo's 24 names would otherwise have wrapped to more rows than
        every other control put together.
      */}
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {error != null && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.label}>Subject</Text>
        <Dropdown
          value={subjectName}
          options={SUBJECT_NAMES}
          onSelect={setSubjectName}
        />
        {/* Only where there is a choice to make. Every subject but
            `ParticleEffect` holds one `.ssab`, and a one-entry picker would be
            a control that does nothing. */}
        {fileNames.length > 1 && (
          <>
            <Text style={styles.label}>{`Pack file — ${fileNames.length} in ${subject.pack}`}</Text>
            <Dropdown
              value={file}
              options={fileNames}
              onSelect={(name) => setPickedFile({ subject: subjectName, name })}
            />
          </>
        )}
        <Text style={styles.label}>
          {/* Named even when empty, so "nothing to pick" reads as a state
              rather than as a missing control. */}
          {animationNames.length > 0
            ? `Animation — ${animationNames.length} in ${file}.ssab`
            : 'Animation — reading the .ssab…'}
        </Text>
        <Dropdown
          value={currentAnimation}
          options={animationNames}
          placeholder="reading the .ssab…"
          onSelect={(name) => setPicked({ file, name })}
        />
        <Text style={styles.label}>
          {embeddedDir == null ? 'Textures — this pack ships reference only' : 'Textures'}
        </Text>
        <View style={styles.row}>
          {MODES.map((m) => (
            <Choice
              key={m}
              active={mode === m && !(m === 'embedded' && embeddedDir == null)}
              disabled={m === 'embedded' && embeddedDir == null}
              onPress={() => setMode(m)}
            >
              {m === 'embedded' ? 'embedded (in .ssab)' : 'reference (sibling file)'}
            </Choice>
          ))}
        </View>
        <View style={styles.row}>
          <Choice active={playing} onPress={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </Choice>
          <Choice active={false} onPress={() => ref.current?.player?.stop()}>
            Stop
          </Choice>
          <Choice active={flipX} onPress={() => setFlipX((f) => !f)}>
            Flip X
          </Choice>
        </View>
        <Text style={styles.label}>Speed</Text>
        <View style={styles.row}>
          {[0.25, 0.5, 1, 2].map((s) => (
            <Choice key={s} active={speed === s} onPress={() => setSpeed(s)}>
              {`${s}x`}
            </Choice>
          ))}
        </View>

        {/* Audio and signals share one list: both are authored keys the playhead
            crossed, and the line format says which. Shown only where there are
            any — an always-present empty box would read as "no keys arrived" on
            the subjects that author none, which is most of them. */}
        {audio.length > 0 && (
          <>
            <Text style={styles.label}>Event keys</Text>
            {audio.map((line, i) => (
              <Text key={`${line}-${i}`} style={styles.ok}>
                {line}
              </Text>
            ))}
          </>
        )}

        <Text style={styles.label}>
          {`Native handles — resources ${live.resources}, contexts ${live.contexts}`}
        </Text>
        <View style={styles.row}>
          <Choice active={checking} onPress={runLeakCheck}>
            {checking ? 'Checking…' : 'Leak check'}
          </Choice>
        </View>
        {leak != null && (
          <Text style={leak.startsWith('clean') ? styles.ok : styles.error}>
            {leak}
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

/**
 * A pull-down picker, built from `Modal` rather than a native select.
 *
 * React Native ships no select control, and the usual answer
 * (`@react-native-picker/picker`) is a native module: it would mean a pod
 * install, a Gradle sync and a rebuild of both platforms to add one widget to a
 * demo screen, in a project that already has autolinking traps written down.
 * This costs no dependency and no native build, and for a 24-entry list a
 * scrollable sheet reads better than a wheel anyway.
 *
 * Empty options render as a disabled field rather than an empty menu, so
 * "nothing to choose yet" cannot be mistaken for a broken control.
 */
function Dropdown({
  value,
  options,
  onSelect,
  placeholder,
}: {
  value: string
  options: readonly string[]
  onSelect: (value: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const empty = options.length === 0

  return (
    <>
      <Pressable
        style={[styles.dropdown, empty && styles.dropdownEmpty]}
        onPress={() => {
          if (!empty) setOpen(true)
        }}
      >
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {empty ? (placeholder ?? '—') : value}
        </Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        // Required on Android, where the hardware back button closes the modal
        // through this and nothing else.
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/*
            The sheet swallows its own taps. Without it the backdrop's press
            handler fires for every tap that lands inside, closing the menu
            before the option under the finger can be chosen.
          */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.option, option === value && styles.optionActive]}
                  onPress={() => {
                    onSelect(option)
                    setOpen(false)
                  }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      option === value && styles.optionTextActive,
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

function Choice({
  active,
  disabled = false,
  onPress,
  children,
}: {
  active: boolean
  /** Dimmed and inert — the option exists for this control but not for what is
   *  selected, which is a different thing from it not existing at all. */
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable
      style={[styles.choice, active && styles.choiceActive, disabled && styles.choiceDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },
  stage: { flex: 1 },
  // maxHeight, not flex: the stage keeps the rest, and the panel scrolls when
  // its own content (a 24-entry animation picker) will not fit.
  panel: { backgroundColor: '#1a1a20', maxHeight: '55%' },
  panelContent: { padding: 16, gap: 8 },
  label: { color: '#8e8e93', fontSize: 12, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2c2c34',
  },
  choiceActive: { backgroundColor: '#0a84ff' },
  choiceDisabled: { opacity: 0.35 },

  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2c2c34',
  },
  dropdownEmpty: { opacity: 0.5 },
  dropdownValue: { color: '#f2f2f7', fontSize: 15, flexShrink: 1 },
  dropdownCaret: { color: '#8e8e93', fontSize: 13 },
  backdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'center',
    padding: 32,
  },
  sheet: {
    backgroundColor: '#1a1a20',
    borderRadius: 12,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  option: { paddingVertical: 12, paddingHorizontal: 18 },
  optionActive: { backgroundColor: '#0a84ff' },
  optionText: { color: '#c7c7cc', fontSize: 15 },
  optionTextActive: { color: '#ffffff', fontWeight: '600' },
  choiceText: { color: '#c7c7cc', fontSize: 14 },
  choiceTextActive: { color: '#fff', fontWeight: '600' },
  error: { color: '#ff6961', fontSize: 13 },
  ok: { color: '#30d158', fontSize: 13 },
})
