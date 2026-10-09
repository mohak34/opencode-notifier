import { basename } from "path"
import { loadConfig } from "./config"
import type { EventType, NotifierConfig } from "./config"
import { claimDelivery } from "./claim"
import { extractAgentNameFromSessionTitle, handleEvent, shouldResolveSessionContextForEvent } from "./delivery"
import { shouldSuppressPermissionAlert, prunePermissionAlertState } from "./permission-dedupe"

// Allow immediate auto-approval to settle before checking the pending list.
export const PERMISSION_PENDING_GRACE_MS = 300
const IDLE_COMPLETE_DELAY_MS = 350
// OpenCode resumes a parent with its children's results right after the last one stops. The V1 idle
// debounce alone is 350 ms, so 2 s leaves room for the parent's busy event while still alerting soon
// for a parent that never resumes.
export const CHILDREN_SETTLE_MS = 2000

export interface SessionInfo {
  // A failed lookup must never turn a deleted child into a parent.
  isChild: boolean | null
  title: string | null
  agentName?: string | null
}

export interface SessionAccess {
  info(sessionID: string): Promise<SessionInfo>
  elapsed(sessionID: string, now: number): Promise<number | null>
  permissionPending(sessionID: string | null, permissionID: string): Promise<boolean>
}

export type Delivery = "all" | "terminal" | "command"

// key identifies the host event behind an alert. Terminals on one machine share it, so only one delivers.
interface NotifyOptions {
  title?: string | null
  now?: number
  key?: string
  // Rechecked after lookups, right before delivery.
  valid?: () => boolean
}

