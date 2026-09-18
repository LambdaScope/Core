//! Build script for lambdascope-extension.
//!
//! Attempts to compile the eBPF C programs in src/observer/ebpf/programs/
//! using aya-build + clang. If aya-build or clang is unavailable the build
//! still succeeds — a warning is printed and the compiled objects are simply
//! absent. The kernel eBPF path in kernel.rs handles this gracefully at
//! runtime by falling back to ProcObserver.

fn main() {
    println!("cargo:rerun-if-changed=src/");

    // Names of the eBPF C programs to compile.
    // Each name N maps to src/observer/ebpf/programs/<N>.c -> OUT_DIR/<N>.o
    let programs = [
        "syscall_enter_connect",
        "syscall_enter_openat",
        "syscall_exit_close",
    ];

    // Attempt to drive aya-build. If it fails (no clang, no BTF headers, etc.)
    // we emit a warning and continue — the binary must still link.
    if let Err(e) = compile_ebpf_programs(&programs) {
        println!(
            "cargo:warning=[lambdascope] eBPF program compilation skipped: {}",
            e
        );
        println!(
            "cargo:warning=[lambdascope] KernelEBPF path will fall back to /proc at runtime"
        );
    }
}

fn compile_ebpf_programs(programs: &[&str]) -> Result<(), Box<dyn std::error::Error>> {
    use std::path::PathBuf;

    let out_dir = std::env::var("OUT_DIR")?;
    let src_base = PathBuf::from("src/observer/ebpf/programs");

    // Verify clang is present before attempting anything.
    let clang_output = std::process::Command::new("clang").arg("--version").output();
    match clang_output {
        Ok(out) if out.status.success() => {}
        Ok(_) => return Err("clang --version returned non-zero".into()),
        Err(e) => return Err(format!("clang not found: {}", e).into()),
    }

    for name in programs {
        let c_src = src_base.join(format!("{}.c", name));

        // The .c sources live alongside the Rust mirror files.
        // They are generated (or hand-written) separately from the Rust
        // SOURCE constants — the Rust constants are human reference copies
        // kept in sync for documentation purposes.
        if !c_src.exists() {
            // Write the canonical C source from the Rust constant so the
            // build is self-contained even without a separate .c file.
            write_c_source_from_rust(name, &src_base)?;
        }

        let obj_out = PathBuf::from(&out_dir).join(format!("{}.o", name));

        // Compile to BPF bytecode via aya-build helper, or directly via clang
        // if aya-build does not expose a simple per-file API.
        //
        // aya-build 0.1 exposes:
        //   aya_build::build_ebpf_programs(src_dir, programs, clang_args)
        // but the API surface changed between patch releases, so we fall
        // back to invoking clang directly for reliability.
        let status = std::process::Command::new("clang")
            .args([
                "-O2",
                "-g",
                "-target",
                "bpf",
                "-D__TARGET_ARCH_x86",
                "-I/usr/include",
                "-I/usr/include/bpf",
                "-c",
                c_src.to_str().unwrap(),
                "-o",
                obj_out.to_str().unwrap(),
            ])
            .status()?;

        if !status.success() {
            return Err(format!("clang failed for {}.c", name).into());
        }

        println!(
            "cargo:warning=[lambdascope] compiled eBPF program: {}.o",
            name
        );
    }

    Ok(())
}

/// Write the canonical C source for program `name` by reading the SOURCE
/// constant out of the corresponding Rust file.
/// This is a best-effort extraction; it assumes the raw string literal
/// sits between the first r#" and the closing "# on its own line.
fn write_c_source_from_rust(
    name: &str,
    src_base: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let rs_path = src_base.join(format!("{}.rs", name));
    if !rs_path.exists() {
        return Err(format!("no .rs source for {}", name).into());
    }

    let rs_content = std::fs::read_to_string(&rs_path)?;

    // Extract text between the outermost r#" ... "# delimiters.
    let start = rs_content
        .find("r#\"")
        .ok_or("SOURCE constant not found in .rs file")?
        + 3;
    let end = rs_content[start..]
        .rfind("\"#")
        .ok_or("closing \"# not found in .rs file")?
        + start;

    let c_source = &rs_content[start..end];
    let c_path = src_base.join(format!("{}.c", name));
    std::fs::write(c_path, c_source)?;
    Ok(())
}
