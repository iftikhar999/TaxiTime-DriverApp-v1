import { PermissionsAndroid, Platform } from "react-native";
import type { MediaStream, RTCSessionDescriptionInit } from "react-native-webrtc";
import {
    mediaDevices,
    RTCIceCandidate,
    RTCIceCandidateInit,
    RTCPeerConnection,
} from "react-native-webrtc";
import {
    DriverVideoStreamingState,
    DriverVideoStreamListener,
} from "../types/video";
import { ensureDriverSocket, getSocket } from "./driverSocket";

type StartDriverVideoStreamParams = {
  jobId: string;
  driverId: string;
  companyId?: string | null;
};

type SocketCallbackSet = {
  answer?: (payload: any) => void;
  viewerCandidate?: (payload: any) => void;
  viewerCount?: (payload: any) => void;
  stop?: (payload: any) => void;
} | null;

const STREAM_SOCKET_EVENTS = {
  ANSWER: "driver:video:answer",
  VIEWER_CANDIDATE: "driver:video:viewer-candidate",
  VIEWER_COUNT: "driver:video:viewer-count",
  STOP: "driver:video:stop",
};

const DRIVER_EMIT_EVENTS = {
  OFFER: "driver:video:offer",
  ICE: "driver:video:ice",
  STOP: "driver:video:stop",
};

const ICE_SERVERS = [
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

const DEFAULT_VIDEO_CONSTRAINTS = {
  facingMode: "user" as const,
  frameRate: 24,
  width: 640,
  height: 480,
};

const listeners = new Set<DriverVideoStreamListener>();

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let activeSession: StartDriverVideoStreamParams | null = null;
let socketCallbacks: SocketCallbackSet = null;

let state: DriverVideoStreamingState = {
  status: "idle",
  jobId: null,
  driverId: null,
  companyId: null,
  localStream: null,
  viewerCount: 0,
  startedAt: null,
  lastUpdatedAt: Date.now(),
  error: null,
  lastStoppedReason: null,
};

const updateState = (patch: Partial<DriverVideoStreamingState>) => {
  state = {
    ...state,
    ...patch,
    lastUpdatedAt: Date.now(),
  };

  listeners.forEach((listener) => listener(state));
};

const requestAndroidVideoPermissions = async () => {
  if (Platform.OS !== "android") {
    return;
  }

  const permissions = [
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ];

  const result = await PermissionsAndroid.requestMultiple(permissions);

  const denied = permissions.some(
    (permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED
  );

  if (denied) {
    throw new Error(
      "Camera and microphone permissions are required for live video streaming."
    );
  }
};

const cleanupPeerConnection = () => {
  if (peerConnection) {
    try {
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
    } catch (error) {
      console.warn("[video] Failed to close peer connection", error);
    } finally {
      peerConnection = null;
    }
  }
};

const cleanupLocalStream = () => {
  if (localStream) {
    try {
      localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn("[video] Failed to stop track", error);
        }
      });
    } finally {
      localStream = null;
    }
  }
};

const unregisterSocketHandlers = () => {
  if (!socketCallbacks) {
    return;
  }

  const socket = getSocket();
  if (socket) {
    if (socketCallbacks.answer) {
      socket.off(STREAM_SOCKET_EVENTS.ANSWER, socketCallbacks.answer);
    }
    if (socketCallbacks.viewerCandidate) {
      socket.off(
        STREAM_SOCKET_EVENTS.VIEWER_CANDIDATE,
        socketCallbacks.viewerCandidate
      );
    }
    if (socketCallbacks.viewerCount) {
      socket.off(STREAM_SOCKET_EVENTS.VIEWER_COUNT, socketCallbacks.viewerCount);
    }
    if (socketCallbacks.stop) {
      socket.off(STREAM_SOCKET_EVENTS.STOP, socketCallbacks.stop);
    }
  }

  socketCallbacks = null;
};

