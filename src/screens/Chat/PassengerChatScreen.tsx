/**
 * PassengerChatScreen — in-ride chat between driver and passenger.
 *
 * Route params:
 *   jobId         — internal UUID
 *   passengerId   — other side of the chat
 *   passengerName — displayed in the header
 *
 * Wire-up:
 *  - Fetches prior messages on mount via GET /api/messages/job/:jobId
 *  - Subscribes to `message:new` on the driver socket namespace; appends incoming
 *  - POSTs new messages via POST /api/messages; backend fan-outs to passenger
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, Image,
  Keyboard, Platform, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';
import { API_BASE_URL } from '../../config/environment';
import { getSocket } from '../../services/driverSocket';
import { useAuth } from '../../context/AuthContext';
import { useChatAttachments } from './useChatAttachments';

type Attachment = {
  kind: 'image' | 'audio';
  mime: string;
  base64: string;
  durationMs?: number;
  fileName?: string;
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

const PassengerChatScreen: React.FC<any> = ({ navigation, route }) => {
  const { jobId, passengerId, passengerName } = route.params || {};
  const { token, driver } = useAuth();
  const driverId = driver?.id;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const attachments = useChatAttachments();

  // Bulletproof keyboard avoidance — matches DispatcherChatScreen. See
  // comment there for the full reasoning; in short, we lift the input row
  // manually to sidestep the Android OEM inconsistencies with
  // KeyboardAvoidingView and adjustResize.
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

  useEffect(() => {
    loadMessages();
    const socket = getSocket();
    const onNewMessage = (msg: any) => {
      // Only append messages that belong to this conversation
      if (msg.jobId && jobId && msg.jobId !== jobId && msg.jobId !== passengerId) return;
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, {
          id: msg.id,
          senderId: msg.senderId,
          receiverId: msg.receiverId,
          content: msg.content,
          createdAt: msg.createdAt,
          isMine: msg.senderId === driverId,
        }];
      });
    };
    socket?.on('message:new', onNewMessage);
    return () => { socket?.off('message:new', onNewMessage); };
  }, [jobId, driverId]);

  const loadMessages = async () => {
    try {
      const path = jobId ? `/api/messages/job/${jobId}` : `/api/messages/conversation/${passengerId}`;
      const res = await axios.get(`${API_BASE_URL.replace(/\/api$/, '')}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = Array.isArray(res.data?.data) ? res.data.data : [];
      setMessages(data.map((m: any) => ({
        id: m.id,
        senderId: m.senderId,
        receiverId: m.receiverId,
        content: m.content,
        createdAt: m.createdAt,
        isMine: m.senderId === driverId,
      })));
    } catch (_err) {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const send = async (opts?: { attachments?: Attachment[] }) => {
    const text = input.trim();
    const atts = opts?.attachments;
    const hasAtts = Array.isArray(atts) && atts.length > 0;
    if (!text && !hasAtts) return;
    if (sending) return;
    setSending(true);
    try {
      const body: any = {
        receiverId: passengerId,
        content: text || (hasAtts ? (atts[0].kind === 'audio' ? '🎤 Voice note' : '📷 Photo') : ''),
        messageType: hasAtts && atts[0].kind === 'image' ? 'IMAGE' : 'TEXT',
        jobId: jobId || null,
      };
      if (hasAtts) body.attachments = atts;
      const res = await axios.post(
        `${API_BASE_URL.replace(/\/api$/, '')}/api/messages`,
        body,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const msg = res.data?.data;
      if (msg) {
        setMessages(prev => [...prev, {
          id: msg.id,
          senderId: msg.senderId,
          receiverId: msg.receiverId,
          content: msg.content,
          createdAt: msg.createdAt,
          isMine: true,
          attachments: hasAtts ? atts : null,
        }]);
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

  const renderItem = ({ item }: { item: Message }) => {
    const hasAtts = Array.isArray(item.attachments) && item.attachments.length > 0;
    return (
      <View style={[styles.bubbleRow, item.isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <View style={[styles.bubble, item.isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {hasAtts && item.attachments!.map((att, i) => {
            if (att.kind === 'image') {
              return (
                <Image
                  key={`${item.id}-att-${i}`}
                  source={{ uri: `data:${att.mime};base64,${att.base64}` }}
                  style={styles.attachImage}
                  resizeMode="cover"
                />
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
            return null;
          })}
          {item.content && (!hasAtts || !['🎤 Voice note', '📷 Photo'].includes(item.content)) && (
            <Text style={[styles.bubbleText, item.isMine ? { color: '#000' } : { color: '#FFF' }, hasAtts && { marginTop: 6 }]}>
              {item.content}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{passengerName || 'Passenger'}</Text>
          <Text style={styles.headerSubtitle}>Chat for ride</Text>
        </View>
      </View>

      <View style={{ flex: 1, paddingBottom: effectivePadding }}>
        {loading ? (
          <View style={styles.loadingWrap}><ActivityIndicator color="#FFD166" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderItem}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 24, flexGrow: 1 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Icon name="chat-bubble-outline" size={48} color="#555" />
                <Text style={styles.emptyText}>No messages yet.{'\n'}Say hi to your passenger.</Text>
              </View>
            }
          />
        )}

        <View style={styles.inputRow}>
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
            placeholder={attachments.recording ? 'Recording…' : 'Type a message...'}
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
            {sending
              ? <ActivityIndicator color="#000" />
              : <Icon name="send" size={20} color="#000" />}
          </TouchableOpacity>
        </View>
      </View>
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  backBtn: { padding: 6, marginRight: 8 },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  headerSubtitle: { color: '#8b949e', fontSize: 12, marginTop: 2 },
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
});

export default PassengerChatScreen;
