import { createNotifierPlugin, timeProvider } from '../src/plugin';
import type { EventWithProperties } from '../src/plugin';

// Mock dependencies
jest.mock('../src/notify', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/sound', () => ({
  playSound: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/config', () => ({
  loadConfig: jest.fn().mockReturnValue({
    sound: true,
    notification: true,
    timeout: 10,
    volume: 0.35,
    events: {
      permission: { sound: true, notification: true },
      complete: { sound: true, notification: false },
      error: { sound: false, notification: true },
      subagent: { sound: false, notification: false },
    },
    messages: {
      permission: 'Action required',
      complete: 'Done',
      error: 'Error',
      subagent: 'Subagent done',
    },
    sounds: {
      permission: '/path/to/permission.mp3',
      complete: '/path/to/complete.mp3',
      error: '/path/to/error.mp3',
      subagent: '/path/to/subagent.mp3',
    },
    images: {
      permission: '/path/to/permission.png',
      complete: '/path/to/complete.png',
      error: '/path/to/error.jpg',
      subagent: '/path/to/subagent.png',
    },
  }),
  isEventSoundEnabled: jest.fn((config, eventType) => config.events[eventType].sound),
  isEventNotificationEnabled: jest.fn((config, eventType) => config.events[eventType].notification),
  getMessage: jest.fn((config, eventType) => config.messages[eventType]),
  getSoundPath: jest.fn((config, eventType) => config.sounds[eventType]),
  getVolume: jest.fn().mockReturnValue(0.35),
  getImagePath: jest.fn((config, eventType) => config.images[eventType]),
  RACE_CONDITION_DEBOUNCE_MS: 150,
}));

import { sendNotification } from '../src/notify';
import { playSound } from '../src/sound';

describe('Notification Parameters', () => {
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

  it('should call sendNotification with correct message, timeout, and image for permission', async () => {
    const plugin = await createNotifierPlugin();

    const eventPromise = plugin.event({
      event: {
        type: 'permission.asked',
        properties: {},
      } as EventWithProperties,
    });

    jest.runAllTimers();
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith(
      'Action required',
      10,
      '/path/to/permission.png'
    );
  });

  it('should call playSound with correct sound path and volume for permission', async () => {
    const plugin = await createNotifierPlugin();

    const eventPromise = plugin.event({
      event: {
        type: 'permission.asked',
        properties: {},
      } as EventWithProperties,
    });

    jest.runAllTimers();
    await eventPromise;

    expect(playSound).toHaveBeenCalledWith(
      'permission',
      '/path/to/permission.mp3',
      0.35
    );
  });

  it('should call sendNotification but not playSound when sound disabled', async () => {
    const plugin = await createNotifierPlugin();

    const eventPromise = plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      } as EventWithProperties,
    });

    jest.runAllTimers();
    await eventPromise;

    expect(sendNotification).toHaveBeenCalledWith(
      'Error',
      10,
      '/path/to/error.jpg'
    );
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should call playSound but not sendNotification when notification disabled', async () => {
    const plugin = await createNotifierPlugin();

    const eventPromise = plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      } as EventWithProperties,
    });

    jest.advanceTimersByTime(200);
    await eventPromise;

    expect(playSound).toHaveBeenCalledWith(
      'complete',
      '/path/to/complete.mp3',
      0.35
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('should pass correct parameters for all event types', async () => {
    const plugin = await createNotifierPlugin();

    // Permission
    mockNow = 0;
    const eventPromise1 = plugin.event({
      event: { type: 'permission.asked', properties: {} } as EventWithProperties,
    });

    jest.runAllTimers();
    await eventPromise1;

    expect(sendNotification).toHaveBeenNthCalledWith(
      1,
      'Action required',
      10,
      '/path/to/permission.png'
    );
    expect(playSound).toHaveBeenNthCalledWith(
      1,
      'permission',
      '/path/to/permission.mp3',
      0.35
    );

    jest.clearAllMocks();

    // Complete (idle) - advance time to avoid debounce
    mockNow = 1000;
    const eventPromise2 = plugin.event({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' } },
      } as EventWithProperties,
    });

    jest.advanceTimersByTime(200);
    await eventPromise2;

    expect(playSound).toHaveBeenCalledWith(
      'complete',
      '/path/to/complete.mp3',
      0.35
    );
    expect(sendNotification).not.toHaveBeenCalled(); // notification disabled

    jest.clearAllMocks();

    // Error - advance time to avoid debounce
    mockNow = 2000;
    const eventPromise3 = plugin.event({
      event: { type: 'session.error', properties: {} } as EventWithProperties,
    });

    jest.runAllTimers();
    await eventPromise3;

    expect(sendNotification).toHaveBeenCalledWith(
      'Error',
      10,
      '/path/to/error.jpg'
    );
    expect(playSound).not.toHaveBeenCalled(); // sound disabled
  });
});
