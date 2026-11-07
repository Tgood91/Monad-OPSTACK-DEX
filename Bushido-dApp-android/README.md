# Bushido-dApp for Android

An Android app that opens https://bushido-dapp.onrender.com full-screen (a *Trusted Web
Activity*). It is the same app as the website, so every update to the site shows up in the
Android app with no new release, and the **social logins keep working**: the page runs in
Chrome, not in an embedded web view (Google blocks sign-in inside web views).

A native Kotlin app was ruled out for now: Reown's Android SDK has no email or social
login ([support table](https://docs.reown.com/appkit/overview)).

## What you need
- The site live over HTTPS (it is).
- An Android signing key. Whoever holds it can publish updates, so back it up and keep it
  out of git (`*.keystore` is git-ignored). Losing it means you cannot update the app.
- Nothing to install for route A.

## Route A: no install (PWABuilder), the easy one
1. Open https://www.pwabuilder.com and enter `https://bushido-dapp.onrender.com`.
2. Choose **Package for stores → Android**.
3. Package ID: `io.github.tgood91.bushidodapp` (or your own; see "Changing the package ID").
   Let PWABuilder **generate a new signing key** and download the zip. It contains the
   `.aab` for Google Play, an `.apk` you can install directly, and the keystore with its
   passwords. Keep the zip safe.
4. Get the key's **SHA-256 fingerprint** (PWABuilder shows it, or see "Fingerprint" below).
5. In Render → your service → Environment, add `ANDROID_CERT_SHA256` with that
   fingerprint, then **Save and deploy**. The site then proves it owns the app by serving
   `/.well-known/assetlinks.json` (check: open
   https://bushido-dapp.onrender.com/.well-known/assetlinks.json and see your fingerprint).
6. Install the `.apk` on a phone. If the address bar shows at the top, step 5 isn't
   matching yet (wrong package ID or fingerprint, or the deploy isn't finished).

## Route B: Bubblewrap on your computer
Needs Node, Java 17 and the Android SDK (Bubblewrap offers to download them).
```
cd Bushido-dApp-android
npx @bubblewrap/cli init --manifest=https://bushido-dapp.onrender.com/Bushido-dApp/manifest.webmanifest
npx @bubblewrap/cli build
```
`twa-manifest.json` here holds the app's settings so `init` can start from them; it has
not been run through Bubblewrap yet, so if `init` complains about a field, tell me what it
says. Then do steps 4 to 6 above with the keystore Bubblewrap created.

## Fingerprint
`keytool -list -v -keystore android.keystore -alias bushido` and copy the `SHA256:` line.
It looks like `14:6D:E9:…` (32 pairs).

## Google Play
- Create a developer account (one-time fee), then upload the `.aab`.
- With **Play App Signing** (the default) Google re-signs the app with its own key. Copy
  that key's SHA-256 from Play Console → *App integrity* and add it to `ANDROID_CERT_SHA256`
  too, separated by a comma. Keep your upload key's fingerprint in the list as well.
- Play will ask about a finance/crypto declaration and a privacy policy URL.

## Changing the package ID
It is permanent once published. If you want another one (for example from a domain you
own), set it in PWABuilder or `twa-manifest.json`, and set `ANDROID_PACKAGE_NAME` in Render
to match.

## Not tested
I cannot build or run Android apps in this environment, so the app itself, social login
inside it, and wallet app links on a real phone are untested. The server side
(`/.well-known/assetlinks.json`) is tested.
