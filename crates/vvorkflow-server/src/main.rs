//! `vvorkflow-server`: the engine process. It reads the projects root from
//! `VVORKFLOW_ROOT`, or uses `~/vvorkflow`, and serves the engine on the
//! endpoint of the user until a client stops it or no client comes for
//! the idle time of [`Limits::default`]. It writes each error to stderr and
//! stops with exit code 1.

use std::io::Write;
use std::process::ExitCode;
use std::sync::Arc;

use vvorkflow_engine::{Engine, projects_root_from_env};
use vvorkflow_server::{Endpoint, Limits, serve};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            // Stderr can be a closed pipe; the process stops in any case.
            let _ = writeln!(std::io::stderr(), "{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let root = projects_root_from_env().map_err(|error| error.message)?;
    let engine = Engine::new(&root).map_err(|error| error.message)?;
    let endpoint = Endpoint::of_user()?;
    let limits = Limits::default();
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(limits.workers)
        .enable_all()
        .build()
        .map_err(|error| format!("The engine cannot start its runtime: {error}."))?
        .block_on(serve(&endpoint, Arc::new(engine), limits))
}
