export const Colors = {
  primary: {
    50: '#eef3ff',
    100: '#d6e3ff',
    200: '#adc7ff',
    300: '#7ea8ff',
    400: '#4f88ff',
    500: '#2f70f5',
    600: '#2058d1',
    700: '#1a47a9',
    800: '#163c8a',
    900: '#112c63'
  },
  secondary: {
    100: '#e6f8ff',
    200: '#bfe9ff',
    400: '#5dc5ff',
    600: '#008ddb',
    800: '#005f96'
  },
  success: '#28a745',
  danger: '#ff4d61',
  warning: '#ffb347',
  surface: {
    default: '#f5f7fb',
    card: '#ffffff',
    overlay: 'rgba(17, 44, 99, 0.08)'
  },
  background: {
    base: '#0f1118',
    elevated: '#1a1d26'
  },
  accent: {
    logout: '#ff5c33',
    highlight: '#f5b400',
    border: '#2d3240'
  },
  text: {
    primary: '#0b1b3f',
    secondary: '#3b4a6b',
    muted: '#6c7b9d',
    inverse: '#ffffff'
  },
  divider: '#d9e1f2'
} as const;

export type ColorToken = typeof Colors;
