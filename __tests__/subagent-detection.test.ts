import type { PluginInput } from '@opencode-ai/plugin';

import type { NotifierConfig } from '../src/config';
import type { EventWithProperties } from '../src/plugin';
import { createNotifierPlugin, timeProvider } from '../src/plugin';

// Mock dependencies
jest.mock('../src/notify', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/sound', () => ({
  playSound: jest.fn().mockResolvedValue(undefined),
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
    permission: 'Permission required',
    complete: 'Main task complete',
    error: 'Error occurred',
    subagent: 'Subagent task complete',
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
import { playSound } from '../src/sound';

describe('Subagent Session Detection', () => {
  let mockNow = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockNow = 0;
    timeProvider.now = jest.fn(() => mockNow);
  });

  afterEach(() => {
    jest.useRealTimers();
    timeProvider.now = Date.now;
  });

  it('should use "complete" event for main session (no parentID)', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn().mockResolvedValue({
            data: {
              id: 'session_123',
              parentID: undefined,
            },
          }),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    mockNow = 0;
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_123',
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith('Main task complete', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenCalledWith('complete', null, 0.5);
  });

  it('should use "subagent" event for delegated task (has parentID)', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn().mockResolvedValue({
            data: {
              id: 'session_456',
              parentID: 'session_123',
            },
          }),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    mockNow = 0;
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_456',
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith('Subagent task complete', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenCalledWith('subagent', null, 0.5);
  });

  it('should skip subagent notification when disabled in config', async () => {
    const configWithSubagentDisabled: NotifierConfig = {
      ...mockConfig,
      events: {
        ...mockConfig.events,
        subagent: { sound: false, notification: false },
      },
    };

    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn().mockResolvedValue({
            data: {
              id: 'session_456',
              parentID: 'session_123',
            },
          }),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(configWithSubagentDisabled, mockPluginInput);

    mockNow = 0;
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_456',
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should fallback to "complete" when session lookup fails', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest.fn().mockRejectedValue(new Error('Session not found')),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    mockNow = 0;
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_unknown',
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith('Main task complete', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenCalledWith('complete', null, 0.5);
  });

  it('should use "complete" when no pluginInput provided', async () => {
    const plugin = await createNotifierPlugin(mockConfig, undefined);

    mockNow = 0;
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_123',
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith('Main task complete', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenCalledWith('complete', null, 0.5);
  });

  it('should distinguish between multiple subagent completions', async () => {
    const mockPluginInput = {
      client: {
        session: {
          get: jest
            .fn()
            .mockResolvedValueOnce({
              data: { id: 'session_sub1', parentID: 'session_main' },
            })
            .mockResolvedValueOnce({
              data: { id: 'session_sub2', parentID: 'session_main' },
            }),
        },
      },
    } as unknown as PluginInput;

    const plugin = await createNotifierPlugin(mockConfig, mockPluginInput);

    mockNow = 0;
    const eventPromise1 = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_sub1',
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise1;

    expect(sendNotification).toHaveBeenNthCalledWith(1, 'Subagent task complete', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenNthCalledWith(1, 'subagent', null, 0.5);

    jest.clearAllMocks();

    mockNow = 1000;
    const eventPromise2 = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'session_sub2',
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise2;

    expect(sendNotification).toHaveBeenNthCalledWith(1, 'Subagent task complete', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenNthCalledWith(1, 'subagent', null, 0.5);
  });
});
