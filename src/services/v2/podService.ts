import { v2Client, withFallback } from "./apiClient";

export const captureSignature = async (stopId: string, signatureData: string) => {
  const res = await v2Client.post(`/jobs/stops/${stopId}/pod/signature`, {
    signatureData,
  });
  return res.data;
};

export const capturePhoto = async (stopId: string, photoUri: string) => {
  const res = await v2Client.post(`/jobs/stops/${stopId}/pod/photo`, {
    photoUrl: photoUri,
  });
  return res.data;
};

export const verifyPIN = async (stopId: string, pincode: string) => {
  const res = await v2Client.post(`/jobs/stops/${stopId}/pod/pin`, { pincode });
  return res.data;
};

export const getPodRequirements = async (stopId: string) => {
  return withFallback(
    async () => {
      const res = await v2Client.get(`/jobs/stops/${stopId}/pod`);
      return res.data;
    },
    async () => ({ proofs: [], requirements: null })
  );
};

export default {
  captureSignature,
  capturePhoto,
  verifyPIN,
  getPodRequirements,
};
