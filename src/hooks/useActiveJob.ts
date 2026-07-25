import { useEffect, useState, useCallback } from "react";
import { getActiveJob, getJobStops } from "../services/v2/jobService";
import driverSocket from "../services/driverSocket";

export const useActiveJob = () => {
  const [job, setJob] = useState<any>(null);
  const [stops, setStops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const response = await getActiveJob();
      const active = response?.job || response?.data?.job || response;
      setJob(active);
      if (active?.id) {
        const stopResp = await getJobStops(active.id);
        setStops(stopResp?.stops || stopResp || []);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = driverSocket.getInstance?.();
    if (!socket) return;
    const onStop = (payload: any) => {
      if (payload?.jobId === job?.id) {
        refresh();
      }
    };
    socket.on("stop:status", onStop);
    socket.on("pod:captured", onStop);
    return () => {
      socket.off("stop:status", onStop);
      socket.off("pod:captured", onStop);
    };
  }, [job?.id, refresh]);

  return { job, stops, loading, error, refresh };
};

export default useActiveJob;
