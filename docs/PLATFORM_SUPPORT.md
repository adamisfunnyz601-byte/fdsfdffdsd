# NEXUS platform support

## Included in this upgrade

- Responsive web UI with safe-area handling, touch targets, tablet breakpoints, and landscape-phone adjustments.
- Installable PWA metadata and a service worker.
- Local notification permission and test-notification controls.
- Service-worker push event handling, including notification click routing.
- Capacitor configuration for Android Studio and Xcode project generation.
- GitHub Actions workflows that generate native projects and build Android and iOS artifacts.

## Notification delivery requirements

The Settings page can request permission and send a local test notification. The service worker can display incoming Web Push payloads. Actual remote delivery still requires a server-side Web Push sender, VAPID public/private keys, per-user subscription storage, authenticated subscription endpoints, and cleanup of expired subscriptions. Do not commit VAPID private keys.

On iOS, Web Push requires iOS/iPadOS 16.4 or later and the web app must be added to the Home Screen. Windows and Android browser support depends on the installed browser and OS notification settings. A native Android/iOS wrapper needs native push integration (FCM/APNs) for reliable notifications outside the web runtime.

## Android build

Run the Build Android APK workflow from Actions and provide the HTTPS URL where the NEXUS web app is deployed. The workflow generates an Android Studio project, builds a debug APK, and uploads both the APK and project as artifacts. Download the project artifact to open it in Android Studio.

## iOS build

Run the Build iOS archive workflow and provide the deployed HTTPS app URL. The workflow builds an unsigned iOS archive on a macOS runner. A device-installable IPA requires Apple Developer signing assets and provisioning profiles configured as GitHub Actions secrets; never paste those secrets into chat or commit them.

## Important deployment note

The Capacitor wrapper loads the deployed web app URL so relative /api/... requests continue to reach the existing Express backend. The site must use HTTPS and allow the app's WebView origin/CSP configuration. The workflow does not migrate or replace the PostgreSQL database.
