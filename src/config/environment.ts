// For Physical Device (connected via WiFi - use laptop IP)
// export const API_BASE_URL = "http://192.168.1.48:3000/api";
// export const SOCKET_BASE_URL = "http://192.168.1.48:3000";

// For Android Emulator (LOCAL DEVELOPMENT)
// export const API_BASE_URL = "http://10.0.2.2:3000/api";
// export const SOCKET_BASE_URL = "http://10.0.2.2:3000";

// LOCAL DEVELOPMENT - Physical Device via USB (adb reverse tcp:3000 tcp:3000)
export const API_BASE_URL = "http://localhost:3000/api";
export const SOCKET_BASE_URL = "http://localhost:3000";

// PRODUCTION SERVER
// export const API_BASE_URL = "http://54.252.241.150/api";
// export const SOCKET_BASE_URL = "http://54.252.241.150";

export const DEFAULT_DRIVER_CREDENTIALS = {
  email: "driver1@city001.com",
  password: "111111",
};
