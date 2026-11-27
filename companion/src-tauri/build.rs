fn main() {
    println!("cargo:rerun-if-changed=src/macos/screen_capture.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new().file("src/macos/screen_capture.m")
            .flag("-fobjc-arc").flag("-fblocks").compile("oplyra_screen");
        for framework in ["Foundation", "AppKit", "CoreGraphics", "ScreenCaptureKit", "Vision"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build();
}