// Each host instance owns its timers and session state. The adapters only translate API data.
export function createNotifier(access: SessionAccess, directory: string, delivery: Delivery = "all") {
  const children = new Set<string>()
  const sequences = new Map<string, number>()
  const errors = new Set<string>()
  const touched = new Map<string, number>()
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const parents = new Map<string, string>()
  const running = new Set<string>()
  // timer drops the alert at deferredCompleteTimeout; grace runs while no descendant is running.
  const pending = new Map<string, {
    title: string | null
    key?: string
    timer: ReturnType<typeof setTimeout>
    grace?: ReturnType<typeof setTimeout>
  }>()
  let disposed = false

  function config(): NotifierConfig {
    const value = loadConfig()
    if (delivery === "all") return value
    const local = structuredClone(value)
    if (delivery === "command") {
      local.suppressWhenFocused = false
      for (const event of Object.values(local.events)) {
        event.notification = false
        event.sound = false
        event.bell = false
      }
    } else {
      local.command.enabled = false
    }
    return local
  }

  function invalidate(sessionID: string): number {
    touched.set(sessionID, Date.now())
    const sequence = (sequences.get(sessionID) ?? 0) + 1
    sequences.set(sessionID, sequence)
    clearTimeout(idleTimers.get(sessionID))
    idleTimers.delete(sessionID)
    drop(sessionID)
    return sequence
  }

  function drop(sessionID: string) {
    const deferred = pending.get(sessionID)
    if (!deferred) return
    clearTimeout(deferred.timer)
    clearTimeout(deferred.grace)
    pending.delete(sessionID)
  }

  async function notify(event: EventType, sessionID: string | null = null, { title, now = Date.now(), key, valid }: NotifyOptions = {}) {
    if (disposed) return
    const current = config()
    // Do not count a server event that has no command to deliver.
    if (delivery === "command" && (!current.command.enabled || !current.command.path || !current.events[event].command)) return
    const lifecycleEvent = event === "session_started" || event === "user_message"
    let elapsed: number | null = null
    if (!lifecycleEvent && sessionID && (current.minDuration > 0 || (current.command.enabled && (current.command.minDuration ?? 0) > 0))) {
      elapsed = await access.elapsed(sessionID, now)
    }
    let sessionTitle = title ?? null
    let agentName: string | null = null
    if (sessionID && ((!sessionTitle && current.showSessionTitle) || shouldResolveSessionContextForEvent(current, event))) {
      const info = await access.info(sessionID)
      sessionTitle ??= info.title
      agentName = info.agentName ?? null
    }
    if (disposed || (valid && !valid())) return
    if (key && delivery === "terminal" && !claimDelivery(`${directory}\0${key}`)) return
    const project = directory ? (current.showFullPath ? directory : basename(directory)) : null
    await handleEvent(current, event, project, elapsed, sessionTitle, sessionID, agentName ?? extractAgentNameFromSessionTitle(sessionTitle))
  }

  function track(sessionID: string, parentID?: string | null) {
    touched.set(sessionID, Date.now())
    if (parentID) {
      children.add(sessionID)
      parents.set(sessionID, parentID)
    }
  }

  function hasRunningChildren(parentID: string): boolean {
    for (const id of running) {
      const seen = new Set<string>([id])
      let ancestor = parents.get(id)
      while (ancestor && !seen.has(ancestor)) {
        if (ancestor === parentID) return true
        seen.add(ancestor)
        ancestor = parents.get(ancestor)
      }
    }
    return false
  }

  // A parent whose descendants all stopped alerts after a grace, unless it resumes first. Its next
  // busy drops the alert and its next idle decides again.
  function startGrace() {
    for (const [id, deferred] of pending) {
      if (deferred.grace || hasRunningChildren(id)) continue
      const sequence = sequences.get(id)
      const grace = setTimeout(() => {
        if (pending.get(id) !== deferred || deferred.grace !== grace) return
        deferred.grace = undefined
        if (hasRunningChildren(id)) return
        drop(id)
        void notify("complete", id, { title: deferred.title, key: deferred.key, valid: () => sequences.get(id) === sequence })
          .catch(() => undefined)
      }, CHILDREN_SETTLE_MS)
      grace.unref()
      deferred.grace = grace
    }
  }

  // A descendant that starts during grace holds the alert until it stops again.
  function holdGrace() {
    for (const [id, deferred] of pending) {
      if (!deferred.grace || !hasRunningChildren(id)) continue
      clearTimeout(deferred.grace)
      deferred.grace = undefined
    }
  }

  async function complete(sessionID: string, sequence: number, now: number, key?: string) {
    if (disposed || sequences.get(sessionID) !== sequence) return
    if (errors.delete(sessionID)) return
    if (children.has(sessionID)) {
      await notify("subagent_complete", sessionID, { now, key })
      return
    }
    const info = await access.info(sessionID)
    if (disposed || sequences.get(sessionID) !== sequence || errors.delete(sessionID)) return
    if (info.isChild === null) return
    if (info.isChild) children.add(sessionID)
    const current = config()
    if (!info.isChild && current.deferCompleteUntilChildrenIdle && hasRunningChildren(sessionID)) {
      // Expiry drops the pending alert; it must not claim completion while work is still active.
      const timer = setTimeout(() => drop(sessionID), current.deferredCompleteTimeout)
      timer.unref()
      pending.set(sessionID, { title: info.title, key, timer })
      return
    }
    await notify(info.isChild ? "subagent_complete" : "complete", sessionID, { title: info.title, now, key })
  }

  // Bound tombstones and run state without discarding a live lookup or pending idle.
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 5 * 60_000
    prunePermissionAlertState(cutoff)
    for (const [id, lastSeen] of touched) {
      if (lastSeen >= cutoff || idleTimers.has(id) || running.has(id) || pending.has(id) || hasRunningChildren(id)) continue
      touched.delete(id)
      children.delete(id)
      sequences.delete(id)
      errors.delete(id)
      parents.delete(id)
    }
  }, 5 * 60_000)
  cleanup.unref()

  return {
    notify,
    track,
    async created(id: string | null, parentID: string | null, title: string | null, key?: string) {
      if (id) track(id, parentID)
      if (id && parentID) {
        running.add(id)
        holdGrace()
      }
      if (!parentID) await notify("session_started", id, { title, key })
    },
    busy(id: string) {
      invalidate(id)
      errors.delete(id)
      running.add(id)
      holdGrace()
    },
    async idle(id: string | null, immediate = true, key?: string) {
      if (disposed) return
      if (!id) return notify("complete")
      const sequence = invalidate(id)
      running.delete(id)
      const now = Date.now()
      if (immediate) {
        await complete(id, sequence, now, key)
        startGrace()
        return
      }
      idleTimers.set(id, setTimeout(() => {
        idleTimers.delete(id)
        void complete(id, sequence, now, key).then(startGrace).catch(() => undefined)
      }, IDLE_COMPLETE_DELAY_MS))
    },
    stopped(id: string) {
      invalidate(id)
      running.delete(id)
      startGrace()
    },
    async failed(id: string | null, event: "error" | "user_cancelled", key?: string) {
      if (id) {
        invalidate(id)
        errors.add(id)
        running.delete(id)
      }
      await notify(event, id, { key })
      startGrace()
    },
    async permission(id: string | null, requestID: string | null, legacyHook = false, key?: string) {
      if (requestID) {
        await new Promise(resolve => setTimeout(resolve, PERMISSION_PENDING_GRACE_MS))
        if (disposed || !(await access.permissionPending(id, requestID))) return
      }
      if (disposed) return
      // V1 has two permission sources. V2 adapters dedupe by request identity.
      if (legacyHook && shouldSuppressPermissionAlert(id)) return
      await notify("permission", id, { key })
    },
    async userMessage(id: string | null, verifyParent = false, key?: string) {
      if (id && children.has(id)) return
      if (id && verifyParent) {
        const info = await access.info(id)
        if (info.isChild !== false) return
      }
      await notify("user_message", id, { key })
    },
    dispose() {
      disposed = true
      clearInterval(cleanup)
      for (const timer of idleTimers.values()) clearTimeout(timer)
      idleTimers.clear()
      children.clear()
      sequences.clear()
      errors.clear()
      touched.clear()
      for (const id of [...pending.keys()]) drop(id)
      parents.clear()
      running.clear()
    },
  }
}
