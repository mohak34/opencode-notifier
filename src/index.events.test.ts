import { describe, test, expect } from "bun:test"
import { normalizeV1Event, normalizeV2Event } from "./index"

describe("normalizeV1Event", () => {
  test("maps session.created with a parentID to subagent tracking", () => {
    const events = normalizeV1Event({
      type: "session.created",
      properties: { info: { id: "child-1", parentID: "parent-1", title: "Subagent" } },
    })

    expect(events).toEqual([
      { type: "session.created", sessionID: "child-1", parentID: "parent-1", title: "Subagent" },
    ])
  })

  test("maps a top-level session.created to session_started", () => {
    const events = normalizeV1Event({
      type: "session.created",
      properties: { info: { id: "s-1", title: "Work" } },
    })

    expect(events).toEqual([
      { type: "session.created", sessionID: "s-1", parentID: null, title: "Work" },
    ])
  })

  test("maps session.deleted", () => {
    const events = normalizeV1Event({
      type: "session.deleted",
      properties: { info: { id: "s-1" } },
    })

    expect(events[0]).toEqual({ type: "session.deleted", sessionID: "s-1" })
  })

  test("maps permission.asked without needing extra envelope fields", () => {
    const events = normalizeV1Event({ type: "permission.asked", properties: { sessionID: "s-1" } })

    expect(events).toEqual([{ type: "permission.asked", sessionID: "s-1" }])
  })

  test("maps session.idle", () => {
    const events = normalizeV1Event({ type: "session.idle", properties: { sessionID: "s-1" } })

    expect(events).toEqual([{ type: "session.idle", sessionID: "s-1" }])
  })

  test("maps a busy session.status", () => {
    const events = normalizeV1Event({
      type: "session.status",
      properties: { sessionID: "s-1", status: { type: "busy" } },
    })

    expect(events).toEqual([{ type: "session.busy", sessionID: "s-1" }])
  })

  test("ignores a non-busy session.status", () => {
    const events = normalizeV1Event({
      type: "session.status",
      properties: { sessionID: "s-1", status: { type: "idle" } },
    })

    expect(events).toEqual([])
  })

  test("classifies a MessageAbortedError as user_cancelled", () => {
    const events = normalizeV1Event({
      type: "session.error",
      properties: { sessionID: "s-1", error: { name: "MessageAbortedError" } },
    })

    expect(events[0]).toMatchObject({ type: "session.error", sessionID: "s-1", userCancelled: true })
  })

  test("classifies other errors as error", () => {
    const events = normalizeV1Event({
      type: "session.error",
      properties: { sessionID: "s-1", error: { name: "ProviderError" } },
    })

    expect(events[0]).toMatchObject({ type: "session.error", sessionID: "s-1", userCancelled: false })
  })

  test("only emits message.user for user messages", () => {
    const user = normalizeV1Event({
      type: "message.updated",
      properties: { info: { role: "user", sessionID: "s-1" } },
    })
    const assistant = normalizeV1Event({
      type: "message.updated",
      properties: { info: { role: "assistant", sessionID: "s-1" } },
    })

    expect(user).toEqual([{ type: "message.user", sessionID: "s-1" }])
    expect(assistant).toEqual([])
  })
})

describe("normalizeV2Event", () => {
  test("maps session.created with a parentID to subagent tracking", () => {
    const events = normalizeV2Event({
      type: "session.created",
      data: { sessionID: "child-1", parentID: "parent-1", title: "Subagent" },
    })

    expect(events).toEqual([
      { type: "session.created", sessionID: "child-1", parentID: "parent-1", title: "Subagent" },
    ])
  })

  test("maps a top-level session.created", () => {
    const events = normalizeV2Event({
      type: "session.created",
      data: { sessionID: "s-1", title: "Work" },
    })

    expect(events).toEqual([
      { type: "session.created", sessionID: "s-1", parentID: null, title: "Work" },
    ])
  })

  test("maps session.deleted", () => {
    const events = normalizeV2Event({ type: "session.deleted", data: { sessionID: "s-1" } })

    expect(events).toEqual([{ type: "session.deleted", sessionID: "s-1" }])
  })

  test("maps permission.asked from the data envelope", () => {
    expect(normalizeV2Event({ type: "permission.asked", data: { sessionID: "s-1" } })).toEqual([
      { type: "permission.asked", sessionID: "s-1" },
    ])
  })

  test("maps session.idle from the data envelope", () => {
    expect(normalizeV2Event({ type: "session.idle", data: { sessionID: "s-1" } })).toEqual([
      { type: "session.idle", sessionID: "s-1" },
    ])
  })

  test("maps a busy session.status", () => {
    const events = normalizeV2Event({
      type: "session.status",
      data: { sessionID: "s-1", status: { type: "busy" } },
    })

    expect(events).toEqual([{ type: "session.busy", sessionID: "s-1" }])
  })

  test("maps session.execution.failed to error", () => {
    const events = normalizeV2Event({
      type: "session.execution.failed",
      data: { sessionID: "s-1", error: { type: "provider", message: "boom" } },
    })

    expect(events[0]).toMatchObject({ type: "session.error", sessionID: "s-1", userCancelled: false })
  })

  test("maps a user interruption to user_cancelled", () => {
    const events = normalizeV2Event({
      type: "session.execution.interrupted",
      data: { sessionID: "s-1", reason: "user" },
    })

    expect(events[0]).toMatchObject({ type: "session.error", sessionID: "s-1", userCancelled: true })
  })

  test("maps a non-user interruption to error", () => {
    const events = normalizeV2Event({
      type: "session.execution.interrupted",
      data: { sessionID: "s-1", reason: "shutdown" },
    })

    expect(events[0]).toMatchObject({ type: "session.error", sessionID: "s-1", userCancelled: false })
  })

  test("maps an enqueued user inbox item to message.user", () => {
    const events = normalizeV2Event({
      type: "session.inbox.enqueued",
      data: { sessionID: "s-1", inboxID: "i-1", item: { type: "user", delivery: "steer" } },
    })

    expect(events).toEqual([{ type: "message.user", sessionID: "s-1" }])
  })

  test("ignores non-user inbox items", () => {
    const events = normalizeV2Event({
      type: "session.inbox.enqueued",
      data: { sessionID: "s-1", inboxID: "i-1", item: { type: "synthetic", delivery: "steer" } },
    })

    expect(events).toEqual([])
  })

  test("ignores unrelated events", () => {
    expect(normalizeV2Event({ type: "server.connected", data: {} })).toEqual([])
  })
})
