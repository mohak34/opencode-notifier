import { createNotifierPlugin, timeProvider } from '../src/plugin';
import type { EventWithProperties } from '../src/plugin';
import type { NotifierConfig } from '../src/config';

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
    subagent: { sound: false, notification: false },
  },
  messages: {
    permission: 'Permission required',
    complete: 'Task complete',
    error: 'Error occurred',
    subagent: 'Subagent complete',
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

    const eventPromise = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });

    jest.runAllTimers();
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith('Error occurred', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenCalledWith('error', null, 0.5);
  });

  it('should skip idle notification within 150ms after error', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger error at time 0
    mockNow = 0;
    const errorPromise = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });
    
    jest.runAllTimers();
    await errorPromise;

    // Clear mocks to track only the next call
    jest.clearAllMocks();

    // Advance time by 100ms (within debounce window)
    mockNow = 100;

    // Trigger idle event
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(100);
    await eventPromise;

    // Should NOT trigger complete notification/sound
    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should allow idle notification after 150ms debounce window', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger error at time 0
    mockNow = 0;
    const errorPromise = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });

    jest.runAllTimers();
    await errorPromise;

    // Clear mocks
    jest.clearAllMocks();

    // Advance time by 200ms (outside debounce window)
    mockNow = 200;

    // Trigger idle event
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    // Should trigger complete notification/sound
    expect(sendNotification).toHaveBeenCalledWith('Task complete', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenCalledWith('complete', null, 0.5);
  });

  it('should handle multiple errors with debounce reset', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // First error at time 0
    mockNow = 0;
    const errorPromise1 = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });
    jest.runAllTimers();
    await errorPromise1;

    // Second error at time 1000 (resets debounce)
    mockNow = 1000;
    const errorPromise2 = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });
    jest.runAllTimers();
    await errorPromise2;

    jest.clearAllMocks();

    // Advance to 1100ms (100ms from second error, within new debounce window)
    mockNow = 1100;

    // Idle should still be skipped
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(100);
    await eventPromise;

    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should only debounce idle after error, not busy status', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger error at time 0
    mockNow = 0;
    const errorPromise = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });
    jest.runAllTimers();
    await errorPromise;

    jest.clearAllMocks();
    mockNow = 500;

    // Busy status should not be affected
    await plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'busy' },
        },
      } as EventWithProperties,
    });

    // No notifications should be sent (busy doesn't trigger anything anyway)
    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should skip error notification within 150ms after idle (cancellation scenario)', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger idle at time 0 (user cancels, idle fires first)
    mockNow = 0;
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    // Advance slightly but within delay
    jest.advanceTimersByTime(20);
    
    // Trigger error event (abort error fires after idle)
    mockNow = 100;
    const errorPromise = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });

    jest.runAllTimers();
    await eventPromise;
    await errorPromise;

    // Should NOT trigger error notification/sound
    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should allow error notification after 150ms from idle', async () => {
    const plugin = await createNotifierPlugin(mockConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Trigger idle at time 0
    mockNow = 0;
    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    await jest.advanceTimersByTimeAsync(200);
    await eventPromise;

    // Clear mocks
    jest.clearAllMocks();

    // Advance time by 200ms (outside debounce window)
    mockNow = 400;

    // Trigger error event
    const errorPromise = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });

    jest.runAllTimers();
    await errorPromise;

    // Should trigger error notification/sound (it's a real new error)
    expect(sendNotification).toHaveBeenCalledWith('Error occurred', 5, null, 'OpenCode');
    expect(playSound).toHaveBeenCalledWith('error', null, 0.5);
  });
});
