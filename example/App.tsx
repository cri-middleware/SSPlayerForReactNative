import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  BlendMode,
  Canvas,
  FilterMode,
  MipmapMode,
  Picture,
  Skia,
  TileMode,
  useImage,
  type SkCanvas,
  type SkPicture,
} from '@shopify/react-native-skia'
import { useSharedValue } from 'react-native-reanimated'
import {
  SsRuntimeModule,
  type SsContext,
  type SsResource,
} from '@spritestudio/react-native-ssplayer'

import { resolveAssetPath } from './src/bench/asset'
import {
  buildSweep,
  formatSweep,
  SWEEP_MEASURE_MS,
  SWEEP_WARMUP_MS,
  type SweepResult,
  type SweepStep,
} from './src/bench/sweep'
import {
  bakeInJs,
  bakeInNative,
  drawInNative,
  type BatchGeometry,
  type Variant,
} from './src/bench/variants'

const SSAB = require('./assets/ss/Ringo/Ringo.ssab')
const ANIMATION = 'dance'
const INSTANCE_STEPS = [1, 4, 16, 48, 128]
const VARIANTS: Variant[] = ['js-bake', 'native-bake', 'native-draw']
const VARIANT_LABELS: Record<Variant, string> = {
  'js-bake': '(a) JS bake',
  'native-bake': '(b) native bake',
  'native-draw': '(c) native draw',
}

/**
 * Start the sweep on launch instead of waiting for a tap.
 *
 * A Phase 0 number has to be reproducible by someone who was not here, and
 * "open the app, wait, tap this" is not that. Set to false to poke at the
 * variants by hand.
 */
const AUTO_SWEEP = true

/**
 * Phase 0 measurement harness (design doc ch.8).
 *
 * What it answers: where the L1/L2 boundary should sit, measured rather than
 * assumed, because Hermes is not AOT the way Dart is and the Flutter Player's
 * split cannot be assumed to carry over (ch.9 A).
 *
 * How it scales load: by instancing whole players, not by switching to the
 * ParticleEffect asset. The baker draws Normal batches only, and Normal is the
 * *most* per-vertex arithmetic of any batch kind — Effect and Mesh geometry
 * arrives already in world space. So reaching particle-scale vertex counts with
 * Normal geometry is the conservative direction: whatever survives here also
 * survives the same vertex count of particles. Effect's own cost (the
 * EffectDrawPlan walk) is paid identically by every variant, so it cannot move
 * the boundary decision.
 *
 * The sweep exists so a run is reproducible and quotable. Tapping buttons and
 * reading a live counter is not a measurement anyone can put in a README.
 */
