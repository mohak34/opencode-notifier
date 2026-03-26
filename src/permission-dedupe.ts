const PERMISSION_DEDUPE_WINDOW_MS = 1000

const sessionLastPermissionAt = new Map<string, number>()
let globalLastPermissionAt = 0

export function shouldSuppressPermissionAlert(sessionID: string | null, now: number = Date.now()): boolean {
  const sessionLastAt = sessionID ? sessionLastPermissionAt.get(sessionID) : undefined
  const latestSeen = Math.max(globalLastPermissionAt, sessionLastAt ?? 0)
  const isDuplicate = latestSeen > 0 && now - latestSeen < PERMISSION_DEDUPE_WINDOW_MS

  if (isDuplicate) {
    return true
  }

  globalLastPermissionAt = now
  if (sessionID) {
    sessionLastPermissionAt.set(sessionID, now)
  }

  return false
}

export function prunePermissionAlertState(cutoffMs: number): void {
  for (const [sessionID, timestamp] of sessionLastPermissionAt) {
    if (timestamp < cutoffMs) {
      sessionLastPermissionAt.delete(sessionID)
    }
  }

  if (globalLastPermissionAt < cutoffMs) {
    globalLastPermissionAt = 0
  }
}

export function resetPermissionAlertState(): void {
  sessionLastPermissionAt.clear()
  globalLastPermissionAt = 0
}
