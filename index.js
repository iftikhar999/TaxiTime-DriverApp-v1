/**
 * Entry point for the A&B Taxi Driver App V1.
 * Mirrors the TaxiTime v2 design system while enabling incremental feature builds.
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerBackgroundHandler } from './src/services/pushNotifications';
import { registerBackgroundKeepaliveTask } from './src/services/localNotifications';

// 🔥 Register FCM background message handler BEFORE AppRegistry — it runs in
// a headless JS context when a push arrives while the app is killed.
registerBackgroundHandler();

// 🟢 Register notifee foreground-service task so Android keeps our JS VM
// alive while the app is backgrounded. Without this, socket.io detaches
// after ~30 s and the driver stops receiving dispatcher messages.
registerBackgroundKeepaliveTask();

AppRegistry.registerComponent(appName, () => App);