const registerSocketHandlers = () => {
  if (socketCallbacks) {
    return;
  }

  const socket = getSocket();
  if (!socket) {
    return;
  }

  const handleAnswer = async (payload: any = {}) => {
    if (!activeSession || payload?.jobId !== activeSession.jobId) {
      return;
    }
    if (!peerConnection || !payload?.answer) {
      return;
    }

    const answer: RTCSessionDescriptionInit = {
      type: payload.answer.type,
      sdp: payload.answer.sdp,
    };

    try {
      await peerConnection.setRemoteDescription(answer);
      updateState({ status: "streaming", error: null });
    } catch (error) {
      console.error("[video] Failed to apply dispatcher answer", error);
      updateState({
        status: "error",
        error: "Failed to connect to dispatcher video feed.",
      });
    }
  };

  const handleViewerCandidate = async (payload: any = {}) => {
    if (!activeSession || payload?.jobId !== activeSession.jobId) {
      return;
    }
    if (!peerConnection || !payload?.candidate) {
      return;
    }

    try {
      const candidate: RTCIceCandidateInit = payload.candidate;
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("[video] Failed to add viewer ICE candidate", error);
    }
  };

  const handleViewerCount = (payload: any = {}) => {
    if (!activeSession || payload?.jobId !== activeSession.jobId) {
      return;
    }
    const viewerCount =
      typeof payload?.viewerCount === "number" ? payload.viewerCount : 0;
    updateState({ viewerCount: Math.max(viewerCount, 0) });
  };

  const handleStopRequest = (payload: any = {}) => {
    if (!activeSession) {
      return;
    }
    if (payload?.jobId && payload.jobId !== activeSession.jobId) {
      return;
    }
    stopDriverVideoStream(payload?.reason || "dispatcher_stop").catch(
      (error) => {
        console.warn("[video] Failed to stop stream on dispatcher request", error);
      }
    );
  };

  socket.on(STREAM_SOCKET_EVENTS.ANSWER, handleAnswer);
  socket.on(STREAM_SOCKET_EVENTS.VIEWER_CANDIDATE, handleViewerCandidate);
  socket.on(STREAM_SOCKET_EVENTS.VIEWER_COUNT, handleViewerCount);
  socket.on(STREAM_SOCKET_EVENTS.STOP, handleStopRequest);

  socketCallbacks = {
    answer: handleAnswer,
    viewerCandidate: handleViewerCandidate,
    viewerCount: handleViewerCount,
    stop: handleStopRequest,
  };
};

export const subscribeToDriverVideoState = (
  listener: DriverVideoStreamListener
): (() => void) => {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
};

export const getDriverVideoStreamingState = (): DriverVideoStreamingState =>
  state;

