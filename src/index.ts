import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { captureStartupWindowId } from "./focus"
import { createNotifier } from "./notifier"
import { setupV2 } from "./v2"
export { extractAgentNameFromSessionTitle } from "./delivery"
export { PERMISSION_PENDING_GRACE_MS } from "./notifier"

export function isCLIClient(clientEnv?: string): boolean {
  return !clientEnv || clientEnv === "cli"
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null
}

function getNestedRecord(root: unknown, ...path: string[]): UnknownRecord | null {
  let current: unknown = root
  for (const key of path) {
    const record = asRecord(current)
    if (!record || !(key in record)) {
      return null
    }
    current = record[key]
  }
  return asRecord(current)
}

function getStringField(record: UnknownRecord | null, key: string): string | null {
  if (!record) {
    return null
  }
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function getSessionIDFromEvent(event: unknown): string | null {
  const properties = getNestedRecord(event, "properties")
  return getStringField(properties, "sessionID")
}

export function getPermissionIDFromEvent(event: unknown): string | null {
  const properties = getNestedRecord(event, "properties")
  const id = getStringField(properties, "id")
  if (id) {
    return id
  }
  const request = getNestedRecord(event, "properties", "request")
  return getStringField(request, "id")
}

// True when the request is still awaiting approval. Fails open: any lookup
// failure means "unknown", and unknown must notify rather than stay silent.
export async function isPermissionStillPending(client: unknown, permissionID: string): Promise<boolean> {
  try {
    // The v1 SDK client type exposes no permission.list API, so go through
    // the raw HTTP client, with shape checks at this untyped boundary.
    const record = asRecord(client)
    const inner = asRecord(record?._client) ?? getNestedRecord(client, "session", "_client")
    if (!inner || typeof inner.get !== "function") {
      return true
    }
    const listResponse: unknown = await inner.get({ url: "/permission" })
    const body = asRecord(listResponse)?.data ?? listResponse
    const pendingList = Array.isArray(body) ? body : asRecord(body)?.data
    if (!Array.isArray(pendingList)) {
      return true
    }
    return pendingList.some((p: unknown) => asRecord(p)?.id === permissionID)
  } catch {
    return true
  }
}

interface SessionLifecycleInfo {
  id: string | null
  title: string | null
  parentID: string | null
}

function getSessionLifecycleInfo(event: unknown): SessionLifecycleInfo {
  const info = getNestedRecord(event, "properties", "info")
  return {
    id: getStringField(info, "id"),
    title: getStringField(info, "title"),
    parentID: getStringField(info, "parentID"),
  }
}

interface MessageUpdatedInfo {
  role: string | null
  sessionID: string | null
}

function getMessageUpdatedInfo(event: unknown): MessageUpdatedInfo {
  const info = getNestedRecord(event, "properties", "info")
  return {
    role: getStringField(info, "role"),
    sessionID: getStringField(info, "sessionID"),
  }
}

export const NotifierPlugin: Plugin = async ({ client, directory }) => {
  await captureStartupWindowId()
  const clientEnv = process.env.OPENCODE_CLIENT
  if (clientEnv && clientEnv !== "cli" && !loadConfig().enableOnDesktop) return {}
  const notifier = createNotifier({
    async info(id) {
      try {
        const { data } = await client.session.get({ path: { id } })
        if (!data) return { isChild: null, title: null }
        return { isChild: !!data.parentID, title: data.title ?? null }
      } catch {
        return { isChild: null, title: null }
      }
    },
    async elapsed(id, now) {
      try {
        const { data } = await client.session.messages({ path: { id } })
        const times = (data ?? []).flatMap(({ info }) =>
          info.role === "user" && typeof info.time?.created === "number" ? [info.time.created] : [])
        return times.length ? (now - Math.max(...times)) / 1000 : null
      } catch {
        return null
      }
    },
    permissionPending: (_id, requestID) => isPermissionStillPending(client, requestID),
  }, directory)
  const isCLI = isCLIClient(clientEnv)
  const connected = () => void notifier.notify("client_connected").catch(() => undefined)
  const connectedTimer = isCLI ? undefined : setTimeout(connected, 100)
  if (isCLI) connected()

  return {
    async dispose() {
      clearTimeout(connectedTimer)
      notifier.dispose()
    },
    async event({ event }) {
      try {
        const type = asRecord(event)?.type
        const sessionID = getSessionIDFromEvent(event)
        if (type === "session.created" || type === "session.updated") {
          const info = getSessionLifecycleInfo(event)
          if (type === "session.created") await notifier.created(info.id, info.parentID, info.title)
          else if (info.id) notifier.track(info.id, info.parentID)
        }
        // Stop deleted work while retaining child tombstones for late idle events.
        if (type === "session.deleted") {
          const id = getSessionLifecycleInfo(event).id
          if (id) await notifier.stopped(id)
        }
        if (type === "permission.asked") {
          await notifier.permission(sessionID, getPermissionIDFromEvent(event), true)
        }
        if (type === "session.idle") await notifier.idle(sessionID, isCLI)
        if (type === "session.status" && getNestedRecord(event, "properties", "status")?.type === "busy" && sessionID) {
          notifier.busy(sessionID)
        }
        if (type === "session.error") {
          const cancelled = getNestedRecord(event, "properties", "error")?.name === "MessageAbortedError"
          await notifier.failed(sessionID, cancelled ? "user_cancelled" : "error")
        }
        if (type === "message.updated") {
          const info = getMessageUpdatedInfo(event)
          if (info.role === "user") await notifier.userMessage(info.sessionID)
        }
      } catch {
        // Notification failures must not interrupt the host.
      }
    },
    "permission.ask": async () => {
      try { await notifier.permission(null, null, true) } catch {}
    },
    "tool.execute.before": async (input) => {
      try {
        if (input.tool === "question" || input.tool === "plan_exit") {
          await notifier.notify(input.tool, getStringField(asRecord(input), "sessionID"))
        }
      } catch {}
    },
  }
}

export default {
  id: "opencode-notifier",
  server: NotifierPlugin,
  setup: setupV2,
} satisfies PluginModule & { setup: typeof setupV2 }
