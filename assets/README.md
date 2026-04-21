Place your app logo files here so packaged builds use your brand icon.

Required files:
- `icon.png` — **required** for electron-builder (≥ **512×512**), Windows NSIS icon (see `package.json` `build.win.icon`), and Electron window icon on Windows/Linux.
- `icon.icns` — macOS `.dmg` / app bundle (point `build.mac.icon` here).
- `icon.ico` — optional; if present it must include a **≥ 256×256** layer or the build fails. This repo uses **`icon.png` for Windows** so a small `.ico` does not break NSIS.

Recommended source size: **1024×1024** or larger square, then export `icon.png` at 512×512 or bigger.
