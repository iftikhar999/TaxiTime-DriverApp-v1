export interface DriverCompany {
  id: string;
  name?: string | null;
  legalName?: string | null;
  brandName?: string | null;
  status?: string | null;
  isActive?: boolean | null;
}

export interface DriverProfile {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  phone?: string | null;
  profileImage?: string | null;
  rating?: unknown;
  isVerified?: boolean;
  companyId?: string | null;
  company?: DriverCompany | null;
  currentJob?: unknown;
  jobStatus?: string | null;
  isAvailable?: boolean;
}
