/**
 * Driver Utility Functions
 * 
 * Helper functions for safely accessing driver data
 */

import { DriverProfile } from "../types/driver";

/**
 * Safely get company ID from driver object
 * Handles both direct companyId and nested company.id
 */
export const getDriverCompanyId = (driver?: DriverProfile | null): string | null => {
  if (!driver) {
    return null;
  }
  
  // Try direct companyId first
  if (driver.companyId) {
    return driver.companyId;
  }
  
  // Fall back to nested company.id
  if (driver.company?.id) {
    return driver.company.id;
  }
  
  return null;
};

/**
 * Get driver's full name
 */
export const getDriverFullName = (driver?: DriverProfile | null): string => {
  if (!driver) {
    return "Unknown Driver";
  }
  
  const firstName = driver.firstName || "";
  const lastName = driver.lastName || "";
  
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  }
  
  if (firstName) {
    return firstName;
  }
  
  if (lastName) {
    return lastName;
  }
  
  return driver.email || "Unknown Driver";
};

/**
 * Get driver's company name
 */
export const getDriverCompanyName = (driver?: DriverProfile | null): string => {
  if (!driver?.company) {
    return "No Company";
  }
  
  return driver.company.brandName || driver.company.name || driver.company.legalName || "Unknown Company";
};

/**
 * Check if driver is fully configured (has company)
 */
export const isDriverFullyConfigured = (driver?: DriverProfile | null): boolean => {
  const companyId = getDriverCompanyId(driver);
  return !!driver && !!companyId;
};

