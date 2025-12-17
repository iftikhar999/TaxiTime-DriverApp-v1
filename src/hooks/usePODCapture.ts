import { useState, useCallback } from "react";
import {
  captureSignature,
  capturePhoto,
  verifyPIN,
  getPodRequirements,
} from "../services/v2/podService";

export const usePODCapture = (stopId?: string) => {
  const [signature, setSignature] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [pin, setPin] = useState<string>("");
  const [requirements, setRequirements] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const refreshRequirements = useCallback(async () => {
    if (!stopId) return;
    const res = await getPodRequirements(stopId);
    setRequirements(res?.requirements ?? res);
  }, [stopId]);

  const submitSignature = useCallback(async () => {
    if (!stopId || !signature) return;
    setLoading(true);
    setError(null);
    try {
      await captureSignature(stopId, signature);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [stopId, signature]);

  const submitPhoto = useCallback(async () => {
    if (!stopId || !photo) return;
    setLoading(true);
    setError(null);
    try {
      await capturePhoto(stopId, photo);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [stopId, photo]);

  const submitPIN = useCallback(async () => {
    if (!stopId || !pin) return;
    setLoading(true);
    setError(null);
    try {
      await verifyPIN(stopId, pin);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [stopId, pin]);

  return {
    signature,
    setSignature,
    photo,
    setPhoto,
    pin,
    setPin,
    requirements,
    refreshRequirements,
    submitSignature,
    submitPhoto,
    submitPIN,
    loading,
    error,
  };
};

export default usePODCapture;
