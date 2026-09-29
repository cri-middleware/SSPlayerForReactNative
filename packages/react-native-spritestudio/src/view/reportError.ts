/**
 * Hands `error` to the caller's `onError`, or says it where a developer looks.
 *
 * Without the fallback a pack that failed to load, or a frame loop that
 * stopped, is a blank rectangle with nothing in the log — which reads as a
 * renderer fault rather than a wrong path.
 */
export function reportError(
  onError: ((error: unknown) => void) | undefined,
  error: unknown,
  what: string
): void {
  if (onError != null) {
    onError(error)
    return
  }
  console.error(
    `react-native-spritestudio: ${what}. Pass onError to handle it yourself.`,
    error
  )
}
