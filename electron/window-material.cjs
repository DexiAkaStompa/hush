const os = require("node:os");

function supportsAcrylic(platform = process.platform, release = os.release()) {
  return platform === "win32" && Number(release.split(".")[2]) >= 22621;
}

function materialWindowOptions() {
  // DWM provides the transparency on Windows; a layered transparent window
  // would bypass that material and has resizing/maximizing limitations.
  return supportsAcrylic()
    ? { transparent: false, backgroundMaterial: "none" }
    : { transparent: true };
}

function setWindowMaterial(window, enabled) {
  try {
    if (supportsAcrylic()) {
      window.setBackgroundMaterial(enabled ? "acrylic" : "none");
      return enabled;
    }
    if (process.platform === "darwin") {
      window.setVibrancy(enabled ? "under-window" : null);
      return enabled;
    }
  } catch {
    // Unsupported compositors keep the neutral, opaque CSS fallback.
  }
  return false;
}

module.exports = { supportsAcrylic, materialWindowOptions, setWindowMaterial };
