/**
 * Hook for image + audio chat attachments.
 *
 * Handles:
 *   - Picking an image (camera or gallery) and converting to base64
 *   - Recording a voice note with tap-to-start / tap-to-stop UX
 *   - Playing back a received / sent voice note
 *
 * Attachments travel to the backend as a JSON array on the `messages` row:
 *   attachments: [{ kind: 'image'|'audio', mime, base64, durationMs?, fileName? }]
 *
 * No new disk files; no uploads to S3. Payloads live in the DB, matching the
 * same pattern we used for driver documents.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
} from 'react-native-image-picker';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

export type ChatAttachment = {
  kind: 'image' | 'audio';
  mime: string;
  base64: string;
  durationMs?: number;
  fileName?: string;
};

const requestMicPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone permission',
        message: 'Needed to record a voice message.',
        buttonPositive: 'OK',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};

export function useChatAttachments() {
  const recorderRef = useRef<AudioRecorderPlayer | null>(null);
  const playerRef = useRef<AudioRecorderPlayer | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Initialise / tear down a single recorder instance for this screen.
  useEffect(() => {
    recorderRef.current = new AudioRecorderPlayer();
    playerRef.current = new AudioRecorderPlayer();
    return () => {
      recorderRef.current?.stopRecorder().catch(() => {});
      playerRef.current?.stopPlayer().catch(() => {});
      recorderRef.current = null;
      playerRef.current = null;
    };
  }, []);

  // ---------- Image ----------
  const pickImage = useCallback(async (fromCamera: boolean): Promise<ChatAttachment | null> => {
    try {
      const res = fromCamera
        ? await launchCamera({
            mediaType: 'photo',
            quality: 0.7,
            includeBase64: true,
            saveToPhotos: false,
          })
        : await launchImageLibrary({
            mediaType: 'photo',
            quality: 0.7,
            selectionLimit: 1,
            includeBase64: true,
          });
      if (res.didCancel || res.errorCode) return null;
      const asset: Asset | undefined = res.assets?.[0];
      if (!asset?.base64) return null;
      return {
        kind: 'image',
        mime: asset.type || 'image/jpeg',
        base64: asset.base64,
        fileName: asset.fileName || `chat-${Date.now()}.jpg`,
      };
    } catch (err: any) {
      Alert.alert('Image', err?.message || 'Could not pick image');
      return null;
    }
  }, []);

  // ---------- Audio ----------
  const startRecording = useCallback(async () => {
    const ok = await requestMicPermission();
    if (!ok) {
      Alert.alert('Microphone', 'Microphone permission is required to record voice notes.');
      return;
    }
    try {
      await recorderRef.current?.startRecorder();
      setRecording(true);
      setRecordStartedAt(Date.now());
    } catch (err: any) {
      Alert.alert('Recording', err?.message || 'Could not start recording');
    }
  }, []);

  const stopRecordingAndGet = useCallback(async (): Promise<ChatAttachment | null> => {
    try {
      const filePath = await recorderRef.current?.stopRecorder();
      const durationMs = recordStartedAt ? Date.now() - recordStartedAt : undefined;
      setRecording(false);
      setRecordStartedAt(null);
      if (!filePath) return null;

      // react-native-audio-recorder-player defaults to m4a on Android / iOS.
      // Read the file back as base64. We use a tiny inline readFile via
      // fetch() which works on both platforms without an extra dep.
      const fileUri = Platform.OS === 'android' && !filePath.startsWith('file://')
        ? `file://${filePath}`
        : filePath;
      const resp = await fetch(fileUri);
      const blob = await resp.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new (global as any).FileReader();
        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => {
          const result: string = reader.result || '';
          // strip the "data:...;base64," prefix
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.readAsDataURL(blob);
      });
      return {
        kind: 'audio',
        mime: 'audio/mp4',
        base64,
        durationMs,
        fileName: `voice-${Date.now()}.m4a`,
      };
    } catch (err: any) {
      setRecording(false);
      setRecordStartedAt(null);
      Alert.alert('Recording', err?.message || 'Could not finish recording');
      return null;
    }
  }, [recordStartedAt]);

  const cancelRecording = useCallback(async () => {
    try {
      await recorderRef.current?.stopRecorder();
    } catch {}
    setRecording(false);
    setRecordStartedAt(null);
  }, []);

  // ---------- Playback ----------
  const playAudio = useCallback(async (id: string, base64: string, mime = 'audio/mp4') => {
    if (!playerRef.current) return;
    try {
      if (playingId === id) {
        await playerRef.current.stopPlayer();
        setPlayingId(null);
        return;
      }
      if (playingId) {
        await playerRef.current.stopPlayer().catch(() => {});
      }
      const dataUri = `data:${mime};base64,${base64}`;
      await playerRef.current.startPlayer(dataUri);
      setPlayingId(id);
      playerRef.current.addPlayBackListener((e: any) => {
        if (e?.currentPosition >= e?.duration) {
          playerRef.current?.stopPlayer().catch(() => {});
          setPlayingId(null);
        }
      });
    } catch (err: any) {
      Alert.alert('Playback', err?.message || 'Could not play audio');
      setPlayingId(null);
    }
  }, [playingId]);

  return {
    recording,
    recordStartedAt,
    playingId,
    pickImage,
    startRecording,
    stopRecordingAndGet,
    cancelRecording,
    playAudio,
  };
}
