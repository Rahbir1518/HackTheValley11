// Maps the Android emulator's localhost:8000 (API) and :3000 (web app) to this computer, so the app
// can use plain http://localhost URLs (also an origin Clerk's development instance accepts).
// Run with the emulator open: `npm run ports` (also done by `npm run android`).
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const adb = [path.join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"), "adb"].find(
  (p) => p === "adb" || fs.existsSync(p),
);

try {
  for (const port of ["8000", "3000"]) execFileSync(adb, ["reverse", `tcp:${port}`, `tcp:${port}`], { stdio: "pipe" });
  console.log("Emulator localhost:8000 and :3000 now reach this computer.");
} catch (e) {
  console.warn(`Could not run 'adb reverse' (${String(e.message).split("\n")[0]}). Start the emulator first, then run: npm run ports`);
}
