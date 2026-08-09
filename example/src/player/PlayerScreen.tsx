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
  type SpriteStudioViewRef,
} from 'react-native-spritestudio'

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
 * One entry in the *Subject* row: a pack directory, a `.ssab` inside it, and
 * how to frame it.
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
 * `Ringo` is the **character** case, and it is here now because Mesh landed:
 * it is 653 baked vertices against `Basic`'s 80, and 585 of those were missing
 * while Mesh went unbaked. Everything above is a feature under a microscope;
 * Ringo is the thing those features are for, with 24 authored animations to
 * pick from.
 */
interface Subject {
  /** Which pack family; the *Textures* toggle picks the conversion within it. */
  pack: PackName
  ssab: string
  frame: Frame
  /**
   * Which animation to open on. **Omit it** unless the pack's first is the
   * wrong one to show — the player already defaults to the first, so naming it
   * here would only be a second copy of the same fact, and one that a
   * re-conversion can silently invalidate.
   */
  initialAnimation?: string
}

const SUBJECTS = {
  Basic: { pack: 'overall', ssab: 'Basic', frame: CENTRED },
  BlendMode: { pack: 'overall', ssab: 'BlendMode', frame: CENTRED },
  // Its first is `PartsColor_only`, the tint on its own, which is the one to
  // open on: `PartsColor_with_Transparent` adds part opacity and is a second
  // variable, one pick away in the dropdown.
  PartsColor: { pack: 'overall', ssab: 'PartsColor', frame: CENTRED },
  Mask: { pack: 'overall', ssab: 'Mask', frame: CENTRED },
  Mesh: { pack: 'overall', ssab: 'Mesh', frame: CENTRED },
  Ringo: {
    pack: 'Ringo',
    ssab: 'Ringo',
    // Measured across dance/wait1/run/jump: x ∈ [-178, 217], y ∈ [-4, 612].
    // Standing on its origin, so without the shift the feet would sit at the
    // centre of the view and the head would be off the top.
    frame: { height: 700, centerY: 300 },
    // The one subject that names an animation: the pack's first is `attack1`,
    // and a character introducing itself mid-swing is a poor opening frame.
    initialAnimation: 'dance',
  },
} as const satisfies Record<string, Subject>

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
  overall: { embedded: 'ss/overall-embedded', reference: 'ss/overall' },
  Ringo: { embedded: 'ss/Ringo-embedded', reference: 'ss/Ringo' },
} as const

type PackName = keyof typeof PACKS
type Mode = keyof (typeof PACKS)['overall']

const MODES = ['embedded', 'reference'] as const satisfies readonly Mode[]

const SUBJECT_NAMES = Object.keys(SUBJECTS) as SubjectName[]

type SubjectName = keyof typeof SUBJECTS

/**
 * Phase 1's target: the SDK's own reference animation, through the real API.
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
 * Everything the Phase 0 harness did by hand — the context pool, the picture
 * recording, the frame loop, the root transform — is inside
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
  const [subjectName, setSubjectName] = useState<SubjectName>('Basic')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [flipX, setFlipX] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [error, setError] = useState<string | null>(null)
  const [leak, setLeak] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const subject: Subject = SUBJECTS[subjectName]
  const source = `${PACKS[subject.pack][mode]}/${subject.ssab}.ssab`

  // Which animation inside that `.ssab`, and the pack's full list.
  //
  // Both are **tagged with the subject they belong to and derived**, rather than
  // reset from an effect. An effect would leave one render where the source is
  // already the new pack and the name is still the old pack's — the view reloads
  // on both, so that render loads the new `.ssab` and asks it for an animation
  // it does not have. `setAnimation` returns false and nothing else reports it,
  // so the failure would show as an inexplicably blank frame.
  const [picked, setPicked] = useState<{ subject: SubjectName; name: string } | null>(null)
  const [loaded, setLoaded] = useState<{
    subject: SubjectName
    names: string[]
    current: string
  } | null>(null)

  // Left **undefined** when the subject names none, which is most of them: the
  // player then sets up the pack's first, and `loaded.current` reads back which
  // that was. Resolving it here instead would mean either guessing a name before
  // the `.ssab` has been read, or waiting for the names and reloading once they
  // arrived — a second load per subject switch to reach the same frame.
  const animation =
    picked?.subject === subjectName ? picked.name : subject.initialAnimation
  const here = loaded?.subject === subjectName ? loaded : null
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
  }
  useEffect(() => {
    const loadedPlayer = ref.current?.player
    if (loadedPlayer == null) return
    setLoaded({
      subject: subjectName,
      names: loadedPlayer.getAnimationNames(),
      // Which animation the load actually settled on — the only way to show the
      // right thing in the picker when the subject named none.
      current: loadedPlayer.currentAnimation ?? '',
    })
  }, [loadSeq, subjectName])

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
      const line =
        `${result.leaked ? 'LEAKED' : 'clean'} after ${result.cycles} cycles — ` +
        `resources ${result.before.resources}→${result.after.resources}, ` +
        `contexts ${result.before.contexts}→${result.after.contexts}`
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

  // Fit the subject's measured box into the shorter axis, then move the origin
  // so the art's centre lands in the middle of the view rather than the origin
  // itself. `offset` is screen pixels and the root transform flips Y, so a pack
  // standing on its origin (centerY > 0) needs the origin pushed *down*.
  const scale =
    size.height === 0 ? 1 : Math.min(size.width, size.height) / subject.frame.height
  const offset = { x: 0, y: subject.frame.centerY * scale }

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
            scale={scale}
            offset={offset}
            onLoad={onLoad}
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
        <View style={styles.row}>
          {SUBJECT_NAMES.map((s) => (
            <Choice key={s} active={subjectName === s} onPress={() => setSubjectName(s)}>
              {s}
            </Choice>
          ))}
        </View>
        <Text style={styles.label}>
          {/* Named even when empty, so "nothing to pick" reads as a state
              rather than as a missing control. */}
          {animationNames.length > 0
            ? `Animation — ${animationNames.length} in ${subject.ssab}.ssab`
            : 'Animation — reading the .ssab…'}
        </Text>
        <Dropdown
          value={currentAnimation}
          options={animationNames}
          placeholder="reading the .ssab…"
          onSelect={(name) => setPicked({ subject: subjectName, name })}
        />
        <Text style={styles.label}>Textures</Text>
        <View style={styles.row}>
          {MODES.map((m) => (
            <Choice key={m} active={mode === m} onPress={() => setMode(m)}>
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
  onPress,
  children,
}: {
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}>
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
