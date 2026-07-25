/**
 * DispatcherChatScreen — real-time chat between the driver and their
 * company dispatcher. Mirrors PassengerChatScreen but:
 *
 *   - Resolves the dispatcher via GET /api/messages/my-dispatcher on mount
 *     (so the driver app never has to store dispatcher IDs).
 *   - Conversation is keyed by `{driverId, dispatcherId}` pair (no jobId),
 *     so it persists across shifts.
 *   - Filters incoming `message:new` socket events by partner id rather
 *     than jobId, since dispatcher chat is not tied to a specific ride.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';
import { API_BASE_URL } from '../../config/environment';
import { getSocket } from '../../services/driverSocket';
import { useAuth } from '../../context/AuthContext';
import { useUnreadDispatcher } from '../../context/UnreadDispatcherContext';
import { useChatAttachments } from './useChatAttachments';

type Attachment = {
  kind: 'image' | 'audio' | 'file';
  mime: string;
  base64: string;
  durationMs?: number;
  fileName?: string;
  sizeBytes?: number;
};

type Message = {
  id: string;
  senderId: string;
  receiverId: string | null;
  content: string;
  createdAt: string;
  isMine: boolean;
  attachments?: Attachment[] | null;
};

type Dispatcher = {
  id: string;
  firstName?: string;
  lastName?: string;
  avatar?: string | null;
};

const apiRoot = API_BASE_URL.replace(/\/api$/, '');

const DispatcherChatScreen: React.FC<any> = ({ navigation }) => {
  const { token, driver } = useAuth();
  const driverId = driver?.id;
  const insets = useSafeAreaInsets();
  const { setChatOpen } = useUnreadDispatcher();

  // Tell the global unread tracker that we are now viewing the chat —
  // suppresses toasts / vibrations and zeroes the badge. Reset on unmount
  // so subsequent incoming messages resume announcing themselves.
  useEffect(() => {
    setChatOpen(true);
    return () => setChatOpen(false);
  }, [setChatOpen]);

  const [dispatcher, setDispatcher] = useState<Dispatcher | null>(null);
  const [dispatcherError, setDispatcherError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const attachments = useChatAttachments();

  // Bulletproof keyboard avoidance. React Native's KeyboardAvoidingView on
  // Android is unreliable across OEMs (Realme/ColorOS, Xiaomi/MIUI,
  // Samsung/OneUI all behave differently with adjustResize). We track both
  // the keyboard height (via RN's Keyboard listener) and the window height
  // (via useWindowDimensions, which updates when adjustResize fires). If the
  // window already shrank by the keyboard height, we add zero padding; if
  // the OS ignored adjustResize, we add the full keyboard height as
  // paddingBottom. Works on every device regardless of OEM quirks.
  const { height: winHeight } = useWindowDimensions();
  const baselineHeightRef = useRef(winHeight);
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height || 0);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    });
    const h = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);
  const shrinkAmount = Math.max(0, baselineHeightRef.current - winHeight);
  const effectivePadding = Math.max(0, kbHeight - shrinkAmount);

  // Resolve "my dispatcher" first, then load the conversation. If no
  // dispatcher is on duty for the company we still render the screen with
  // a friendly empty state so the driver knows the feature is reachable.
  const resolveDispatcher = useCallback(async (): Promise<Dispatcher | null> => {
    try {
      const res = await axios.get(`${apiRoot}/api/messages/my-dispatcher`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = res.data?.data;
      if (d?.id) return d as Dispatcher;
      setDispatcherError('No dispatcher on duty right now. Leave a message and they will see it.');
      return null;
    } catch (err: any) {
      const status = err?.response?.status;
      setDispatcherError(
        status === 404
          ? 'No dispatcher on duty right now. Leave a message and they will see it.'
          : 'Could not reach the dispatcher service. You can still send a message.',
      );
      return null;
    }
  }, [token]);

  const loadMessages = useCallback(async (partnerId: string) => {
    try {
      const res = await axios.get(
        `${apiRoot}/api/messages/conversation/${partnerId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = Array.isArray(res.data?.data) ? res.data.data : [];
      setMessages(
        data.map((m: any) => ({
          id: m.id,
          senderId: m.senderId,
          receiverId: m.receiverId,
          content: m.content,
          createdAt: m.createdAt,
          isMine: m.senderId === driverId,
          attachments: Array.isArray(m.attachments) ? m.attachments : null,
        })),
      );
    } catch (_err) {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [driverId, token]);

  useEffect(() => {
    let partnerId: string | null = null;
    (async () => {
      const d = await resolveDispatcher();
      if (d) {
        setDispatcher(d);
        partnerId = d.id;
        await loadMessages(d.id);
      } else {
        setLoading(false);
      }
    })();

    const socket = getSocket();
    const onNewMessage = (msg: any) => {
      // Only append messages where the driver and dispatcher are the two
      // parties — not passenger chat, not broadcasts for other drivers.
      if (!partnerId) return;
      const parties = [msg.senderId, msg.receiverId];
      if (!(parties.includes(driverId) && parties.includes(partnerId))) return;
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [
          ...prev,
          {
            id: msg.id,
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            content: msg.content,
            createdAt: msg.createdAt,
            isMine: msg.senderId === driverId,
            attachments: Array.isArray(msg.attachments) ? msg.attachments : null,
          },
        ];
      });
    };
    socket?.on('message:new', onNewMessage);
    return () => { socket?.off('message:new', onNewMessage); };
  }, [driverId, loadMessages, resolveDispatcher]);

  const send = async (opts?: { attachments?: Attachment[]; contentOverride?: string }) => {
    const text = (opts?.contentOverride ?? input).trim();
    const attachments = opts?.attachments;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!text && !hasAttachments) return;
    if (sending) return;
    // Re-resolve on every send in case the on-duty dispatcher rotated
    // since the screen opened — avoids sending into a black hole.
    let target = dispatcher;
    if (!target) {
      target = await resolveDispatcher();
      if (target) setDispatcher(target);
    }
    if (!target) return;
    setSending(true);
    try {
      const messageType =
        hasAttachments && attachments[0].kind === 'image' ? 'IMAGE' : 'TEXT';
      const body: any = {
        receiverId: target.id,
        content: text || (hasAttachments ? (attachments[0].kind === 'audio' ? '🎤 Voice note' : '📷 Photo') : ''),
        messageType,
      };
      if (hasAttachments) body.attachments = attachments;
      const res = await axios.post(
        `${apiRoot}/api/messages`,
        body,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const msg = res.data?.data;
      if (msg) {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            content: msg.content,
            createdAt: msg.createdAt,
            isMine: true,
            attachments: hasAttachments ? attachments : null,
          },
        ]);
        if (!opts) setInput('');
        setTimeout(() => {
          listRef.current?.scrollToEnd({ animated: true });
          inputRef.current?.focus();
        }, 50);
      }
    } catch (_err) {
      Alert.alert('Send failed', 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const headerLabel = dispatcher
    ? `${dispatcher.firstName || 'Dispatcher'} ${dispatcher.lastName || ''}`.trim() || 'Dispatcher'
    : 'Dispatcher';

  const renderItem = ({ item }: { item: Message }) => {
    const hasAttachments = Array.isArray(item.attachments) && item.attachments.length > 0;
    return (
      <View style={[styles.bubbleRow, item.isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <View style={[styles.bubble, item.isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {hasAttachments && item.attachments!.map((att, i) => {
            if (att.kind === 'image') {
              const uri = `data:${att.mime};base64,${att.base64}`;
              return (
                <TouchableOpacity
                  key={`${item.id}-att-${i}`}
                  activeOpacity={0.9}
                  onPress={() => setLightboxSrc(uri)}
                >
                  <Image
                    source={{ uri }}
                    style={styles.attachImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              );
            }
            if (att.kind === 'audio') {
              const isPlaying = attachments.playingId === `${item.id}-${i}`;
              const secs = att.durationMs ? Math.round(att.durationMs / 1000) : null;
              return (
                <TouchableOpacity
                  key={`${item.id}-att-${i}`}
                  style={[styles.attachAudio, item.isMine ? styles.attachAudioMine : styles.attachAudioTheirs]}
                  onPress={() => attachments.playAudio(`${item.id}-${i}`, att.base64, att.mime)}
                  activeOpacity={0.7}
                >
                  <Icon name={isPlaying ? 'pause' : 'play-arrow'} size={22} color={item.isMine ? '#000' : '#FFF'} />
                  <View style={styles.attachAudioWaveform} />
                  <Text style={{ color: item.isMine ? '#000' : '#FFF', fontSize: 12, fontWeight: '600' }}>
                    {secs != null ? `${secs}s` : 'Voice'}
                  </Text>
                </TouchableOpacity>
              );
            }
            if (att.kind === 'file') {
              // Without react-native-fs we can't write the binary to disk, but
              // we CAN surface the document to the driver and let them share
              // its metadata. Treat this as a first-class attachment: show the
              // filename, size, and a tap affordance that opens the system
              // share sheet so the driver can forward the base64 payload to a
              // note-taking / email app if they need the document on-device.
              const sizeKb = att.sizeBytes ? Math.max(1, Math.round(att.sizeBytes / 1024)) : null;
              const prettyName = att.fileName || 'Document';
              return (
                <TouchableOpacity
                  key={`${item.id}-att-${i}`}
                  style={[styles.attachFile, item.isMine ? styles.attachFileMine : styles.attachFileTheirs]}
                  onPress={() => {
                    Share.share({
                      title: prettyName,
                      message: `Dispatcher sent you a document: ${prettyName}${sizeKb ? ` (${sizeKb} KB)` : ''}`,
                    }).catch(() => {});
                  }}
                  activeOpacity={0.8}
                >
                  <Icon name="attach-file" size={20} color={item.isMine ? '#000' : '#FFF'} />
                  <View style={{ flex: 1, marginLeft: 6 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: item.isMine ? '#000' : '#FFF', fontSize: 13, fontWeight: '600' }}
                    >
                      {prettyName}
                    </Text>
                    {sizeKb ? (
                      <Text style={{ color: item.isMine ? '#333' : '#aaa', fontSize: 11, marginTop: 1 }}>
                        {sizeKb} KB
                      </Text>
                    ) : null}
                  </View>
                  <Icon name="ios-share" size={18} color={item.isMine ? '#000' : '#FFF'} />
                </TouchableOpacity>
              );
            }
            return null;
          })}
          {item.content && (!hasAttachments || !['🎤 Voice note', '📷 Photo'].includes(item.content)) && (
            <Text style={[styles.bubbleText, item.isMine ? { color: '#000' } : { color: '#FFF' }, hasAttachments && { marginTop: 6 }]}>
              {item.content}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#161b22" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{headerLabel}</Text>
          <Text style={styles.headerSubtitle}>Dispatcher · Live</Text>
        </View>
        <View style={styles.presenceDot} />
      </View>

      <View style={{ flex: 1, paddingBottom: effectivePadding }}>
        {loading ? (
          <View style={styles.loadingWrap}><ActivityIndicator color="#FFD166" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 24, flexGrow: 1 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Icon name="support-agent" size={48} color="#555" />
                <Text style={styles.emptyText}>
                  {dispatcherError ||
                    'No messages yet.\nSay hi — dispatch will reply in real-time.'}
                </Text>
              </View>
            }
          />
        )}

        <View style={styles.inputRow}>
          {/* Attach photo from gallery */}
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={async () => {
              const att = await attachments.pickImage(false);
              if (att) await send({ attachments: [att] });
            }}
            disabled={sending || attachments.recording}
          >
            <Icon name="photo" size={22} color="#FFD166" />
          </TouchableOpacity>
          {/* Take photo with camera */}
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={async () => {
              const att = await attachments.pickImage(true);
              if (att) await send({ attachments: [att] });
            }}
            disabled={sending || attachments.recording}
          >
            <Icon name="photo-camera" size={22} color="#FFD166" />
          </TouchableOpacity>
          {attachments.recording ? (
            <TouchableOpacity
              style={[styles.attachBtn, { backgroundColor: '#ef4444' }]}
              onPress={async () => {
                const att = await attachments.stopRecordingAndGet();
                if (att) await send({ attachments: [att] });
              }}
            >
              <Icon name="stop" size={22} color="#FFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={() => attachments.startRecording()}
              disabled={sending}
            >
              <Icon name="mic" size={22} color="#FFD166" />
            </TouchableOpacity>
          )}

          <TextInput
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={attachments.recording ? 'Recording…' : 'Message dispatcher...'}
            placeholderTextColor="#777"
            returnKeyType="send"
            onSubmitEditing={() => {
              if (input.trim() && !sending) send();
            }}
            editable={!attachments.recording}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => send()}
            disabled={sending || !input.trim() || attachments.recording}
          >
            {sending ? <ActivityIndicator color="#000" /> : <Icon name="send" size={20} color="#000" />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Image lightbox — tap anywhere (or the × button) to close. Parity with
          the dispatcher's chat inbox so drivers can read documents sent to
          them (e.g. driver licence photos, screenshot instructions). */}
      <Modal
        visible={lightboxSrc !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxSrc(null)}
      >
        <TouchableOpacity
          style={styles.lightboxBackdrop}
          activeOpacity={1}
          onPress={() => setLightboxSrc(null)}
        >
          {lightboxSrc && (
            <Image
              source={{ uri: lightboxSrc }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setLightboxSrc(null)}
          >
            <Icon name="close" size={26} color="#FFF" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  backBtn: { padding: 6, marginRight: 8 },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  headerSubtitle: { color: '#8b949e', fontSize: 12, marginTop: 2 },
  presenceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
    marginLeft: 8,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', padding: 40 },
  emptyText: { color: '#8b949e', textAlign: 'center', marginTop: 12 },
  bubbleRow: { marginVertical: 4, flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  bubbleMine: { backgroundColor: '#FFD166', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#21262d', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    backgroundColor: '#161b22',
  },
  input: {
    flex: 1,
    backgroundColor: '#21262d',
    color: '#FFF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFD166',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  attachImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginBottom: 2,
  },
  attachAudio: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    minWidth: 160,
    gap: 8,
  },
  attachAudioMine: {
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  attachAudioTheirs: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  attachAudioWaveform: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(128,128,128,0.55)',
    borderRadius: 1,
  },
  attachFile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    minWidth: 180,
    maxWidth: 260,
  },
  attachFileMine: { backgroundColor: 'rgba(0,0,0,0.08)' },
  attachFileTheirs: { backgroundColor: 'rgba(255,255,255,0.12)' },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: { width: '95%', height: '85%' },
  lightboxClose: {
    position: 'absolute',
    top: 40,
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default DispatcherChatScreen;
