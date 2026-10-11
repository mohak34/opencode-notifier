import type { MessageBus } from "dbus-next"

const DESTINATION = "org.freedesktop.Notifications"
const PATH = "/org/freedesktop/Notifications"
const CALL_TIMEOUT_MS = 2000
// Close the oldest popup before retiring its handler, so visible popups never
// lose their actions just because they passed the requested expiry time.
const MAX_ACTIONS = 128

interface BusStream {
  ref?: () => void
  unref?: () => void
  on?: (event: string, callback: () => void) => void
}

interface Connection {
  bus: MessageBus
  stream?: BusStream
  owner: string
  callbacks: Map<number, () => void>
  pendingSignals: Array<[string, number, unknown]> | null
  failure: Promise<never>
  fail: (error: Error) => void
}

let connection: Promise<Connection> | undefined
let current: Connection | undefined
let generation = 0
let lastID = 0
let queue: Promise<unknown> = Promise.resolve()

export function getLinuxNotificationID(): number | null {
  return lastID || null
}

export function rememberLinuxNotificationID(id: number): void {
  lastID = id
  // A plain notify-send replacement has no action, so retire its old callback.
  current?.callbacks.delete(id)
}

function debug(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) console.error(`[opencode-notifier] ${message}`)
}

function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("notification D-Bus call timed out")), CALL_TIMEOUT_MS)
    timer.unref()
    operation.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

function resetConnection(): void {
  connection = undefined
  const old = current
  current = undefined
  lastID = 0
  old?.callbacks.clear()
  old?.fail(new Error("notification connection closed"))
  try { old?.bus.disconnect() } catch {}
}

export function disposeLinuxNotifications(): void {
  generation++
  resetConnection()
}

function handleSignal(state: Connection, member: string, id: number, value: unknown): void {
  if (member === "NotificationClosed") state.callbacks.delete(id)
  if (member === "ActionInvoked" && value === "focus-terminal") {
    const callback = state.callbacks.get(id)
    state.callbacks.delete(id)
    try { callback?.() } catch {}
  }
}

async function connect(): Promise<Connection> {
  const epoch = generation
  const dbus = (await import("dbus-next")).default
  if (epoch !== generation) throw new Error("notification channel disposed")
  const bus = dbus.sessionBus()
  let fail!: (error: Error) => void
  const failure = new Promise<never>((_resolve, reject) => { fail = reject })
  void failure.catch(() => undefined)
  const state: Connection = { bus, owner: "", callbacks: new Map(), pendingSignals: null, failure, fail }
  current = state
  bus.on("error", error => {
    debug(`notification D-Bus error: ${String(error)}`)
    if (current === state) resetConnection()
  })
  // dbus-next has no public unref API. Unref its socket so retained popups do
  // not keep a terminated OpenCode process alive; explicit disposal also closes it.
  const stream = (bus as MessageBus & { _connection?: { stream?: BusStream } })._connection?.stream
  state.stream = stream
  stream?.on?.("close", () => {
    if (current === state) resetConnection()
  })
  bus.on("message", message => {
    if (message.type !== dbus.MessageType.SIGNAL) return
    if (message.sender === "org.freedesktop.DBus" && message.interface === "org.freedesktop.DBus" && message.member === "NameOwnerChanged" && message.body[0] === DESTINATION) {
      // A restarted daemon has a new ID namespace and no surviving popups.
      state.owner = message.body[2]
      state.callbacks.clear()
      lastID = 0
      return
    }
    if (message.sender !== state.owner || message.path !== PATH || message.interface !== DESTINATION) return
    const [id, value] = message.body
    if (state.pendingSignals) state.pendingSignals.push([message.member, id, value])
    else handleSignal(state, message.member, id, value)
  })
  // Subscribe before Notify, including signals emitted before its reply.
  for (const rule of [
    `type='signal',sender='${DESTINATION}',path='${PATH}',interface='${DESTINATION}'`,
    `type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='${DESTINATION}'`,
  ]) {
    await bounded(Promise.race([failure, bus.call(new dbus.Message({
      destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus",
      member: "AddMatch", signature: "s", body: [rule],
    }))]))
  }
  const reply = await bounded(Promise.race([failure, bus.call(new dbus.Message({
    destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus",
    member: "GetNameOwner", signature: "s", body: [DESTINATION],
  }))]))
  state.owner = reply?.body[0] ?? ""
  if (current !== state || epoch !== generation) throw new Error("notification connection closed")
  return state
}

export function sendLinuxActionNotification(
  title: string, message: string, timeout: number, iconPath: string | undefined,
  grouping: boolean, onClick: () => void, label: string
): Promise<boolean> {
  const epoch = generation
  const operation = queue.then(async () => {
    if (epoch !== generation) return true
    let state: Connection | undefined
    try {
      state = await (connection ??= connect())
      if (current !== state) return true
      // Pending calls keep the client alive until delivery resolves. Idle
      // notification listeners alone must not prolong the client's lifetime.
      state.stream?.ref?.()
      const dbus = (await import("dbus-next")).default
      if (state.callbacks.size >= MAX_ACTIONS && !(grouping && state.callbacks.has(lastID))) {
        const id = state.callbacks.keys().next().value!
        await bounded(Promise.race([state.failure, state.bus.call(new dbus.Message({
          destination: DESTINATION, path: PATH, interface: DESTINATION,
          member: "CloseNotification", signature: "u", body: [id],
        }))]))
        state.callbacks.delete(id)
      }
      state.pendingSignals = []
      const reply = await bounded(Promise.race([state.failure, state.bus.call(new dbus.Message({
        destination: DESTINATION, path: PATH, interface: DESTINATION,
        member: "Notify", signature: "susssasa{sv}i",
        body: ["opencode", grouping ? lastID : 0, iconPath ?? "", title, message,
          ["focus-terminal", label], {}, Math.max(1, timeout) * 1000],
      }))]))
      if (current !== state || epoch !== generation) return true
      const id = reply?.body[0]
      if (!Number.isInteger(id) || id <= 0) throw new Error("invalid notification ID")
      if (grouping) lastID = id
      state.callbacks.set(id, onClick)
      const signals = state.pendingSignals
      state.pendingSignals = null
      for (const [member, signalID, value] of signals ?? []) handleSignal(state, member, signalID, value)
      return true
    } catch (error) {
      if (epoch !== generation) return true
      debug(`persistent notification failed: ${String(error)}`)
      if (!state || current === state) resetConnection()
      return false
    } finally {
      state?.stream?.unref?.()
    }
  })
  queue = operation.catch(() => undefined)
  return operation
}
