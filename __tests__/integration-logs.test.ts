import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { createNotifierPlugin, timeProvider, type EventWithProperties } from '../src/plugin';
import type { NotifierConfig } from '../src/config';
import { sendNotification } from '../src/notify';
import { playSound } from '../src/sound';

// Mock dependencies
const mockSendNotification = vi.mocked(sendNotification);
const mockPlaySound = vi.mocked(playSound);

const mockConfig: NotifierConfig = {
  sound: true,
  notification: true,
  timeout: 5,
  volume: 0.25,
  events: {
    permission: { sound: true, notification: true },
    complete: { sound: true, notification: true },
    error: { sound: true, notification: true },
    subagent: { sound: true, notification: true },
  },
  messages: {
    permission: '🗡️ 「RED TRUTH」: {{title}} - Your action is required! 🔴',
    complete: '💛 {{title}}: Without love, it cannot be seen. 👁️',
    error: '✨ Beatrice: {{title}} - Perhaps a witch\\'s mistake? 🦋',
    subagent: '🎩 Ronove: {{title}} has been processed by the Stakes. 🤵',
  },
  sounds: {
    permission: '/Users/[USER]/.config/opencode/sounds/red-truth.mp3',
    complete: '/Users/[USER]/.config/opencode/sounds/magic-butterflies.mp3',
    error: '/Users/[USER]/.config/opencode/sounds/ahaha.mp3',
    subagent: '/Users/[USER]/.config/opencode/sounds/bouncing-stakes.mp3',
  },
};

describe('Integration: Real log fixture events', () => {
  let plugin: Awaited<ReturnType<typeof createNotifierPlugin>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    timeProvider.now = vi.fn(() => Date.now());

    plugin = await createNotifierPlugin(mockConfig);
    if (!plugin.event) throw new Error('Plugin event handler missing');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('processes fixture logs and triggers correct notifications/sounds for all event types', async () => {
    const fixturePath = path.join(process.cwd(), '__tests__/fixtures/integration_logs.jsonl');
    const logsContent = fs.readFileSync(fixturePath, 'utf-8');
    const logLines = logsContent.split('\\n').filter(Boolean).map(line => JSON.parse(line));

    // Replay all eventReceived events from fixture
    for (const log of logLines) {
      if (log.action === 'eventReceived') {
        const event: EventWithProperties = log.event;
        await plugin.event({ event });
        // Advance timers for any debouncing
        vi.advanceTimersByTime(200);
      }
    }

    // Assertions: Verify all event types triggered correct calls
    // Subagent (has parentID)
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('🎩 Ronove: Echo current time'),
      5,
      expect.anything(),
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenCalledWith('subagent', expect.stringContaining('bouncing-stakes.mp3'), 0.25);

    // Complete
    expect(mockSendNotification).toHaveBeenNthCalledWith(2, // Adjust index based on order
      expect.stringContaining('💛 Dispatching @haiku'),
      5,
      expect.anything(),
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenNthCalledWith(2,
      'complete',
      expect.stringContaining('magic-butterflies.mp3'),
      0.25
    );

    // Permission
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('🗡️ 「RED TRUTH」'),
      5,
      expect.anything(),
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenCalledWith('permission', expect.stringContaining('red-truth.mp3'), 0.25);

    // Error
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('✨ Beatrice'),
      5,
      expect.anything(),
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenCalledWith('error', expect.stringContaining('ahaha.mp3'), 0.25);

    // Debounce: No duplicates or races
    expect(mockSendNotification).toHaveBeenCalledTimes(4); // One per type
    expect(mockPlaySound).toHaveBeenCalledTimes(4);
  });

  it('handles permission.updated correctly', async () => {
    const permissionEvent: EventWithProperties = {
      type: 'permission.updated',
      properties: {
        id: 'per_[MOCK_ID]',
        type: 'bash',
        pattern: ['git checkout *'],
        sessionID: 'ses_[MOCK_ID]',
        title: 'git checkout main',
      },
    };

    await plugin.event({ event: permissionEvent });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('🗡️ 「RED TRUTH」: git checkout main'),
      5,
      expect.anything(),
      'OpenCode' // Default title
    );
    expect(mockPlaySound).toHaveBeenCalledWith('permission', expect.stringContaining('red-truth.mp3'), 0.25);
  });
});
