import type { Plugin } from "@opencode/plugin/tui"
import { captureStartupWindowId } from "./focus"
import { createV2Notifier } from "./v2"
import { createTerminalClients } from "./terminal-clients"

const setup: Plugin.Definition["setup"] = async (ctx) => {
  let location = ctx.location ?? ctx.data.location.default()
  await captureStartupWindowId()
  const clients = createTerminalClients(() => {
    let sessions: string[] | null = null
    try {
      const route = ctx.ui?.router?.current?.()
      const tabs = ctx.ui?.tabs?.list?.()
      if (tabs) sessions = tabs.map(tab => tab.sessionID)
      if (route?.type === "session") (sessions ??= []).push(route.sessionID)
    } catch {}
    return { location: ctx.location ?? ctx.data.location.default(), sessions }
  }, sessionID => ctx.data.session.root(sessionID))
  await clients.refresh()
  const hooks = {
    claim: clients.claim,
    focusSession(sessionID: string) {
      if (disposed) return
      let root = sessionID
      try { root = ctx.data.session.root(sessionID) || sessionID } catch {}
      if (!ctx.ui?.tabs?.focus?.(root) || root !== sessionID) ctx.ui?.router?.navigate?.({ type: "session", sessionID })
    },
  }
  let notifier = createV2Notifier(ctx.client, location, "terminal", hooks)
  let disposed = false
  const stop = ctx.data.listen(({ details }) => {
    if (disposed) return
    void clients.refresh()
    const current = ctx.location ?? ctx.data.location.default()
    if (current.directory !== location.directory || current.workspaceID !== location.workspaceID) {
      notifier.dispose()
      location = current
      notifier = createV2Notifier(ctx.client, location, "terminal", hooks)
    }
    void notifier.event(details)
  })
  void notifier.connected().catch(() => undefined)
  return () => {
    disposed = true
    clients.dispose()
    stop()
    notifier.dispose()
  }
}

export default {
  id: "opencode-notifier",
  // V1 discovers ./tui too. Its server entrypoint already handles delivery.
  tui: async () => {},
  setup,
}
