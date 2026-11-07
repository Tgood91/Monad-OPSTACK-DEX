// Digital Asset Links for the Android app (Trusted Web Activity).
//
// Android only opens this site full-screen, without a browser address bar, if the site
// vouches for the app: Chrome fetches https://<site>/.well-known/assetlinks.json and
// checks the app's package name and signing-certificate fingerprint against it.
// Both come from the environment, because the fingerprint belongs to YOUR signing key:
//   ANDROID_PACKAGE_NAME   defaults to the id in Bushido-dApp-android/twa-manifest.json
//   ANDROID_CERT_SHA256    one or more SHA-256 fingerprints, comma separated
//                          (e.g. your upload key and Google Play's app-signing key)
// With no fingerprint set it answers an empty list, which is valid and grants nothing.

export const DEFAULT_ANDROID_PACKAGE = "io.github.tgood91.bushidodapp";

// 32 bytes as hex pairs separated by colons: AA:BB:...:FF
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function assetLinks(env = process.env) {
  const pkg = (env.ANDROID_PACKAGE_NAME || DEFAULT_ANDROID_PACKAGE).trim();
  const fingerprints = (env.ANDROID_CERT_SHA256 || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => FINGERPRINT.test(s));
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg) || !fingerprints.length) return [];
  return [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fingerprints },
  }];
}

export function assetLinksHandler(env = process.env) {
  return (_req, res) => {
    res.set("Cache-Control", "public, max-age=300").type("application/json").send(JSON.stringify(assetLinks(env)));
  };
}
