import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(app, "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/desktop-release.yml"), "utf8");
const cmake = fs.readFileSync(path.join(app, "desktop/CMakeLists.txt"), "utf8");
const readme = fs.readFileSync(path.join(app, "desktop/README.md"), "utf8");
const manifest = fs.readFileSync(path.join(app, "scripts/desktopReleaseManifest.mjs"), "utf8");
const installer = fs.readFileSync(path.join(app, "desktop/windows/OrangeJUCEStudio.iss"), "utf8");

assert.match(workflow, /WINDOWS_CERTIFICATE_PFX_BASE64/);
assert.match(workflow, /Get-AuthenticodeSignature/);
assert.match(workflow, /dumpbin\.FullName \/DEPENDENTS/);
assert.match(workflow, /VCRUNTIME\|MSVCP\|UCRTBASE/);
assert.match(workflow, /APPLE_CERTIFICATE_P12_BASE64/);
assert.match(workflow, /notarytool submit/);
assert.match(workflow, /stapler validate/);
assert.match(workflow, /sudo apt-get install -y/);
assert.equal((workflow.match(/desktop:golden:native/g) || []).length, 5,
  "every platform release must execute the native render/open/save gate from its package");
assert.match(workflow, /dpkg-deb -f.*Version/s);
assert.match(workflow, /sudo apt-get install.*OrangeJUCE/s);
assert.match(workflow, /macos-15-intel/);
assert.match(workflow, /test "\$\(uname -m\)" = "x86_64"/);
assert.match(workflow, /attest-build-provenance@[0-9a-f]{40}/);
assert.doesNotMatch(workflow, /uses:\s+\S+@v\d/);
assert.match(workflow, /SHA256SUMS/);
assert.match(cmake, /install\(TARGETS OrangeJUCEStudio/);
assert.match(cmake, /CPACK_GENERATOR "DEB;TGZ"/);
assert.match(cmake, /MSVC_RUNTIME_LIBRARY "MultiThreaded/);
assert.match(installer, /PrivilegesRequired=lowest/);
assert.match(installer, /OrangeJUCE Studio\.exe/);
assert.match(manifest, /createHash\("sha256"\)/);
assert.match(manifest, /sourceDateEpoch/);
assert.match(manifest, /tools: args\.get\("toolchain"\)/);
assert.match(manifest, /roundtrip !== true/);
assert.match(manifest, /item\.signed !== true/);
assert.match(readme, /CoreAudio/);
assert.match(readme, /WASAPI/);
assert.match(readme, /ALSA/);
assert.match(cmake, /GIT_TAG 4f43011b96eb0636104cb3e433894cda98243626/);

console.log("desktop release contract: signed installers, packaged smoke gates, provenance, checksums, and driver docs present");