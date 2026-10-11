import type { Plugin } from "@opencode/plugin/tui"
import { captureStartupWindowId } from "./focus"
import { disposeLinuxNotifications } from "./notify"
import { createV2Notifier } from "./v2"

const setup: Plugin.Definition["setup"] = (ctx) => {
  let location = ctx.location ?? ctx.data.location.default()
  captureStartupWindowId()
  let notifier = createV2Notifier(ctx.client, location, "terminal")
  let disposed = false
  const stop = ctx.data.listen(({ details }) => {
    if (disposed) return
    const current = ctx.location ?? ctx.data.location.default()
    if (current.directory !== location.directory || current.workspaceID !== location.workspaceID) {
      notifier.dispose()
      location = current
      notifier = createV2Notifier(ctx.client, location, "terminal")
    }
    void notifier.event(details)
  })
  void notifier.connected().catch(() => undefined)
  return () => {
    disposed = true
    disposeLinuxNotifications()
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
