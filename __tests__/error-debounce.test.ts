import { createNotifierPlugin, timeProvider } from '../src/plugin';
import type { NotifierConfig } from '../src/config';

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
  },
  messages: {
    permission: 'Permission required',
    complete: 'Task complete',
    error: 'Error occurred',
  },
  sounds: {
    permission: null,
    complete: null,
    error: null,
  },
  images: {
    permission: null,
    complete: null,
    error: null,
  },
};

jest.mock('../src/config', () => ({
  isEventSoundEnabled: jest.fn((config: NotifierConfig, eventType: string) => config.events[eventType as keyof typeof config.events].sound),
  isEventNotificationEnabled: jest.fn((config: NotifierConfig, eventType: string) => config.events[eventType as keyof typeof config.events].notification),
  getMessage: jest.fn((config: NotifierConfig, eventType: string) => config.messages[eventType as keyof typeof config.messages]),
  getSoundPath: jest.fn(() => null),
  getVolume: jest.fn(() => 0.5),
  getImagePath: jest.fn(() => null),
}));

import { sendNotification } from '../src/notify';
import { playSound } from '../src/sound';
import { logEvent } from '../src/debug-logging';

describe('Error + Complete Race Condition', () => {
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

  it('should trigger error notification when session.error occurs', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    });

    expect(sendNotification).toHaveBeenCalledWith('Error occurred', 5, null);
    expect(playSound).toHaveBeenCalledWith('error', null, 0.5);
  });

  it('should skip idle notification within 2s after error', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger error at time 0
    mockNow = 0;
    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    });

    // Clear mocks to track only the next call
    jest.clearAllMocks();

    // Advance time by 1 second (within debounce window)
    mockNow = 1000;

    // Trigger idle event
    await plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      },
    });

    // Should NOT trigger complete notification/sound
    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skipIdleAfterError',
        reason: 'Idle event following error - skipping to avoid double notification',
      })
    );
  });

  it('should allow idle notification after 2s debounce window', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger error at time 0
    mockNow = 0;
    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    });

    // Clear mocks
    jest.clearAllMocks();

    // Advance time by 2.1 seconds (outside debounce window)
    mockNow = 2100;

    // Trigger idle event
    await plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      },
    });

    // Should trigger complete notification/sound
    expect(sendNotification).toHaveBeenCalledWith('Task complete', 5, null);
    expect(playSound).toHaveBeenCalledWith('complete', null, 0.5);
  });

  it('should handle multiple errors with debounce reset', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // First error at time 0
    mockNow = 0;
    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    });

    // Second error at time 1000 (resets debounce)
    mockNow = 1000;
    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    });

    jest.clearAllMocks();

    // Advance to 2500ms (1.5s from second error, within new debounce window)
    mockNow = 2500;

    // Idle should still be skipped
    await plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      },
    });

    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should only debounce idle after error, not busy status', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger error at time 0
    mockNow = 0;
    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    });

    jest.clearAllMocks();
    mockNow = 500;

    // Busy status should not be affected
    await plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'busy' },
        },
      },
    } as any);

    // No notifications should be sent (busy doesn't trigger anything anyway)
    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skipIdleAfterError' })
    );
  });
});
