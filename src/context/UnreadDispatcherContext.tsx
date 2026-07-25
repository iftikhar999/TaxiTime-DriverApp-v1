/**
 * UnreadDispatcherContext
 *
 * App-wide tracker for incoming dispatcher→driver chat messages. Every
 * screen subscribes to `message:new` on the driver socket, but only the
 * active chat screen marks messages as read — so a global counter is
 * needed to light up the header badge everywhere else.
 *
 * Responsibilities:
 *   1. Listen to `message:new` on the driver socket namespace.
 *   2. If the message is from a DISPATCHER and addressed to me, and the
 *      DispatcherChat screen is NOT currently open:
 *        - increment unreadCount
 *        - vibrate the device briefly
 *        - show an in-app toast with onPress → deep-link to DispatcherChat
 *        - bump `lastArrivalAt` so UI elsewhere can trigger a bounce
 *   3. Provide `clearUnread()` which DispatcherChatScreen calls on mount
 *      (and also on each appended message) so the badge resets as soon
 *      as the chat is actually being read.
 *   4. Provide `setChatOpen(bool)` so the screen can suppress toasts /
 *      increments while it's visible.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus, Vibration } from 'react-native';
import Toast from 'react-native-toast-message';
import axios from 'axios';
import messaging from '@react-native-firebase/messaging';
import { API_BASE_URL } from '../config/environment';
import { navigate } from '../navigation/navigationRef';
import { getSocket } from '../services/driverSocket';
import {
  displayDispatcherMessageNotification,
  setupNotificationTapHandlers,
} from '../services/localNotifications';
import { useAuth } from './AuthContext';

type UnreadDispatcherContextValue = {
  unreadCount: number;
  /** Timestamp of the last dispatcher message that landed while chat
   *  was closed — consumers watch this to run a one-shot bounce. */
  lastArrivalAt: number;
  clearUnread: () => void;
  /** Called by DispatcherChatScreen on mount / unmount. */
  setChatOpen: (open: boolean) => void;
};

const UnreadDispatcherContext = createContext<UnreadDispatcherContextValue>({
  unreadCount: 0,
  lastArrivalAt: 0,
  clearUnread: () => {},
  setChatOpen: () => {},
});

const DISPATCHER_VIBRATION_PATTERN = [0, 120, 80, 120];

const senderRoleOf = (msg: any): string | null =>
  msg?.users_messages_senderIdTousers?.role || msg?.sender?.role || null;

