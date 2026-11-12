use std::process::Command;

// Records the compiler version in the binary so the golden-vector check
// reports exactly which toolchain produced the comparison. The audit trail
// needs the version, not just the command.
fn main() {
    let rustc = Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=RUSTC_VERSION={rustc}");
    println!("cargo:rerun-if-changed=build.rs");
}
