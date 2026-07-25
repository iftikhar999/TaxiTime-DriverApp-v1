/**
 * localNotifications.ts
 *
 * System-tray notifications triggered locally (no FCM required for the
 * app-alive case). Used by the dispatcher chat socket listener.
 *
 * Notifee is lazy-loaded through a try/require: if the native module
 * hasn't been linked yet (e.g. before a rebuild, or on a host build
 * without it), every function in here no-ops silently rather than
 * crashing the whole UnreadDispatcherProvider import chain.
 */

// Module-scoped cache so we only pay the require cost once.
let _notifeeModule: any | null = null;
let _tried = false;
const loadNotifee = (): any | null => {
  if (_tried) return _notifeeModule;
  _tried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@notifee/react-native');
    _notifeeModule = mod?.default ?? mod;
  } catch (err) {
    console.warn('[notifications] @notifee/react-native not available:', (err as any)?.message);
    _notifeeModule = null;
  }
  return _notifeeModule;
};

const CHANNEL_ID_DISPATCHER = 'dispatcher-chat';
const CHANNEL_ID_KEEPALIVE = 'driver-keepalive';
const KEEPALIVE_NOTIFICATION_ID = 'driver-keepalive';

let channelReady = false;
let keepaliveChannelReady = false;
let keepaliveRunning = false;
const ensureChannel = async (notifee: any, constants: any) => {
  if (channelReady) return;
  await notifee.createChannel({
    id: CHANNEL_ID_DISPATCHER,
    name: 'Dispatcher messages',
    description: 'Live messages from your company dispatcher.',
    importance: constants?.AndroidImportance?.HIGH ?? 4,
    visibility: constants?.AndroidVisibility?.PUBLIC ?? 1,
    vibration: true,
    sound: 'default',
  });
  channelReady = true;
};

/** Fire a system-tray notification for an incoming dispatcher message. */
export const displayDispatcherMessageNotification = async (opts: {
  senderName: string;
  preview: string;
  messageId: string;
  senderId?: string;
}) => {
  const notifee = loadNotifee();
  if (!notifee) return; // Native module missing — degrade to toast-only.
  try {
    const constants = require('@notifee/react-native');
    // NOTE: do NOT call notifee.requestPermission() here. On Android 13+
    // that tries to launch the permission grant activity, which the
    // system blocks when the app is backgrounded — the thrown error
    // silently kills the whole notification path. Permission is requested
    // once at app start via `primeNotificationPermission`.
    await ensureChannel(notifee, constants);
    await notifee.displayNotification({
      id: `dispatcher:${opts.messageId}`,
      title: `${opts.senderName} (Dispatch)`,
      body: opts.preview,
      data: {
        kind: 'dispatcher_message',
        screen: 'DispatcherChat',
        senderId: opts.senderId || '',
        messageId: opts.messageId,
      },
      android: {
        channelId: CHANNEL_ID_DISPATCHER,
        smallIcon: 'ic_launcher',
        color: '#60a5fa',
        pressAction: { id: 'default', launchActivity: 'default' },
        importance: constants?.AndroidImportance?.HIGH ?? 4,
        category: 'msg',
      },
      ios: { sound: 'default' },
    });
  } catch (err) {
    console.warn('[notifications] displayDispatcher failed:', err);
  }
};

/** Ensure the keep-alive channel exists (LOW importance — no heads-up). */
const ensureKeepaliveChannel = async (notifee: any, constants: any) => {
  if (keepaliveChannelReady) return;
  await notifee.createChannel({
    id: CHANNEL_ID_KEEPALIVE,
    name: 'Background connection',
    description: 'Keeps the driver app connected to dispatch in the background.',
    importance: constants?.AndroidImportance?.LOW ?? 2,
    visibility: constants?.AndroidVisibility?.PUBLIC ?? 1,
  });
  keepaliveChannelReady = true;
};

