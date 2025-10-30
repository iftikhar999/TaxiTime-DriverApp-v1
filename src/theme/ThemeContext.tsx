import React, { createContext, useContext, useMemo, useState } from 'react';
import { Colors } from './colors';

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: typeof Colors;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  colors: Colors,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  toggleMode: () => {}
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>('light');

  const value = useMemo(
    () => ({
      mode,
      colors: Colors,
      toggleMode: () => setMode((prev) => (prev === 'light' ? 'dark' : 'light'))
    }),
    [mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => useContext(ThemeContext);
