import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test"
import {
  escapeMarkdownV2,
  sendToChannel,
  sendExternalNotifications,
} from "./external-notify"
import type { GotifyChannelConfig, TelegramChannelConfig } from "./external-notify"

// ---------------------------------------------------------------------------
// escapeMarkdownV2
// ---------------------------------------------------------------------------
describe("escapeMarkdownV2", () => {
  test("leaves plain text untouched", () => {
    expect(escapeMarkdownV2("Hello world")).toBe("Hello world")
  })

  test("escapes underscore", () => {
    expect(escapeMarkdownV2("hello_world")).toBe("hello\\_world")
  })

  test("escapes asterisk", () => {
    expect(escapeMarkdownV2("a*b")).toBe("a\\*b")
  })

  test("escapes parentheses", () => {
    expect(escapeMarkdownV2("(test)")).toBe("\\(test\\)")
  })

  test("escapes dot", () => {
    expect(escapeMarkdownV2("v1.0")).toBe("v1\\.0")
  })

  test("escapes multiple special chars in a title", () => {
    const raw = "OpenCode (myproject)"
    const escaped = escapeMarkdownV2(raw)
    expect(escaped).toBe("OpenCode \\(myproject\\)")
  })
})

// ---------------------------------------------------------------------------
// sendToChannel - uses a mocked global fetch
// ---------------------------------------------------------------------------
describe("sendToChannel", () => {
  const opts = { title: "OpenCode", message: "Session completed" }

  let fetchSpy: ReturnType<typeof spyOn>
  let stderrSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) as Response
    )
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  // -- Gotify --
  test("sends a POST to <url>/message with correct headers for gotify", async () => {
    const channel: GotifyChannelConfig = {
      type: "gotify",
      url: "https://gotify.example.com",
      token: "mytoken",
    }

    await sendToChannel(channel, opts)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://gotify.example.com/message")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["X-Gotify-Key"]).toBe("mytoken")
    const body = JSON.parse(init.body as string)
    expect(body.title).toBe("OpenCode")
    expect(body.message).toBe("Session completed")
    expect(body.priority).toBe(5) // default priority
  })

  test("uses custom priority for gotify", async () => {
    const channel: GotifyChannelConfig = {
      type: "gotify",
      url: "https://gotify.example.com",
      token: "tok",
      priority: 8,
    }

    await sendToChannel(channel, opts)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.priority).toBe(8)
  })

  test("strips trailing slash from gotify url", async () => {
    const channel: GotifyChannelConfig = {
      type: "gotify",
      url: "https://gotify.example.com/",
      token: "tok",
    }

    await sendToChannel(channel, opts)

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://gotify.example.com/message")
  })

  test("logs to stderr and does not throw on gotify error response", async () => {
    fetchSpy.mockResolvedValue(new Response("Unauthorized", { status: 401 }) as Response)

    const channel: GotifyChannelConfig = {
      type: "gotify",
      url: "https://gotify.example.com",
      token: "bad",
    }

    await expect(sendToChannel(channel, opts)).resolves.toBeUndefined()
    expect(stderrSpy).toHaveBeenCalled()
  })

  // -- Telegram --
  test("sends a POST to telegram sendMessage with MarkdownV2", async () => {
    const channel: TelegramChannelConfig = {
      type: "telegram",
      token: "bottoken",
      chatId: "12345",
    }

    await sendToChannel(channel, opts)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.telegram.org/botbottoken/sendMessage")
    const body = JSON.parse(init.body as string)
    expect(body.chat_id).toBe("12345")
    expect(body.parse_mode).toBe("MarkdownV2")
    // title should be bold (escaped)
    expect(body.text).toContain("OpenCode")
  })

  test("escapes special chars in telegram message", async () => {
    const channel: TelegramChannelConfig = {
      type: "telegram",
      token: "tok",
      chatId: 999,
    }

    await sendToChannel(channel, { title: "OpenCode (proj)", message: "Done." })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.text).toContain("\\(proj\\)")
    expect(body.text).toContain("Done\\.")
  })

  test("logs to stderr and does not throw on telegram error response", async () => {
    fetchSpy.mockResolvedValue(new Response("Bad Request", { status: 400 }) as Response)

    const channel: TelegramChannelConfig = {
      type: "telegram",
      token: "bad",
      chatId: "1",
    }

    await expect(sendToChannel(channel, opts)).resolves.toBeUndefined()
    expect(stderrSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// sendExternalNotifications
// ---------------------------------------------------------------------------
describe("sendExternalNotifications", () => {
  let fetchSpy: ReturnType<typeof spyOn>
  let stderrSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) as Response
    )
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  test("does nothing when channels array is empty", async () => {
    await sendExternalNotifications([], { title: "T", message: "M" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("calls fetch once per channel", async () => {
    const channels = [
      { type: "gotify" as const, url: "https://g.example.com", token: "t1" },
      { type: "telegram" as const, token: "t2", chatId: "1" },
    ]

    await sendExternalNotifications(channels, { title: "T", message: "M" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test("continues sending to remaining channels if one fails", async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(new Response(null, { status: 200 }) as Response)

    const channels = [
      { type: "gotify" as const, url: "https://g.example.com", token: "t1" },
      { type: "telegram" as const, token: "t2", chatId: "1" },
    ]

    await sendExternalNotifications(channels, { title: "T", message: "M" })
    // Both channels should have been attempted
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(stderrSpy).toHaveBeenCalled()
  })
})
