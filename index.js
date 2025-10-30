/**
 * Entry point for the A&B Taxi Driver App V1.
 * Mirrors the TaxiTime v2 design system while enabling incremental feature builds.
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
