module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        extensions: ['.tsx', '.ts', '.js', '.jsx', '.json']
      }
    ],
    'react-native-reanimated/plugin'
  ]
};
