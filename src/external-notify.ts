/**
 * External notification channels (Gotify, Telegram, etc.)
 *
 * Each channel is configured independently in opencode-notifier.json under
 * the `externalChannels` array. By default the array is empty and no external
 * notifications are sent.
 *
 * Supported channel types:
 *   - "gotify"  : Gotify push notification server
 *   - "telegram": Telegram Bot API
 */

export type ExternalChannelType = "gotify" | "telegram"

export interface GotifyChannelConfig {
  type: "gotify"
  /** Base URL of the Gotify server, e.g. "https://gotify.example.com" */
  url: string
  /** Application token */
  token: string
  /** Message priority (optional, default 5) */
  priority?: number
}

export interface TelegramChannelConfig {
  type: "telegram"
  /** Bot API token from @BotFather */
  token: string
  /** Chat ID (user, group, or channel) to send messages to */
  chatId: string | number
}

export type ExternalChannelConfig = GotifyChannelConfig | TelegramChannelConfig

export interface ExternalNotifyOptions {
  title: string
  message: string
}

async function sendGotify(channel: GotifyChannelConfig, opts: ExternalNotifyOptions): Promise<void> {
  const baseUrl = channel.url.replace(/\/$/, "")
  const url = `${baseUrl}/message`
  const priority = typeof channel.priority === "number" ? channel.priority : 5

  const body = JSON.stringify({
    title: opts.title,
    message: opts.message,
    priority,
  })

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gotify-Key": channel.token,
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Gotify request failed: ${response.status} ${response.statusText} ${text}`.trim())
  }
}

async function sendTelegram(channel: TelegramChannelConfig, opts: ExternalNotifyOptions): Promise<void> {
  const url = `https://api.telegram.org/bot${channel.token}/sendMessage`
  const text = `*${escapeMarkdownV2(opts.title)}*\n${escapeMarkdownV2(opts.message)}`

  const body = JSON.stringify({
    chat_id: channel.chatId,
    text,
    parse_mode: "MarkdownV2",
  })

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Telegram request failed: ${response.status} ${response.statusText} ${text}`.trim())
  }
}

/**
 * Escape special characters for Telegram MarkdownV2 parse mode.
 * https://core.telegram.org/bots/api#markdownv2-style
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&")
}

/**
 * Send a notification to a single external channel.
 * Errors are caught and logged to stderr so one failing channel does not
 * block others.
 */
export async function sendToChannel(channel: ExternalChannelConfig, opts: ExternalNotifyOptions): Promise<void> {
  try {
    if (channel.type === "gotify") {
      await sendGotify(channel, opts)
    } else if (channel.type === "telegram") {
      await sendTelegram(channel, opts)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[opencode-notifier] external channel (${channel.type}) error: ${msg}\n`)
  }
}

/**
 * Send a notification to all configured external channels in parallel.
 */
export async function sendExternalNotifications(
  channels: ExternalChannelConfig[],
  opts: ExternalNotifyOptions
): Promise<void> {
  if (channels.length === 0) {
    return
  }

  await Promise.allSettled(channels.map((ch) => sendToChannel(ch, opts)))
}
