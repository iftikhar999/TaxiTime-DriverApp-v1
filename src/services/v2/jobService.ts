import { v2Client, v1Client, withFallback, offlineQueue } from "./apiClient";
import httpClient from "../httpClient";

export type StopStatus =
  | "PENDING"
  | "EN_ROUTE"
  | "ARRIVED"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export const getActiveJob = async () => {
  // Authoritative "what job am I on?" lookup. Used on app foreground resume
  // so drivers returning from Google Maps / backgrounded state re-sync with
  // server truth before continuing the meter. Returns { job } or { job: null }
  // when the driver has no active job.
  try {
    const res = await httpClient.get('/mobile/driver/jobs/current');
    return res.data?.job ?? null;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    console.warn('[jobService.getActiveJob] failed', err?.message);
    return null;
  }
};

export const getJobStops = async (jobId: string) => {
  return withFallback(
    async () => {
      const res = await v2Client.get(`/jobs/${jobId}/stops`);
      return res.data;
    },
    async () => {
      const res = await v1Client.get(`/jobs/${jobId}/stops`);
      return res.data;
    }
  );
};

export const updateStopStatus = async (
  stopId: string,
  status: StopStatus,
  metadata: any = {}
) => {
  const config = {
    method: "patch",
    url: `/jobs/stops/${stopId}/status`,
    data: { status, ...metadata },
  };
  try {
    const res = await v2Client.request(config);
    return res.data;
  } catch (error) {
    // queue for later if offline
    await offlineQueue.enqueue({ config: { ...config, baseURL: v2Client.defaults.baseURL } });
    // attempt v1 fallback
    const res = await v1Client.request(config);
    return res.data;
  }
};

export default { getActiveJob, getJobStops, updateStopStatus };
