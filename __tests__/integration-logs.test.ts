import fs from 'node:fs';
import path from 'node:path';
import { createNotifierPlugin, timeProvider, type EventWithProperties } from '../src/plugin';
import type { NotifierConfig } from '../src/config';

jest.mock('../src/notify', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/sound', () => ({
  playSound: jest.fn().mockResolvedValue(undefined),
}));

import { sendNotification } from '../src/notify';
import { playSound } from '../src/sound';

const mockSendNotification = sendNotification as jest.MockedFunction<typeof sendNotification>;
const mockPlaySound = playSound as jest.MockedFunction<typeof playSound>;

// Mock session data for pluginInput
const mockSessions: Record<string, { title: string; parentID?: string }> = {};

const mockPluginInput = {
  client: {
    session: {
      get: jest.fn(({ path }: { path: { id: string } }) => {
        const session = mockSessions[path.id];
        return Promise.resolve({
          data: session ? { title: session.title, parentID: session.parentID } : null,
        });
      }),
    },
    tui: {
      showToast: jest.fn().mockResolvedValue(undefined),
    },
  },
};

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
    error: "✨ Beatrice: {{title}} - Perhaps a witch's mistake? 🦋",
    subagent: '🎩 Ronove: {{title}} has been processed by the Stakes. 🤵',
  },
  sounds: {
    permission: '/Users/[USER]/.config/opencode/sounds/red-truth.mp3',
    complete: '/Users/[USER]/.config/opencode/sounds/magic-butterflies.mp3',
    error: '/Users/[USER]/.config/opencode/sounds/ahaha.mp3',
    subagent: '/Users/[USER]/.config/opencode/sounds/bouncing-stakes.mp3',
  },
  images: {
    permission: null,
    complete: null,
    error: null,
    subagent: null,
  },
};

describe('Integration: Real log fixture events', () => {
  let plugin: Awaited<ReturnType<typeof createNotifierPlugin>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    timeProvider.now = jest.fn(() => Date.now());

    // Clear and set up mock sessions
    Object.keys(mockSessions).forEach(key => delete mockSessions[key]);

    plugin = await createNotifierPlugin(mockConfig, mockPluginInput as any);
    if (!plugin.event) throw new Error('Plugin event handler missing');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('processes fixture logs and triggers correct notifications/sounds for all event types', async () => {
    const fixturePath = path.join(process.cwd(), '__tests__/fixtures/integration_logs.jsonl');
    const logsContent = fs.readFileSync(fixturePath, 'utf-8');
    const logLines = logsContent.split('\n').filter(Boolean).map(line => JSON.parse(line));

    // First pass: extract session info from session.created events to populate mockSessions
    for (const log of logLines) {
      if (log.action === 'eventReceived' && log.event?.type === 'session.created') {
        const info = log.event.properties?.info;
        if (info?.id) {
          mockSessions[info.id] = {
            title: info.title || 'OpenCode',
            parentID: info.parentID,
          };
        }
      }
    }

    // Replay only notification-relevant events from fixture
    const relevantEventTypes = ['permission.updated', 'session.status', 'session.error'];
    for (const log of logLines) {
      if (log.action === 'eventReceived' && relevantEventTypes.includes(log.event?.type)) {
        const event: EventWithProperties = log.event;
        const eventPromise = plugin.event({ event });
        await jest.advanceTimersByTimeAsync(200);
        await eventPromise;
      }
    }

    // Assertions: Verify all event types triggered correct calls
    // Subagent (has parentID)
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('🎩 Ronove:'),
      5,
      null,
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenCalledWith('subagent', expect.stringContaining('bouncing-stakes.mp3'), 0.25);

    // Complete
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('💛'),
      5,
      null,
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenCalledWith('complete', expect.stringContaining('magic-butterflies.mp3'), 0.25);

    // Permission
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('🗡️ 「RED TRUTH」'),
      5,
      null,
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenCalledWith('permission', expect.stringContaining('red-truth.mp3'), 0.25);

    // Error
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('✨ Beatrice'),
      5,
      null,
      expect.any(String)
    );
    expect(mockPlaySound).toHaveBeenCalledWith('error', expect.stringContaining('ahaha.mp3'), 0.25);
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

    // {{title}} in message template is replaced with session title (defaults to "OpenCode")
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.stringContaining('🗡️ 「RED TRUTH」: OpenCode'),
      5,
      null,
      'OpenCode'
    );
    expect(mockPlaySound).toHaveBeenCalledWith('permission', expect.stringContaining('red-truth.mp3'), 0.25);
  });
});
