// Runs only inside dbus-run-session: never talks to the user's desktop daemon.
import dbus from "dbus-next"

const path = "/org/freedesktop/Notifications"
const name = "org.freedesktop.Notifications"
const bus = dbus.sessionBus()
let sender = ""
let nextID = 1
export const requests: Array<{ id: number; actions: string[]; timeout: number; sender: string; replaces: number }> = []
export const visible = new Map<number, { actions: string[]; sender: string }>()
export class Notifications extends dbus.interface.Interface {
  constructor() { super(name) }
  GetCapabilities() { return ["actions", "body"] }
  GetServerInformation() { return ["fixture", "fixture", "1", "1.3"] }
  Notify(_app: string, replaces: number, _icon: string, _title: string, _body: string, actions: string[], _hints: unknown, timeout: number) {
    const id = replaces || nextID++
    requests.push({ id, actions, timeout, sender, replaces })
    visible.set(id, { actions, sender })
    if (_body === "early") this.ActionInvoked(id, "focus-terminal")
    if (_body === "closed") { this.CloseNotification(id); this.ActionInvoked(id, "focus-terminal") }
    if (_body === "hang") return new Promise(() => {})
    return id
  }
  CloseNotification(id: number) {
    visible.delete(id)
    this.NotificationClosed(id, 3)
  }
  ActionInvoked(id: number, key: string) { return [id, key] }
  NotificationClosed(id: number, reason: number) { return [id, reason] }
}
Notifications.configureMembers({
  methods: {
    GetCapabilities: { inSignature: "", outSignature: "as" },
    GetServerInformation: { inSignature: "", outSignature: "ssss" },
    Notify: { inSignature: "susssasa{sv}i", outSignature: "u" },
    CloseNotification: { inSignature: "u", outSignature: "" },
  },
  signals: {
    ActionInvoked: { signature: "us" },
    NotificationClosed: { signature: "uu" },
  },
})
export const notifications = new Notifications()
bus.on("message", message => {
  if (message.member === "Notify") sender = message.sender
})
bus.export(path, notifications)
await bus.requestName(name, 0)
const proxy = await bus.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus")
proxy.getInterface("org.freedesktop.DBus").on("NameOwnerChanged", (name: string, _old: string, owner: string) => {
  if (owner) return
  // Plasma removes action buttons when the sending connection disappears.
  for (const popup of visible.values()) if (popup.sender === name) popup.actions = []
})
export function stopDaemon() { bus.disconnect() }

export async function restartDaemon() {
  await bus.releaseName(name)
  visible.clear()
  nextID = 1
  await bus.requestName(name, 0)
}
