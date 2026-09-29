import { useMemo, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  SpriteStudioPartAnchor,
  SpriteStudioView,
  type SpriteStudioPlayer,
} from 'react-native-spritestudio'

import { SsAssets } from '../ss-assets'

/**
 * Part-following demo — the React Native counterpart of SSPlayerForWeb's
 * `examples/part-follow`, ForUnity's `SpriteStudioPartTracker` and ForGodot's
 * `SpriteStudioPartAttachment2D`.
 *
 * A fish — a plain 🐟 emoji, no extra asset — is pinned to a part of the "Ringo"
 * character with {@link SpriteStudioPartAnchor}, so it tracks that part's
 * position, rotation and (optionally) scale every frame while the character
 * animates. The player never owns the fish: it is an ordinary view in the
 * `<SpriteStudioView>`'s children, and the anchor finds that view's player.
 *
 * Ringo is a rig with **skinned** (bone-bound) mesh parts — its hands, legs,
 * ears and tail. A skinned part's own transform stays near the character root
 * while its art is drawn by bone skinning, so following one snaps the fish to
 * the root rather than onto the visible mesh. That is not a bug to fix but the
 * shape of the data, and it is the whole reason {@link isPartSkinnedMesh} exists:
 * the picker below flags those parts, and the hook logs a one-time `__DEV__`
 * warning if one is followed anyway — non-blocking, exactly as the sibling
 * editors annotate rather than forbid the choice. Pick one and watch the fish
 * jump to Ringo's centre; the recommended target is a **bone / joint / null**
 * part, whose own node sits where the art is.
 */

/** The one `.ssab` holding every Ringo animation, the same pack ForWeb follows. */
const RINGO = SsAssets['Ringo/Ringo']

/**
 * Preferred motions, in the order ForWeb's demo offers them. Filtered against
 * what the pack actually carries, so a re-convert that renames one drops the
 * button rather than producing a dead one.
 */
const PREFERRED_MOTIONS = ['wait1', 'run', 'attack1', 'dance', 'walk', 'jump']

/** A bone in Ringo's right-hand chain — a good follow target, and ForWeb's default. */
const DEFAULT_TARGET = 'bone_14'

/** The fish's box, in view pixels. Centred on the part, so it spins in place. */
const FISH = 44

export function PartFollowScreen() {
  const [motion, setMotion] = useState(PREFERRED_MOTIONS[0])
  const [target, setTarget] = useState('')
  const [driveScale, setDriveScale] = useState(true)

  const [player, setPlayer] = useState<SpriteStudioPlayer | null>(null)
  const [parts, setParts] = useState<string[]>([])
  const [motions, setMotions] = useState<string[]>([])

  const onLoad = (p: SpriteStudioPlayer) => {
    setPlayer(p)

    // The parts of the current animation, and which of them a follower cannot
    // sit on. An unnamed part holds its slot as `''`, so it is dropped from a
    // picker a human reads.
    setParts(p.partNames().filter((name) => name !== ''))

    // The motions to offer: the curated set where it exists, else the pack's
    // first few — either way read from the `.ssab` rather than hard-coded.
    const all = p.getAnimationNames()
    const preferred = PREFERRED_MOTIONS.filter((name) => all.includes(name))
    setMotions(preferred.length > 0 ? preferred : all.slice(0, 6))

    // Default the target once, to a bone if the pack has the one ForWeb uses,
    // else the first part a follower can actually track. Left alone afterwards
    // so switching motion keeps the user's pick.
    setTarget((current) => {
      if (current !== '') return current
      if (p.findPartIndex(DEFAULT_TARGET) >= 0 && !p.isPartSkinnedMesh(DEFAULT_TARGET)) {
        return DEFAULT_TARGET
      }
      const followable = p
        .partNames()
        .find((name) => name !== '' && !p.isPartSkinnedMesh(name))
      return followable ?? p.partNames().find((name) => name !== '') ?? ''
    })
  }

  // The follow-target picker's rows: every named part, tagged with whether it is
  // a poor target. Recomputed when the part list or the player changes.
  const options = useMemo<{ name: string; skinned: boolean }[]>(() => {
    if (player == null) return []
    return parts.map((name) => ({
      name,
      skinned: player.isPartSkinnedMesh(name),
    }))
  }, [player, parts])

  const targetKnown = player != null && player.findPartIndex(target) >= 0
  const targetSkinned = player != null && player.isPartSkinnedMesh(target)

  const warning = !targetKnown
    ? `"${target}" is not a part of this motion — the fish is hidden until it is.`
    : targetSkinned
      ? `"${target}" is a skinned (bone-bound) mesh. Its transform stays near ` +
        `Ringo's centre, so the fish will not sit on the visible art. Follow a ` +
        `NULL / bone / joint part at that spot instead.`
      : null

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <SpriteStudioView
          style={StyleSheet.absoluteFill}
          source={RINGO}
          animation={motion}
          playing
          fit="contain"
          // No frame and nothing measured: the view fits the canvas of the
          // animation it loaded on, which Ringo's pivot puts above the feet, and
          // keeps it when the motion changes under a fish that is meant to stay
          // put.
          onLoad={onLoad}
        >
          {/*
            The anchor pins the fish's top-left corner to the part and turns it
            about that point; the negative margins put the emoji's middle there
            instead, so it spins in place. It is hidden until the part resolves
            — and stays hidden for a name the animation does not carry.
          */}
          <SpriteStudioPartAnchor partName={target} scale={driveScale}>
            <Text style={styles.fish}>🐟</Text>
          </SpriteStudioPartAnchor>
        </SpriteStudioView>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Text style={styles.title}>Part following — a fish pinned to Ringo</Text>

        <Text style={styles.label}>Follow target</Text>
        <PartPicker
          value={target}
          options={options}
          onSelect={setTarget}
          placeholder={player == null ? 'loading Ringo…' : 'no parts'}
        />
        {warning != null && <Text style={styles.warn}>⚠ {warning}</Text>}

        <Text style={styles.label}>Motion</Text>
        <View style={styles.row}>
          {motions.map((name) => (
            <Choice key={name} active={motion === name} onPress={() => setMotion(name)}>
              {name}
            </Choice>
          ))}
        </View>

        <Text style={styles.label}>Follow</Text>
        <View style={styles.row}>
          <Choice active={driveScale} onPress={() => setDriveScale((s) => !s)}>
            {driveScale ? 'position + rotation + scale' : 'position + rotation'}
          </Choice>
        </View>

        <Text style={styles.hint}>
          Pick a skinned mesh part (tagged below) to see the fish snap to Ringo's
          centre — and a one-time warning in the dev console. A bone / joint /
          null part follows the art correctly.
        </Text>
      </ScrollView>
    </View>
  )
}

