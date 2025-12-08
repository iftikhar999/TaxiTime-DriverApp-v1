import type { MediaStream } from "react-native-webrtc";

export type DriverVideoStreamingStatus =
  | "idle"
  | "requesting_permissions"
  | "starting"
  | "streaming"
  | "stopping"
  | "error";

export interface DriverVideoStreamingState {
  status: DriverVideoStreamingStatus;
  jobId: string | null;
  driverId: string | null;
  companyId?: string | null;
  localStream: MediaStream | null;
  viewerCount: number;
  startedAt: number | null;
  lastUpdatedAt: number;
  error: string | null;
  lastStoppedReason?: string | null;
}

export type DriverVideoStreamListener = (
  state: DriverVideoStreamingState
) => void;
