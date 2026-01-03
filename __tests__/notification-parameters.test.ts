import { NotifierPlugin } from '../src/index';

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
    },
    messages: {
      permission: '⚔️🔴「RED TRUTH」- Your action is required!',
      complete: '💛👁️ Without love, it cannot be seen.',
      error: '✨🦋 Beatrice: Perhaps a witch\'s mistake?',
    },
    sounds: {
      permission: '/path/to/red-truth.mp3',
      complete: '/path/to/butterflies.mp3',
      error: '/path/to/ahaha.mp3',
    },
    images: {
      permission: '/path/to/swords.png',
      complete: '/path/to/beatrice.png',
      error: '/path/to/error.jpg',
    },
  }),
  isEventSoundEnabled: jest.fn((config, eventType) => config.events[eventType].sound),
  isEventNotificationEnabled: jest.fn((config, eventType) => config.events[eventType].notification),
  getMessage: jest.fn((config, eventType) => config.messages[eventType]),
  getSoundPath: jest.fn((config, eventType) => config.sounds[eventType]),
  getVolume: jest.fn().mockReturnValue(0.35),
  getImagePath: jest.fn((config, eventType) => config.images[eventType]),
}));

import { sendNotification } from '../src/notify';
import { playSound } from '../src/sound';

describe('Notification Parameters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call sendNotification with correct message, timeout, and image for permission', async () => {
    const plugin = await NotifierPlugin();

    await plugin.event({
      event: {
        type: 'permission.asked',
        properties: {},
      },
    } as any);

    expect(sendNotification).toHaveBeenCalledWith(
      '⚔️🔴「RED TRUTH」- Your action is required!',
      10,
      '/path/to/swords.png'
    );
  });

  it('should call playSound with correct sound path and volume for permission', async () => {
    const plugin = await NotifierPlugin();

    await plugin.event({
      event: {
        type: 'permission.asked',
        properties: {},
      },
    } as any);

    expect(playSound).toHaveBeenCalledWith(
      'permission',
      '/path/to/red-truth.mp3',
      0.35
    );
  });

  it('should call sendNotification but not playSound when sound disabled', async () => {
    const plugin = await NotifierPlugin();

    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    } as any);

    expect(sendNotification).toHaveBeenCalledWith(
      '✨🦋 Beatrice: Perhaps a witch\'s mistake?',
      10,
      '/path/to/error.jpg'
    );
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should call playSound but not sendNotification when notification disabled', async () => {
    const plugin = await NotifierPlugin();

    await plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      },
    } as any);

    expect(playSound).toHaveBeenCalledWith(
      'complete',
      '/path/to/butterflies.mp3',
      0.35
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('should pass correct parameters for all event types', async () => {
    const plugin = await NotifierPlugin();

    // Permission
    await plugin.event({
      event: { type: 'permission.asked', properties: {} },
    } as any);

    expect(sendNotification).toHaveBeenNthCalledWith(
      1,
      '⚔️🔴「RED TRUTH」- Your action is required!',
      10,
      '/path/to/swords.png'
    );
    expect(playSound).toHaveBeenNthCalledWith(
      1,
      'permission',
      '/path/to/red-truth.mp3',
      0.35
    );

    jest.clearAllMocks();

    // Complete (idle)
    await plugin.event({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' } },
      },
    } as any);

    expect(playSound).toHaveBeenCalledWith(
      'complete',
      '/path/to/butterflies.mp3',
      0.35
    );
    expect(sendNotification).not.toHaveBeenCalled(); // notification disabled

    jest.clearAllMocks();

    // Error
    await plugin.event({
      event: { type: 'session.error', properties: {} },
    } as any);

    expect(sendNotification).toHaveBeenCalledWith(
      '✨🦋 Beatrice: Perhaps a witch\'s mistake?',
      10,
      '/path/to/error.jpg'
    );
    expect(playSound).not.toHaveBeenCalled(); // sound disabled
  });
});
