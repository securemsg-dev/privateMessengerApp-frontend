/**
 * plugins/withCallForegroundService.js
 * ─────────────────────────────────────
 * Expo config plugin: makes Notifee's foreground service usable for voice calls.
 *
 * Why this is needed
 * ──────────────────
 * Since Android 9 (API 28) an app that is not in the foreground loses access to
 * the microphone. When the screen turns off during a call the activity is
 * stopped, the mic goes silent, the process drops to background importance, and
 * the peer connection dies — the call "immediately" drops. Running a foreground
 * service of type `microphone` for the duration of the call keeps the process at
 * foreground importance so capture and the WebRTC transport survive screen-off.
 *
 * Notifee ships the service class we use (`app.notifee.core.ForegroundService`)
 * but its AAR declares it as `android:foregroundServiceType="shortService"`,
 * which Android caps at ~3 minutes and refuses to grant mic access to. The
 * manifest merger will not let us silently change a value that comes from a
 * library, so we override it explicitly with `tools:replace`.
 *
 * `android/` is gitignored (Continuous Native Generation), so this override has
 * to live here rather than in the generated manifest — `expo prebuild` reapplies
 * it on every build.
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const SERVICE_NAME = 'app.notifee.core.ForegroundService';
// Must stay in sync with the foregroundServiceTypes passed to notifee
// .displayNotification() in src/services/callForegroundService.ts.
const SERVICE_TYPE = 'microphone';

const withCallForegroundService = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    // tools:replace below is inert without the tools namespace declared.
    manifest.manifest.$ = manifest.manifest.$ || {};
    manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.service = application.service || [];

    let service = application.service.find(
      (s) => s.$ && s.$['android:name'] === SERVICE_NAME,
    );
    if (!service) {
      service = { $: { 'android:name': SERVICE_NAME } };
      application.service.push(service);
    }

    service.$['android:exported'] = 'false';
    service.$['android:foregroundServiceType'] = SERVICE_TYPE;
    // The AAR already declares the attribute, so the merger needs to be told
    // ours wins instead of failing the build with a conflict error.
    service.$['tools:replace'] = 'android:foregroundServiceType';
    service.$['tools:node'] = 'merge';

    return cfg;
  });

module.exports = withCallForegroundService;
