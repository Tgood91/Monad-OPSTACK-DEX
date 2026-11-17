# Bushido-dApp for Android (Kotlin)

An Android Studio project, written in Kotlin, that opens https://bushido-dapp.onrender.com
full-screen as a **Trusted Web Activity**. The page runs in the user's Chrome, not in an
embedded web view, so:

- every update to the site shows up in the app with no new release;
- **social logins keep working** (Google blocks sign-in inside web views);
- wallet deep links behave exactly as on the website.

A fully native rewrite of the DEX was ruled out: Reown's Android SDK has no email or social
login ([support table](https://docs.reown.com/appkit/overview)). This project replaces the
earlier Bubblewrap / PWABuilder configuration with code you own and can open in Android Studio.

## Layout

| Path | What it is |
|---|---|
| `app/src/main/kotlin/.../BushidoLauncherActivity.kt` | The only activity. Extends `LauncherActivity` from Google's android-browser-helper, which does the Chrome handshake, splash and fallback; this class picks the URL. |
| `app/src/main/kotlin/.../LaunchUrl.kt` | Plain Kotlin: accepts only `https://bushido-dapp.onrender.com/...` links (a tapped link or shortcut), adds `source=pwa`, otherwise opens the home page. |
| `app/src/test/kotlin/.../LaunchUrlTest.kt` | JUnit tests for the rules above. Run with `./gradlew test`, no phone needed. |
| `app/src/main/AndroidManifest.xml` | TWA settings as `meta-data` (start URL, colours, splash, orientation, Custom Tabs fallback), the `https://bushido-dapp.onrender.com` link filter with `autoVerify`, the splash `FileProvider`. |
| `app/src/main/res/values/strings.xml` | `asset_statements`: the app-side half of Digital Asset Links. |
| `app/src/main/res/xml/shortcuts.xml` | Long-press shortcuts: Swap and Bridge, the same as the web manifest. |
| `app/src/main/res/mipmap-*`, `drawable-nodpi/splash.png` | Icons made from `../Bushido-dApp/icons` (adaptive icon on Android 8+, legacy icon below). |
| `app/build.gradle.kts` | Package ID `io.github.tgood91.bushidodapp`, min SDK 25, target/compile SDK 36, release signing from `keystore.properties`. |
| `gradle/libs.versions.toml` | Versions: Android Gradle Plugin 8.9.1, Kotlin 2.1.20, android-browser-helper 2.7.4, androidx.browser 1.9.0. |

The site address appears in three places on purpose, because Android needs it as a literal in
XML: `app/build.gradle.kts` (`SITE_HOST`, also fed to the manifest as `${siteHost}`),
`res/values/strings.xml` (`asset_statements`) and `res/xml/shortcuts.xml`.

## What you need

- Android Studio (Ladybug or newer) with its bundled JDK 17, or JDK 17+ and the Android SDK
  (platform 36, build-tools 35) for the command line.
- An Android signing key. Whoever holds it can publish updates, so back it up and keep it out
  of git (`*.keystore`, `*.jks` and `keystore.properties` are git-ignored). Losing it means you
  cannot update the app.

## Build and run

1. Open `Bushido-dApp-android/` in Android Studio (File → Open) and let it sync. On the command
   line: `./gradlew assembleDebug` (first run downloads Gradle 8.14.3 and the dependencies).
2. Unit tests: `./gradlew test`.
3. Run on a phone or emulator with Chrome installed. A debug build shows Chrome's address bar,
   because the site only vouches for your release signing key (next section).

## Release: make the address bar disappear

Android hides the browser bar only if the site vouches for the app. That is two halves:
`res/values/strings.xml` names the site, and the site's `/.well-known/assetlinks.json`
(`server/assetlinks.js`) names the app's package and signing key.

1. Make a keystore once (keep it outside the repo or rely on the ignore rules):
   ```
   keytool -genkeypair -v -keystore android.keystore -alias bushido -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Copy `keystore.properties.example` to `keystore.properties` and fill in the path, alias and
   passwords. `./gradlew assembleRelease` now produces a signed APK in
   `app/build/outputs/apk/release/`, and `./gradlew bundleRelease` the `.aab` for Google Play.
   Android Studio's Build → *Generate Signed App Bundle / APK* works too.
3. Get the key's **SHA-256 fingerprint**:
   ```
   keytool -list -v -keystore android.keystore -alias bushido
   ```
   Copy the `SHA256:` line; it looks like `14:6D:E9:…` (32 pairs).
4. In Render → your service → Environment, add `ANDROID_CERT_SHA256` with that fingerprint, then
   **Save and deploy**. Check https://bushido-dapp.onrender.com/.well-known/assetlinks.json shows
   it.
5. Install the release APK. If the address bar still shows, step 4 isn't matching yet (wrong
   package ID or fingerprint, or the deploy isn't finished). Chrome caches the check, so clear
   Chrome's data or reinstall the app after fixing it.

## Google Play

- Create a developer account (one-time fee), then upload the `.aab`.
- With **Play App Signing** (the default) Google re-signs the app with its own key. Copy that
  key's SHA-256 from Play Console → *App integrity* and add it to `ANDROID_CERT_SHA256` too,
  comma separated. Keep your upload key's fingerprint in the list as well.
- Play will ask about a finance/crypto declaration and a privacy policy URL.

## Changing the package ID

It is permanent once published. Change `applicationId` and `namespace` in
`app/build.gradle.kts`, the package folder under `app/src/main/kotlin`, `targetPackage` and
`targetClass` in `res/xml/shortcuts.xml`, and set `ANDROID_PACKAGE_NAME` in Render to match.

## Not tested

Nothing here has run on a real phone: the Chrome handshake, the hidden address bar, social
login inside the app and wallet app links are untested. The server side
(`/.well-known/assetlinks.json`) is tested. See CHANGELOG.md for what was and was not built in
this environment.
