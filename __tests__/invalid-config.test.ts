import { createNotifierPlugin } from '../src/plugin';
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

jest.mock('../src/config', () => ({
  isEventSoundEnabled: jest.fn((config: NotifierConfig, eventType: string) => config.events[eventType as keyof typeof config.events].sound),
  isEventNotificationEnabled: jest.fn((config: NotifierConfig, eventType: string) => config.events[eventType as keyof typeof config.events].notification),
  getMessage: jest.fn((config: NotifierConfig, eventType: string) => config.messages[eventType as keyof typeof config.messages]),
  getSoundPath: jest.fn((config: NotifierConfig, eventType: string) => config.sounds[eventType as keyof typeof config.sounds]),
  getVolume: jest.fn((config: NotifierConfig) => config.volume),
  getImagePath: jest.fn((config: NotifierConfig, eventType: string) => config.images[eventType as keyof typeof config.images]),
}));

import { sendNotification } from '../src/notify';
import { playSound } from '../src/sound';

describe('Invalid Config Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not crash with minimal config', async () => {
    const minimalConfig: NotifierConfig = {
      sound: false,
      notification: false,
      timeout: 5,
      volume: 1.0,
      events: {
        permission: { sound: false, notification: false },
        complete: { sound: false, notification: false },
        error: { sound: false, notification: false },
      },
      messages: {
        permission: '',
        complete: '',
        error: '',
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

    const plugin = await createNotifierPlugin(minimalConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    // Should not crash
    await expect(async () => {
      await plugin.event({
        event: {
          type: 'permission.asked',
          properties: {},
        },
      });
    }).not.toThrow();

    // Should not send notifications when disabled
    expect(sendNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
  });

  it('should handle null/undefined sound and image paths gracefully', async () => {
    const configWithNulls: NotifierConfig = {
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
        permission: 'Test',
        complete: 'Test',
        error: 'Test',
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

    const plugin = await createNotifierPlugin(configWithNulls);

    if (!plugin.event) throw new Error('event handler not defined');

    await plugin.event({
      event: {
        type: 'permission.asked',
        properties: {},
      },
    });

    // Should still call with null paths
    expect(sendNotification).toHaveBeenCalledWith('Test', 5, null);
    expect(playSound).toHaveBeenCalledWith('permission', null, 0.5);
  });

  it('should handle extreme volume values', async () => {
    const extremeVolumeConfig: NotifierConfig = {
      sound: true,
      notification: true,
      timeout: 5,
      volume: 0.01, // Very quiet
      events: {
        permission: { sound: true, notification: true },
        complete: { sound: true, notification: true },
        error: { sound: true, notification: true },
      },
      messages: {
        permission: 'Test',
        complete: 'Test',
        error: 'Test',
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

    const plugin = await createNotifierPlugin(extremeVolumeConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    await plugin.event({
      event: {
        type: 'session.error',
        properties: {},
      },
    });

    expect(playSound).toHaveBeenCalledWith('error', null, 0.01);
  });

  it('should handle very long messages', async () => {
    const longMessage = 'A'.repeat(1000);
    const longMessageConfig: NotifierConfig = {
      sound: false,
      notification: true,
      timeout: 5,
      volume: 1.0,
      events: {
        permission: { sound: false, notification: true },
        complete: { sound: false, notification: true },
        error: { sound: false, notification: true },
      },
      messages: {
        permission: longMessage,
        complete: longMessage,
        error: longMessage,
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

    const plugin = await createNotifierPlugin(longMessageConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    await plugin.event({
      event: {
        type: 'permission.asked',
        properties: {},
      },
    });

    expect(sendNotification).toHaveBeenCalledWith(longMessage, 5, null);
  });

  it('should handle unicode and emoji in messages', async () => {
    const unicodeConfig: NotifierConfig = {
      sound: false,
      notification: true,
      timeout: 5,
      volume: 1.0,
      events: {
        permission: { sound: false, notification: true },
        complete: { sound: false, notification: true },
        error: { sound: false, notification: true },
      },
      messages: {
        permission: '⚔️🔴「RED TRUTH」你好 مرحبا',
        complete: '💛👁️🦋✨',
        error: '🔥💥🚨',
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

    const plugin = await createNotifierPlugin(unicodeConfig);

    if (!plugin.event) throw new Error('event handler not defined');

    await plugin.event({
      event: {
        type: 'session.status',
        properties: {
          status: { type: 'idle' },
        },
      },
    });

    expect(sendNotification).toHaveBeenCalledWith('💛👁️🦋✨', 5, null);
  });
});
