import httpClient from "./httpClient";

type CompanySettingsPayload = {
  id: string;
  name?: string | null;
  companyName?: string | null;
  settings: {
    mapProvider?: string | null;
    placeApiProvider?: string | null;
    locationUpdateInterval?: number; // Location update interval in seconds
    [key: string]: unknown;
  };
};

type CompanySettingsResponse = {
  success: boolean;
  data: CompanySettingsPayload;
};

export type MapProvider = "NATIVE" | "OPENSTREETMAP" | "GOOGLE_MAPS";

export const fetchCompanySettings = async (
  companyId: string
): Promise<CompanySettingsPayload> => {
  const response = await httpClient.get<CompanySettingsResponse>(
    `/companies/${companyId}/settings`
  );

  return response.data.data;
};
