import { useState, useCallback } from "react";
import { updateStopStatus } from "../services/v2/jobService";

export const useStopActions = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const changeStatus = useCallback(async (stopId: string, status: string) => {
    setLoading(true);
    setError(null);
    try {
      await updateStopStatus(stopId, status as any);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    arrive: (stopId: string) => changeStatus(stopId, "ARRIVED"),
    complete: (stopId: string) => changeStatus(stopId, "COMPLETED"),
    fail: (stopId: string) => changeStatus(stopId, "FAILED"),
    skip: (stopId: string) => changeStatus(stopId, "SKIPPED"),
  };
};

export default useStopActions;
