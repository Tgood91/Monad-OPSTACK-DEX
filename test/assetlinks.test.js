import test from "node:test";
import assert from "node:assert/strict";
import { assetLinks, DEFAULT_ANDROID_PACKAGE } from "../server/assetlinks.js";

const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

test("empty list until a fingerprint is set", () => {
  assert.deepEqual(assetLinks({}), []);
});

test("builds the Digital Asset Link for the default package", () => {
  const out = assetLinks({ ANDROID_CERT_SHA256: FP });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(out[0].target.namespace, "android_app");
  assert.equal(out[0].target.package_name, DEFAULT_ANDROID_PACKAGE);
  assert.deepEqual(out[0].target.sha256_cert_fingerprints, [FP]);
});

test("accepts several fingerprints (upload key + Play app-signing key), tidies case, drops junk", () => {
  const out = assetLinks({
    ANDROID_PACKAGE_NAME: "com.example.app",
    ANDROID_CERT_SHA256: `${FP.toLowerCase()}, not-a-fingerprint ,${FP}`,
  });
  assert.equal(out[0].target.package_name, "com.example.app");
  assert.deepEqual(out[0].target.sha256_cert_fingerprints, [FP, FP]);
});

test("a bad package name grants nothing", () => {
  assert.deepEqual(assetLinks({ ANDROID_PACKAGE_NAME: "nope", ANDROID_CERT_SHA256: FP }), []);
});