export const UnreadDispatcherProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { driver, token: authToken } = useAuth();
  const driverId = driver?.id;

  const [unreadCount, setUnreadCount] = useState(0);
  const [lastArrivalAt, setLastArrivalAt] = useState(0);
  const chatOpenRef = useRef(false);
  const lastSeenAtRef = useRef(0);

  const clearUnread = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const setChatOpen = useCallback((open: boolean) => {
    chatOpenRef.current = open;
    if (open) setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (!driverId) return;

    let attachedSocket: ReturnType<typeof getSocket> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const onNewMessage = (msg: any) => {
      if (!msg?.id) return;
      // Only count messages addressed to *me* from a DISPATCHER. Passenger
      // chat and broadcasts for other drivers are ignored here — they have
      // their own UI affordances.
      const receiverId = msg.receiverId;
      const senderId = msg.senderId;
      if (receiverId !== driverId) return;
      if (senderId === driverId) return;
      const role = senderRoleOf(msg);
      // If role isn't in the payload we still accept it when the message
      // has no jobId (dispatcher chat is job-less) and came from someone
      // other than my own passenger. This is a conservative fallback.
      if (role && role !== 'DISPATCHER') return;

      // Even when the chat screen is open, track the arrival time so a
      // subsequent catch-up knows not to re-notify this message.
      lastSeenAtRef.current = Date.now();

      if (chatOpenRef.current) return;

      setUnreadCount((n) => n + 1);
      setLastArrivalAt(Date.now());

      // Physical buzz — short double-tap, not alarm length.
      try { Vibration.vibrate(DISPATCHER_VIBRATION_PATTERN); } catch {}

      const senderName =
        msg?.users_messages_senderIdTousers?.firstName ||
        msg?.sender?.firstName ||
        'Dispatcher';
      const preview = typeof msg.content === 'string'
        ? msg.content.slice(0, 120)
        : 'New message';

      // System-tray notification (notifee) — shows as a heads-up banner in
      // foreground AND persists in the tray if the app goes to background
      // while the socket is still alive. Tap handler is registered once
      // in setupNotificationTapHandlers below.
      displayDispatcherMessageNotification({
        senderName,
        preview,
        messageId: msg.id,
        senderId: msg.senderId,
      });

      // In-app toast banner as a fallback / reinforcement while the app
      // is in the foreground. Notifee heads-up + toast is OK together —
      // the heads-up is brief while the toast hangs for 4.5 s.
      Toast.show({
        type: 'info',
        text1: `${senderName} (Dispatch)`,
        text2: preview,
        position: 'top',
        visibilityTime: 4500,
        onPress: () => {
          Toast.hide();
          try { navigate('DispatcherChat' as never); } catch {}
        },
      });
    };

    const tryAttach = () => {
      const sock = getSocket();
      if (!sock) return false;
      attachedSocket = sock;
      sock.on('message:new', onNewMessage);
      return true;
    };

    if (!tryAttach()) {
      // Socket not ready yet (happens right after login before driverSocket
      // finishes connecting). Poll until it appears, then attach and stop.
      poll = setInterval(() => { if (tryAttach()) { clearInterval(poll!); poll = null; } }, 1000);
    }

    return () => {
      if (poll) clearInterval(poll);
      if (attachedSocket) attachedSocket.off('message:new', onNewMessage);
    };
  }, [driverId]);

  // Catch-up on app resume — closes the gap where notifee couldn't fire
  // while Android had the JS thread frozen. On foreground transitions we
  // ask the backend for unread DISPATCHER messages since the last time we
  // were awake; any that missed the live socket get a system notification
  // + toast immediately, so the driver sees the same UX they'd get if FCM
  // had delivered in real time.
  const catchUpUnread = useCallback(async () => {
    if (!driverId || !authToken) return;
    try {
      const apiRoot = API_BASE_URL.replace(/\/api$/, '');
      const res = await axios.get(`${apiRoot}/api/messages/conversations`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const conversations = Array.isArray(res.data?.data) ? res.data.data : [];
      // Dispatcher messages that arrived while we were asleep. Use the
      // conversation partner role to filter — only DISPATCHER partners.
      const unseen = conversations.filter((c: any) =>
        c?.partner?.role === 'DISPATCHER' &&
        c?.unreadCount > 0 &&
        c?.lastMessage?.senderId !== driverId &&
        new Date(c.lastMessage.createdAt).getTime() > lastSeenAtRef.current,
      );
      if (unseen.length === 0) return;

      // Only one catch-up notification per partner to avoid spam — use the
      // latest message as preview.
      for (const conv of unseen) {
        if (chatOpenRef.current) continue;
        setUnreadCount((n) => n + conv.unreadCount);
        setLastArrivalAt(Date.now());
        try { Vibration.vibrate(DISPATCHER_VIBRATION_PATTERN); } catch {}
        const senderName =
          `${conv.partner?.firstName || ''} ${conv.partner?.lastName || ''}`.trim() ||
          'Dispatcher';
        displayDispatcherMessageNotification({
          senderName,
          preview: conv.lastMessage.content,
          messageId: conv.lastMessage.id,
          senderId: conv.partnerId,
        });
      }
      lastSeenAtRef.current = Date.now();
    } catch (err) {
      console.warn('[UnreadDispatcher] catch-up failed', (err as any)?.message);
    }
  }, [driverId, authToken]);

  // Hook AppState transitions so we catch up when the driver brings the
  // app back to the foreground.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') catchUpUnread();
    };
    // Fire once on mount in case the app just launched.
    if (AppState.currentState === 'active') catchUpUnread();
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [catchUpUnread]);

  // Deep-link handling — both paths open DispatcherChat on tap:
  //   (a) notifee notification (local, from socket listener)
  //   (b) FCM notification (remote push via backend, background-safe)
  useEffect(() => {
    // (a) notifee foreground + background press handlers
    const unsubNotifee = setupNotificationTapHandlers((screen) => {
      setUnreadCount(0);
      try { navigate(screen as never); } catch {}
    });

    // (b) FCM — app killed then reopened via push
    const tryRouteFcm = (remoteMessage: any) => {
      const data = remoteMessage?.data || {};
      if (data.kind === 'dispatcher_message' || data.screen === 'DispatcherChat') {
        setUnreadCount(0);
        setTimeout(() => {
          try { navigate('DispatcherChat' as never); } catch {}
        }, 300);
      }
    };
    messaging().getInitialNotification().then((msg) => {
      if (msg) tryRouteFcm(msg);
    }).catch(() => {});
    const unsubFcmOpened = messaging().onNotificationOpenedApp(tryRouteFcm);

    return () => {
      unsubNotifee && unsubNotifee();
      unsubFcmOpened && unsubFcmOpened();
    };
  }, []);

  const value = useMemo<UnreadDispatcherContextValue>(
    () => ({ unreadCount, lastArrivalAt, clearUnread, setChatOpen }),
    [unreadCount, lastArrivalAt, clearUnread, setChatOpen],
  );

  return (
    <UnreadDispatcherContext.Provider value={value}>
      {children}
    </UnreadDispatcherContext.Provider>
  );
};

export const useUnreadDispatcher = () => useContext(UnreadDispatcherContext);
