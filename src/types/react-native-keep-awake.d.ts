declare module 'react-native-keep-awake' {
  import { Component } from 'react';

  export default class KeepAwake extends Component<{}> {}
  
  export function activateKeepAwake(): void;
  export function deactivateKeepAwake(): void;
  export function useKeepAwake(): void;
}