/**
 * Request notification permission once, at app start / login, while the
 * app is in the foreground. Safe to call multiple times — notifee caches
 * the grant state. NEVER call this from a background path: Android 15
 * blocks the permission activity from launching in the background and
 * the thrown error cascades silently.
 */
export const primeNotificationPermission = async () => {
  const notifee = loadNotifee();
  if (!notifee) return;
  try {
    await notifee.requestPermission();
  } catch (err) {
    console.warn('[notifications] primeNotificationPermission failed:', err);
  }
};

/**
 * Registers the notifee foreground-service task. MUST be called at module
 * scope in index.js (before AppRegistry.registerComponent), because Android
 * starts this headless task in its own JS runtime when the service launches.
 */
export const registerBackgroundKeepaliveTask = () => {
  const notifee = loadNotifee();
  if (!notifee) return;
  try {
    notifee.registerForegroundService((_notification: any) => {
      // Resolve *never*. Android keeps the JS thread alive as long as this
      // promise is pending, which keeps our socket.io connection + listener
      // subscriptions working while the app is backgrounded or screen-off.
      return new Promise(() => {});
    });
  } catch (err) {
    console.warn('[notifications] registerForegroundService failed:', err);
  }
};

/**
 * Start the persistent background-keepalive foreground service. The
 * notification is LOW importance (silent, shows in the tray like
 * "Uber: driver online") so it doesn't harass the driver but keeps
 * Android from killing the JS VM, which lets incoming dispatcher
 * messages deliver their own HIGH-importance heads-up notifications.
 */
export const startBackgroundKeepalive = async (driverName?: string) => {
  const notifee = loadNotifee();
  if (!notifee || keepaliveRunning) return;
  try {
    const constants = require('@notifee/react-native');
    await ensureKeepaliveChannel(notifee, constants);
    await notifee.displayNotification({
      id: KEEPALIVE_NOTIFICATION_ID,
      title: 'TaxiTime Driver',
      body: driverName ? `Connected · ${driverName}` : 'Connected to dispatch',
      data: { kind: 'keepalive' },
      android: {
        channelId: CHANNEL_ID_KEEPALIVE,
        smallIcon: 'ic_launcher',
        asForegroundService: true,
        ongoing: true,
        // Clear on-tap: opens the app instead of being stuck in the tray.
        pressAction: { id: 'default', launchActivity: 'default' },
        importance: constants?.AndroidImportance?.LOW ?? 2,
      },
    });
    keepaliveRunning = true;
  } catch (err) {
    console.warn('[notifications] startBackgroundKeepalive failed:', err);
  }
};

export const stopBackgroundKeepalive = async () => {
  const notifee = loadNotifee();
  if (!notifee || !keepaliveRunning) return;
  try {
    await notifee.stopForegroundService();
    keepaliveRunning = false;
  } catch (err) {
    console.warn('[notifications] stopBackgroundKeepalive failed:', err);
  }
};

/**
 * Register foreground + background tap handlers. No-ops if notifee isn't
 * linked yet. Returns a best-effort unsubscribe for the foreground listener.
 */
export const setupNotificationTapHandlers = (
  navigate: (screen: string, params?: any) => void,
): (() => void) => {
  const notifee = loadNotifee();
  if (!notifee) return () => {};
  try {
    const constants = require('@notifee/react-native');
    const EventType = constants?.EventType || {};

    const route = (data: any) => {
      if (!data || typeof data !== 'object') return;
      if (data.screen === 'DispatcherChat' || data.kind === 'dispatcher_message') {
        setTimeout(() => navigate('DispatcherChat', undefined), 250);
      }
    };

    const unsubForeground = notifee.onForegroundEvent(({ type, detail }: any) => {
      if (type === EventType.PRESS) route(detail?.notification?.data);
    });
    notifee.onBackgroundEvent(async ({ type, detail }: any) => {
      if (type === EventType.PRESS) route(detail?.notification?.data);
    });
    return typeof unsubForeground === 'function' ? unsubForeground : () => {};
  } catch (err) {
    console.warn('[notifications] setupTapHandlers failed:', err);
    return () => {};
  }
};