export const startDriverVideoStream = async ({
  jobId,
  driverId,
  companyId,
}: StartDriverVideoStreamParams): Promise<MediaStream | null> => {
  console.log('[video] 🎬 startDriverVideoStream called:', { jobId, driverId, companyId });
  
  if (!jobId || !driverId) {
    throw new Error("jobId and driverId are required to stream video.");
  }

  const isSameJob = activeSession?.jobId === jobId;
  const isBusyState = state.status !== "idle" && state.status !== "error";

  console.log('[video] 📊 Session state:', { isSameJob, isBusyState, currentStatus: state.status });

  if (isSameJob && isBusyState) {
    console.log('[video] ⏭️ Already streaming for this job');
    return localStream;
  }

  if (activeSession && activeSession.jobId !== jobId) {
    console.log('[video] 🔄 Switching to different job');
    await stopDriverVideoStream("switching_job");
  }

  activeSession = { jobId, driverId, companyId };

  updateState({
    status: "requesting_permissions",
    jobId,
    driverId,
    companyId,
    localStream: null,
    error: null,
    viewerCount: 0,
    startedAt: null,
    lastStoppedReason: null,
  });

  try {
    console.log('[video] 📱 Requesting camera permissions...');
    await requestAndroidVideoPermissions();
    console.log('[video] ✅ Permissions granted');

    console.log('[video] 📸 Getting user media...');
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: DEFAULT_VIDEO_CONSTRAINTS.facingMode,
        frameRate: DEFAULT_VIDEO_CONSTRAINTS.frameRate,
        width: DEFAULT_VIDEO_CONSTRAINTS.width,
        height: DEFAULT_VIDEO_CONSTRAINTS.height,
      },
    });
    console.log('[video] ✅ Got media stream:', { tracks: stream.getTracks().length });

    localStream = stream;

    const socket = ensureDriverSocket({
      driverId,
      companyId: companyId ?? undefined,
    });
    console.log('[video] 🔌 Socket ensured:', { connected: socket?.connected });
    registerSocketHandlers();

    peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    console.log('[video] 🔗 Peer connection created');

    stream.getTracks().forEach((track) => {
      try {
        peerConnection?.addTrack(track, stream);
        console.log('[video] ➕ Track added:', track.kind);
      } catch (error) {
        console.warn("[video] Failed to add track to peer connection", error);
      }
    });

    updateState({
      status: "starting",
      localStream: stream,
      startedAt: Date.now(),
    });

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      console.log('[video] 🧊 ICE candidate:', event.candidate.candidate?.substring(0, 50));
      socket?.emit(DRIVER_EMIT_EVENTS.ICE, {
        jobId,
        driverId,
        companyId,
        candidate: event.candidate.toJSON
          ? event.candidate.toJSON()
          : event.candidate,
      });
    };

    peerConnection.onconnectionstatechange = () => {
      const connectionState = peerConnection?.connectionState;
      console.log('[video] 🔄 Connection state changed:', connectionState);
      if (connectionState === "connected") {
        updateState({ status: "streaming", error: null });
        return;
      }

      if (connectionState === "failed" || connectionState === "disconnected") {
        if (activeSession) {
          stopDriverVideoStream(`peer_${connectionState}`).catch((error) => {
            console.warn("[video] Failed to stop stream after peer failure", error);
          });
        }
      }
    };

    console.log('[video] 📝 Creating offer...');
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    console.log('[video] ✅ Offer created');

    await peerConnection.setLocalDescription(offer);
    console.log('[video] ✅ Local description set');

    console.log('[video] 📤 Emitting offer to server...');
    socket.emit(DRIVER_EMIT_EVENTS.OFFER, {
      jobId,
      driverId,
      companyId,
      offer: offer.toJSON ? offer.toJSON() : offer,
      media: {
        audio: true,
        video: DEFAULT_VIDEO_CONSTRAINTS,
      },
      startedAt: new Date().toISOString(),
    });
    console.log('[video] ✅ Offer emitted successfully');

    return stream;
  } catch (error) {
    console.error("[video] Failed to start driver video stream", error);
    updateState({
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Unable to start video streaming.",
    });
    await stopDriverVideoStream("start_failed");
    throw error;
  }
};

export const stopDriverVideoStream = async (
  reason?: string
): Promise<void> => {
  if (
    state.status === "idle" &&
    !activeSession &&
    !localStream &&
    !peerConnection
  ) {
    return;
  }

  updateState({ status: "stopping" });

  const session = activeSession;
  activeSession = null;

  const socket = getSocket();
  if (socket && session?.jobId && session?.driverId) {
    socket.emit(DRIVER_EMIT_EVENTS.STOP, {
      jobId: session.jobId,
      driverId: session.driverId,
      companyId: session.companyId,
      reason,
    });
  }

  cleanupPeerConnection();
  cleanupLocalStream();
  unregisterSocketHandlers();

  updateState({
    status: "idle",
    jobId: null,
    driverId: null,
    companyId: null,
    localStream: null,
    viewerCount: 0,
    startedAt: null,
    error: null,
    lastStoppedReason: reason ?? null,
  });
};
