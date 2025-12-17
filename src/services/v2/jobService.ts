import { v2Client, v1Client, withFallback, offlineQueue } from "./apiClient";

export type StopStatus =
  | "PENDING"
  | "EN_ROUTE"
  | "ARRIVED"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export const getActiveJob = async () => {
  return withFallback(
    async () => {
      const res = await v2Client.get("/driver/active-job");
      return res.data;
    },
    async () => {
      const res = await v1Client.get("/driver/active-job");
      return res.data;
    }
  );
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