export default function App() {
  const [manualVariant, setManualVariant] = useState<Variant>('js-bake')
  const [manualInstances, setManualInstances] = useState(1)
  const [stats, setStats] = useState({ cpuMs: 0, drawMs: 0, fps: 0, vertices: 0, batches: 0 })
  const [error, setError] = useState<string | null>(null)

  const [sweep, setSweep] = useState<SweepStep[] | null>(null)
  const [sweepIndex, setSweepIndex] = useState(0)
  const [results, setResults] = useState<SweepResult[]>([])

  const step = sweep?.[sweepIndex]
  const variant = step?.variant ?? manualVariant
  const instances = step?.instances ?? manualInstances

  // `<Picture>` has no null state, so seed the shared value with an empty
  // recording rather than letting the first frame render before the loop runs.
  const emptyPicture = useMemo(() => {
    const recorder = Skia.PictureRecorder()
    recorder.beginRecording()
    return recorder.finishRecordingAsPicture()
  }, [])
  const picture = useSharedValue<SkPicture>(emptyPicture)
  const image = useImage(require('./assets/ss/Ringo/Ringo.png'))

  const resourceRef = useRef<SsResource | null>(null)
  const contextsRef = useRef<SsContext[]>([])
  // The resource lands asynchronously, so the pool effect below needs a state
  // flag to re-run on — a ref alone would leave it stuck at "not loaded yet".
  const [resourceReady, setResourceReady] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })

  // --- load the .ssab once ------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const path = await resolveAssetPath(SSAB)
        if (cancelled) return
        resourceRef.current = SsRuntimeModule.createResourceFromPath(path)
        setResourceReady(true)
      } catch (e) {
        setError(String(e))
      }
    })()
    return () => {
      cancelled = true
      // Explicit teardown, never GC — the ArrayBuffers JS was handed are
      // borrows of memory these objects own (ch.9 F).
      for (const c of contextsRef.current) c.dispose()
      contextsRef.current = []
      resourceRef.current?.dispose()
      resourceRef.current = null
    }
  }, [])

  // --- (re)build the context pool when the instance count changes ---------
  useEffect(() => {
    const resource = resourceRef.current
    if (resource == null) return
    try {
      for (const c of contextsRef.current) c.dispose()
      const next: SsContext[] = []
      for (let i = 0; i < instances; i++) {
        const ctx = SsRuntimeModule.createContext(resource)
        if (!ctx.setupAnimation(ANIMATION)) {
          throw new Error(`setupAnimation('${ANIMATION}') failed`)
        }
        // Stagger the phase so the instances are not all drawing the identical
        // frame — otherwise the CPU cost is realistic but the fill is not.
        ctx.update(i * 0.03)
        next.push(ctx)
      }
      contextsRef.current = next
    } catch (e) {
      setError(String(e))
    }
  }, [instances, resourceReady])

  // --- the frame loop -----------------------------------------------------
  useEffect(() => {
    if (image == null || size.width === 0) return

    const shader = image.makeShaderOptions(
      TileMode.Clamp,
      TileMode.Clamp,
      FilterMode.Linear,
      MipmapMode.None
    )
    const paint = Skia.Paint()
    paint.setShader(shader)

    let raf = 0
    let last = performance.now()
    const stepStartedAt = last

    let frames = 0
    let cpuAcc = 0
    let drawAcc = 0
    let windowAt = last
    let peakVertices = 0
    let peakBatches = 0
    let recorded = false

    // Tile the instances over the real canvas, which is far from square, so the
    // cell has to follow both axes rather than a single min().
    const columns = Math.ceil(Math.sqrt(instances))
    const rows = Math.ceil(instances / columns)
    const cellW = size.width / columns
    const cellH = size.height / rows
    // Ringo's world origin sits at its feet and the art extends upwards, so the
    // origin belongs near the bottom of its cell once Y is flipped.
    const scale = Math.min(cellW, cellH) / 460

    const resetWindow = (now: number) => {
      frames = 0
      cpuAcc = 0
      drawAcc = 0
      peakVertices = 0
      peakBatches = 0
      windowAt = now
    }

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 1 / 15)
      last = now

      const contexts = contextsRef.current
      if (contexts.length === 0) return

      let vertices = 0
      let batches = 0
      let cpuMs = 0
      let drawMs = 0

      /**
       * The root transform, held in one place (design doc ch.3 C): centre the
       * instance in its cell and flip Y.
       *
       * The flip is here rather than in the bake because this asset is authored
       * Y-up and Skia's canvas is Y-down. ch.3 C's rule is that the flip happens
       * exactly once — folding it into the root transform costs one composition
       * instead of a term on every vertex, and it leaves the geometry below it
       * in player-local space, which is where the mask coverage pass and the
       * SkSL shaders will want it in Phase 2.
       */
      const placeInstance = (canvas: SkCanvas, i: number) => {
        const col = i % columns
        const row = Math.floor(i / columns)
        canvas.translate(col * cellW + cellW / 2, row * cellH + cellH * 0.92)
        canvas.scale(scale, -scale)
      }

      try {
        if (variant === 'native-draw') {
          // (c) has no separate bake phase to time: the bake happens inside the
          // same C++ call as the draw. Everything lands in drawMs, and the
          // like-for-like comparison across variants is cpuMs + drawMs.
          const drawStart = performance.now()
          const recorder = Skia.PictureRecorder()
          const canvas = recorder.beginRecording()
          for (let i = 0; i < contexts.length; i++) {
            const ctx = contexts[i]!
            ctx.update(dt)
            canvas.save()
            placeInstance(canvas, i)
            vertices += drawInNative(ctx, canvas, paint)
            canvas.restore()
          }
          picture.value = recorder.finishRecordingAsPicture()
          drawMs = performance.now() - drawStart
        } else {
          // --- CPU: advance + produce geometry ------------------------------
          const cpuStart = performance.now()
          const perInstance: BatchGeometry[][] = []
          for (const ctx of contexts) {
            ctx.update(dt)
            const geometry = variant === 'js-bake' ? bakeInJs(ctx) : bakeInNative(ctx)
            perInstance.push(geometry)
            batches += geometry.length
            for (const g of geometry) vertices += g.vertexCount
          }
          cpuMs = performance.now() - cpuStart

          // --- draw: record the picture -------------------------------------
          const drawStart = performance.now()
          const recorder = Skia.PictureRecorder()
          const canvas = recorder.beginRecording()
          for (let i = 0; i < perInstance.length; i++) {
            canvas.save()
            placeInstance(canvas, i)
            for (const g of perInstance[i]!) {
              canvas.drawVertices(g.vertices, BlendMode.SrcOver, paint)
            }
            canvas.restore()
          }
          picture.value = recorder.finishRecordingAsPicture()
          drawMs = performance.now() - drawStart
        }
      } catch (e) {
        setError(String(e))
        cancelAnimationFrame(raf)
        return
      }

      const elapsed = now - stepStartedAt

      // Discard the warm-up: the first frames of a step pay for the context
      // pool rebuild, Hermes warming up the bake loop, and Skia's first upload.
      if (sweep != null && elapsed < SWEEP_WARMUP_MS) {
        resetWindow(now)
        return
      }

      frames++
      cpuAcc += cpuMs
      drawAcc += drawMs
      if (vertices > peakVertices) peakVertices = vertices
      if (batches > peakBatches) peakBatches = batches

      if (sweep != null) {
        if (!recorded && elapsed >= SWEEP_WARMUP_MS + SWEEP_MEASURE_MS && frames > 0) {
          recorded = true
          const result: SweepResult = {
            variant,
            instances,
            fps: (frames * 1000) / (now - windowAt),
            cpuMs: cpuAcc / frames,
            drawMs: drawAcc / frames,
            vertices: peakVertices,
          }
          setResults((prev) => [...prev, result])
          setSweepIndex((prev) => prev + 1)
        }
        return
      }

      if (now - windowAt >= 500) {
        setStats({
          cpuMs: cpuAcc / frames,
          drawMs: drawAcc / frames,
          fps: (frames * 1000) / (now - windowAt),
          vertices: peakVertices,
          batches: peakBatches,
        })
        resetWindow(now)
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [image, size, variant, instances, picture, sweep, sweepIndex])

  // The sweep ends when the index walks past the last step.
  useEffect(() => {
    if (sweep != null && sweepIndex >= sweep.length) setSweep(null)
  }, [sweep, sweepIndex])

  const startSweep = useCallback(() => {
    setResults([])
    setSweepIndex(0)
    setSweep(buildSweep(VARIANTS, INSTANCE_STEPS))
  }, [])

  const sweeping = sweep != null

  // Kick the sweep off once everything it needs is up: the resource, the
  // texture, and a laid-out canvas.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!AUTO_SWEEP || autoStarted.current) return
    if (!resourceReady || image == null || size.width === 0) return
    autoStarted.current = true
    startSweep()
  }, [resourceReady, image, size, startSweep])

  return (
    <View style={styles.root}>
      <View style={styles.canvasWrap} onLayout={(e) => setSize(e.nativeEvent.layout)}>
        <Canvas style={StyleSheet.absoluteFill}>
          <Picture picture={picture} />
        </Canvas>
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {error != null && <Text style={styles.error}>{error}</Text>}

        {sweeping ? (
          <Text style={styles.stat}>
            sweep {sweepIndex + 1}/{sweep.length} · {variant} · {instances}x
          </Text>
        ) : (
          <>
            <Text style={styles.stat}>
              {stats.fps.toFixed(1)} fps · CPU {stats.cpuMs.toFixed(2)} ms · draw{' '}
              {stats.drawMs.toFixed(2)} ms
            </Text>
            <Text style={styles.substat}>
              {stats.vertices} verts · {stats.batches} batches / frame
            </Text>
          </>
        )}

        {results.length > 0 && <Text style={styles.table}>{formatSweep(results)}</Text>}

        <Text style={styles.label}>Variant</Text>
        <View style={styles.row}>
          {VARIANTS.map((v) => (
            <Choice
              key={v}
              active={variant === v}
              disabled={sweeping}
              onPress={() => setManualVariant(v)}
            >
              {VARIANT_LABELS[v]}
            </Choice>
          ))}
        </View>

        <Text style={styles.label}>Instances</Text>
        <View style={styles.row}>
          {INSTANCE_STEPS.map((n) => (
            <Choice
              key={n}
              active={instances === n}
              disabled={sweeping}
              onPress={() => setManualInstances(n)}
            >
              {String(n)}
            </Choice>
          ))}
        </View>

        <View style={styles.row}>
          <Choice active={sweeping} disabled={sweeping} onPress={startSweep}>
            {sweeping ? 'Sweeping…' : 'Run sweep'}
          </Choice>
        </View>
      </ScrollView>
    </View>
  )
}

function Choice({
  active,
  disabled,
  onPress,
  children,
}: {
  active: boolean
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
  canvasWrap: { flex: 1 },
  panel: { maxHeight: 380, backgroundColor: '#1a1a20' },
  panelContent: { padding: 16, gap: 8 },
  stat: { color: '#f5f5f7', fontSize: 17, fontVariant: ['tabular-nums'] },
  substat: { color: '#8e8e93', fontSize: 13, fontVariant: ['tabular-nums'] },
  table: {
    color: '#a8e6a3',
    fontSize: 11,
    fontFamily: 'Menlo',
    lineHeight: 15,
    backgroundColor: '#0c0c10',
    padding: 8,
    borderRadius: 6,
  },
  label: { color: '#8e8e93', fontSize: 12, marginTop: 4, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#2c2c34',
  },
  choiceActive: { backgroundColor: '#0a84ff' },
  choiceDisabled: { opacity: 0.5 },
  choiceText: { color: '#c7c7cc', fontSize: 14 },
  choiceTextActive: { color: '#fff', fontWeight: '600' },
  error: { color: '#ff6961', fontSize: 13 },
})
