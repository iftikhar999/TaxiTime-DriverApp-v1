/**
 * navigationRef — a detached navigation reference that lets non-component
 * code (Toast onPress handlers, context providers, background services)
 * navigate without prop-drilling. Populated by RootNavigator at mount.
 */
import { createRef } from 'react';
import type { NavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createRef<NavigationContainerRef<any>>();

export const navigate = (name: string, params?: any) => {
  if (navigationRef.current?.isReady()) {
    // Cast to any so callers can navigate without knowing the typed param list.
    (navigationRef.current.navigate as any)(name, params);
  }
};
