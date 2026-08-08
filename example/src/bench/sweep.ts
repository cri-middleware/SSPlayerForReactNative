import type { Variant } from './variants'

/** One measured configuration. */
export interface SweepResult {
  variant: Variant
  instances: number
  fps: number
  cpuMs: number
  drawMs: number
  vertices: number
}

/** One configuration to measure. */
export interface SweepStep {
  variant: Variant
  instances: number
}

/**
 * The measurement matrix.
 *
 * Instance counts rather than a heavier asset: see the note on `App` for why
 * scaling Normal geometry is the conservative way to reach particle-scale
 * vertex counts.
 */
export function buildSweep(variants: Variant[], instanceCounts: number[]): SweepStep[] {
  const steps: SweepStep[] = []
  for (const variant of variants) {
    for (const instances of instanceCounts) {
      steps.push({ variant, instances })
    }
  }
  return steps
}

/** Milliseconds to discard before recording, so a step is not measured mid-warm-up. */
export const SWEEP_WARMUP_MS = 700
/** Milliseconds to record per step. */
export const SWEEP_MEASURE_MS = 1800

export function formatSweep(results: SweepResult[]): string {
  const header = 'variant       inst   fps   cpu_ms  draw_ms   verts'
  const rows = results.map(
    (r) =>
      `${r.variant.padEnd(13)}${String(r.instances).padStart(4)}  ${r.fps
        .toFixed(1)
        .padStart(5)}  ${r.cpuMs.toFixed(2).padStart(7)}  ${r.drawMs
        .toFixed(2)
        .padStart(7)}  ${String(r.vertices).padStart(6)}`
  )
  return [header, ...rows].join('\n')
}
