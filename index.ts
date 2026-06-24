import { registerRootComponent } from 'expo';

import App from './App';

// Silence debug-level console output in production builds. warn/error are
// kept so genuine problems still surface (and a future crash reporter can
// hook them). Sensitive values are never logged; this just removes noise.
if (!__DEV__) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
