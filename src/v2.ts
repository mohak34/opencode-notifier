import type { Plugin } from "@opencode/plugin"
import type { LocationRef, OpenCodeEvent } from "@opencode/client"
import { debugFocusState as debug } from "./focus"
import { createNotifier } from "./notifier"
import type { Delivery } from "./notifier"

type Client = {
  session: Pick<Plugin.Context["session"], "get" | "context">
  permission: Pick<Plugin.Context["permission"], "list">
}

export function createV2Notifier(client: Client, location: LocationRef, delivery: Delivery) {
  const notifier = createNotifier({
    async info(sessionID) {
      try {
        const session = await client.session.get({ sessionID })
        return { isChild: !!session.parentID, title: session.title ?? null, agentName: session.parentID ? session.agent ?? null : null }
      } catch {
        return { isChild: null, title: null }
      }
    },
    async elapsed(sessionID, now) {
      try {
        const messages = await client.session.context({ sessionID })
        const times = messages.flatMap(message => message.type === "user" ? [message.time.created] : [])
        return times.length ? (now - Math.max(...times)) / 1000 : null
      } catch {
        return null
      }
    },
    async permissionPending(sessionID, permissionID) {
      if (!sessionID) return true
      try {
        return (await client.permission.list({ sessionID })).some(request => request.id === permissionID)
      } catch {
        return true
      }
    },
  }, location.directory, delivery)
  const seen = new Set<string>()
  const owned = new Map<string, Promise<boolean>>()
  let disposed = false

  function here(other: { directory: string; workspaceID?: string }) {
    return other.directory === location.directory && other.workspaceID === location.workspaceID
  }

  // Some V2 events carry only a sessionID, so ownership comes from the session itself.
  // Lookup failures fail open and are retried on the next event.
  function ours(sessionID: string) {
    let result = owned.get(sessionID)
    if (!result) {
      result = client.session.get({ sessionID }).then(
        session => !session.location || here(session.location),
        () => {
          debug(`v2 session ${sessionID}: lookup failed, delivering`)
          owned.delete(sessionID)
          return true
        },
      )
      owned.set(sessionID, result)
      if (owned.size > 2048) {
        const oldest = owned.keys().next().value
        if (oldest !== undefined) owned.delete(oldest)
      }
    }
    return result
  }

  function first(key: string) {
    if (seen.has(key)) return false
    seen.add(key)
    // Event identities bound replay dedupe without retaining whole event payloads.
    if (seen.size > 2048) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }
    return true
  }

  return {
    connected: () => notifier.notify("client_connected"),
    async event(event: OpenCodeEvent) {
      try {
        if (disposed) return
        const sessionID = event.type === "form.created" ? event.data.form.sessionID : "sessionID" in event.data ? event.data.sessionID : undefined
        const cached = sessionID ? owned.get(sessionID) : undefined
        if (sessionID && (event.type === "session.moved" || event.type === "session.deleted")) owned.delete(sessionID)
        // A deleted session can no longer be looked up, so only a cached answer can drop it.
        const mine = event.location ? here(event.location)
          : !sessionID ? true
          : event.type === "session.deleted" ? !cached || await cached
          : await ours(sessionID)
        if (!mine) {
          debug(`v2 ${event.type}: session ${sessionID ?? "none"} belongs to another location, skipping`)
          return
        }
        switch (event.type) {
          case "session.created":
            if (first(`created:${event.data.sessionID}`)) {
              await notifier.created(event.data.sessionID, event.data.parentID ?? null, event.data.title ?? null, `created:${event.data.sessionID}`)
            }
            break
          case "session.execution.started":
            notifier.busy(event.data.sessionID)
            break
          case "session.execution.succeeded":
            if (first(`complete:${event.id}`)) await notifier.idle(event.data.sessionID, true, `complete:${event.id}`)
            break
          case "session.execution.failed":
            if (first(`failed:${event.id}`)) await notifier.failed(event.data.sessionID, "error", `failed:${event.id}`)
            break
          case "session.execution.interrupted":
            // Shutdown, supersession and inactivity are not user cancellations or failures.
            if (event.data.reason === "user" && first(`cancelled:${event.id}`)) {
              await notifier.failed(event.data.sessionID, "user_cancelled", `cancelled:${event.id}`)
            } else if (event.data.reason !== "user" && first(`stopped:${event.id}`)) {
              await notifier.stopped(event.data.sessionID)
            }
            break
          case "session.deleted":
            await notifier.stopped(event.data.sessionID)
            break
          case "permission.asked":
            if (first(`permission:${event.data.id}`)) await notifier.permission(event.data.sessionID, event.data.id, false, `permission:${event.data.id}`)
            break
          case "session.inbox.enqueued":
            if (event.data.item.type === "user" && first(`message:${event.data.inboxID}`)) {
              await notifier.userMessage(event.data.sessionID, true, `message:${event.data.inboxID}`)
            }
            break
          case "form.created":
            if (event.data.form.metadata?.kind === "question" && first(`form:${event.data.form.id}`)) {
              await notifier.notify("question", event.data.form.sessionID, { key: `form:${event.data.form.id}` })
            }
            break
          // V2 has no plan_exit tool; changing agents is not a plan-ready signal.
        }
      } catch {
        // Notification failures must not interrupt the host or event stream.
      }
    },
    dispose() {
      disposed = true
      notifier.dispose()
      seen.clear()
      owned.clear()
    },
  }
}

export const setupV2: Plugin.Plugin["setup"] = (ctx) => {
  const notifier = createV2Notifier(ctx, ctx.location, "command")
  void notifier.connected().catch(() => undefined)
  const controller = new AbortController()
  // This subscription also serves headless clients. Terminal delivery lives in ./tui.
  const task = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        await notifier.event(event)
      }
    } catch {
      // Aborting or losing a subscription must not cause an unhandled rejection.
    }
  })()
  return async () => {
    notifier.dispose()
    controller.abort()
    await task
  }
}
