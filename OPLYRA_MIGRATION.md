# Oplyra development source package

This archive rebrands the existing Focus Buddy desktop source preview as **Oplyra**. It is **not** a signed installer and **has not** been compiled on a Windows/macOS machine.

- Extract the `companion/` folder into the root of the existing `Automated-Focus-Enhancing-Companion` checkout.
- Development: `cd companion && npm install && npm run tauri dev` (requires Rust and Tauri prerequisites).
- The native Rust crate is renamed to `oplyra-desktop`; the app identifier is `com.pavankumar.oplyra`, provisional pending brand clearance.
- Core API package `focusbuddy` and `FOCUSBUDDY_*` environment variables remain unchanged in the GitHub prototype to avoid compatibility breakage during migration.
- Source scope: local timer/checkpoint/tray only, *no* employee tracking, B2B dashboards, or real LLM connection.
- Legacy MayDay work credits remain required; verify commercial rights to jointly authored contributions before monetizing.