/**
 * The follow-target dropdown. Every named part is offered; a skinned mesh is
 * tagged and dimmed — the same soft filter ForUnity's and ForGodot's inspectors
 * apply — but still selectable, so the demo can show what following one does.
 */
function PartPicker({
  value,
  options,
  onSelect,
  placeholder,
}: {
  value: string
  options: { name: string; skinned: boolean }[]
  onSelect: (value: string) => void
  placeholder: string
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
          {empty ? placeholder : value}
        </Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  key={option.name}
                  style={[styles.option, option.name === value && styles.optionActive]}
                  onPress={() => {
                    onSelect(option.name)
                    setOpen(false)
                  }}
                >
                  <Text
                    style={[
                      styles.optionText,
                      option.name === value && styles.optionTextActive,
                      option.skinned && styles.optionSkinned,
                    ]}
                  >
                    {option.skinned ? `${option.name}   (skinned mesh — poor target)` : option.name}
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
  fish: {
    width: FISH,
    height: FISH,
    marginLeft: -FISH / 2,
    marginTop: -FISH / 2,
    fontSize: 30,
    lineHeight: FISH,
    textAlign: 'center',
  },
  panel: { backgroundColor: '#1a1a20', maxHeight: '52%' },
  panelContent: { padding: 16, gap: 8 },
  title: { color: '#f2f2f7', fontSize: 16, fontWeight: '600' },
  label: { color: '#8e8e93', fontSize: 12, textTransform: 'uppercase' },
  hint: { color: '#8e8e93', fontSize: 12, lineHeight: 17 },
  warn: { color: '#ffd426', fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2c2c34',
  },
  choiceActive: { backgroundColor: '#0a84ff' },
  choiceText: { color: '#c7c7cc', fontSize: 14 },
  choiceTextActive: { color: '#fff', fontWeight: '600' },
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
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 32 },
  sheet: { backgroundColor: '#1a1a20', borderRadius: 12, maxHeight: '70%', overflow: 'hidden' },
  option: { paddingVertical: 12, paddingHorizontal: 18 },
  optionActive: { backgroundColor: '#0a84ff' },
  optionText: { color: '#c7c7cc', fontSize: 15 },
  optionTextActive: { color: '#ffffff', fontWeight: '600' },
  optionSkinned: { color: '#8e8e93', fontStyle: 'italic' },
})
