import type { PluginInput } from '@opencode-ai/plugin';

import type { NotifierConfig } from '../src/config';
import type { EventWithProperties } from '../src/plugin';
import { createNotifierPlugin, timeProvider } from '../src/plugin';
import { sessionCache } from '../src/session-cache';

// Mock dependencies
jest.mock('../src/notify', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/sound', () => ({
  playSound: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/debug-logging', () => ({
  logEvent: jest.fn(),
}));

const mockConfig: NotifierConfig = {
  sound: true,
  notification: true,
  timeout: 5,
  volume: 0.5,
  events: {
    permission: { sound: true, notification: true },
    complete: { sound: true, notification: true },
    error: { sound: true, notification: true },
    subagent: { sound: true, notification: true },
  },
  messages: {
    permission: '{{title}}: Permission required',
    complete: 'Task complete for {{title}}',
    error: 'Error in {{title}}',
    subagent: 'Subagent {{title}} done',
  },
  sounds: {
    permission: null,
    complete: null,
    error: null,
    subagent: null,
  },
  images: {
    permission: null,
    complete: null,
    error: null,
    subagent: null,
  },
};

jest.mock('../src/config', () => ({
  isEventSoundEnabled: jest.fn((config: NotifierConfig, eventType: string) => config.events[eventType as keyof typeof config.events].sound),
  isEventNotificationEnabled: jest.fn((config: NotifierConfig, eventType: string) => config.events[eventType as keyof typeof config.events].notification),
  getMessage: jest.fn((config: NotifierConfig, eventType: string) => config.messages[eventType as keyof typeof config.messages]),
  getSoundPath: jest.fn(() => null),
  getVolume: jest.fn(() => 0.5),
  getImagePath: jest.fn(() => null),
  RACE_CONDITION_DEBOUNCE_MS: 150,
}));

import { sendNotification } from '../src/notify';

describe('Message Templating', () => {
  let mockNow = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockNow = 0;
    timeProvider.now = jest.fn(() => mockNow);
    sessionCache.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    timeProvider.now = Date.now;
  });

  it('should replace {{title}} in permission messages', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn(),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    await plugin.event({
      event: {
        type: 'permission.asked',
        properties: { 
          sessionID: 'session_123',
          info: { id: 'session_123', title: 'My Awesome Tab' }
        },
      } as EventWithProperties,
    });

    expect(sendNotification).toHaveBeenCalledWith(
      'My Awesome Tab: Permission required',
      5,
      null,
      'My Awesome Tab'
    );
  });

  it('should replace {{title}} in completion messages', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn(),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_456',
          status: { type: 'idle' },
          info: { id: 'session_456', title: 'Research Task' }
        },
      } as EventWithProperties,
    });

    // Need to advance timers to trigger the delayed handleEvent
    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith(
      'Task complete for Research Task',
      5,
      null,
      'Research Task'
    );
  });

  it('should replace {{title}} in error messages', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn(),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    await plugin.event({
      event: {
        type: 'session.error',
        properties: { 
          sessionID: 'session_789',
          info: { id: 'session_789', title: 'Coding Session' }
        },
      } as EventWithProperties,
    });

    expect(sendNotification).toHaveBeenCalledWith(
      'Error in Coding Session',
      5,
      null,
      'Coding Session'
    );
  });

  it('should fallback to "OpenCode" if title is missing', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn(),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    await plugin.event({
      event: {
        type: 'session.error',
        properties: { 
          sessionID: 'session_xxx',
          info: { id: 'session_xxx', title: undefined }
        },
      } as EventWithProperties,
    });

    expect(sendNotification).toHaveBeenCalledWith(
      'Error in OpenCode',
      5,
      null,
      'OpenCode'
    );
  });

  it('should fallback to "OpenCode" if session lookup fails (now just missing from cache)', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn(),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    await plugin.event({
      event: {
        type: 'session.error',
        properties: { sessionID: 'session_xxx' }, // No info, not in cache
      } as EventWithProperties,
    });

    expect(sendNotification).toHaveBeenCalledWith(
      'Error in OpenCode',
      5,
      null,
      'OpenCode'
    );
  });

  it('should use cached title instead of calling API', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn(), // Should NOT be called for the second event
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    // 1. Populate cache via session.created event
    await plugin.event({
      event: {
        type: 'session.created',
        properties: {
          info: { id: 'session_cache', title: 'Cached Title' },
        },
      } as any,
    });

    // 2. Trigger error event - should use cache
    await plugin.event({
      event: {
        type: 'session.error',
        properties: { sessionID: 'session_cache' },
      } as EventWithProperties,
    });

    expect(sendNotification).toHaveBeenCalledWith(
      'Error in Cached Title',
      5,
      null,
      'Cached Title'
    );
    expect(mockPluginInput.client.session.get).not.toHaveBeenCalled();
  });
});
