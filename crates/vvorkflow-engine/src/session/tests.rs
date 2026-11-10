//! Unit tests of the sessions that need their inner parts: the order of the
//! counts that the watch gets, and a start that fails after the shell
//! started.

use std::cell::Cell;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vvorkflow_protocol::ErrorCode;

use super::Sessions;

thread_local! {
    /// The step of a start that fails in this thread: `pty`, or the name of
    /// a thread of the session.
    static FAIL: Cell<Option<&'static str>> = const { Cell::new(None) };
    /// The process id of the last shell that this thread started.
    static SHELL: Cell<Option<u32>> = const { Cell::new(None) };
}

/// Whether a test makes this step of a start fail.
pub(super) fn fails(step: &str) -> bool {
    FAIL.with(|fail| fail.get() == Some(step))
}

/// Notes the shell that a start of this thread started.
pub(super) fn spawned(pid: Option<u32>) {
    SHELL.with(|shell| shell.set(pid));
}

/// The time that a test waits for a condition at most.
const WAIT: Duration = Duration::from_secs(30);

/// Waits until `done` holds, at most [`WAIT`].
fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done() {
        assert!(Instant::now() < deadline, "{what} does not come");
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// The engine gives each count to the watch under the lock of the sessions,
/// so that an end that counts 0 cannot come after a start that counts 1:
/// at the registration, at a start, and at an end.
#[test]
fn the_watch_gets_each_count_under_the_lock_of_the_sessions() {
    let base = tempfile::tempdir().unwrap();
    let sessions = Arc::new(Sessions::new());
    let calls: Arc<Mutex<Vec<(usize, bool)>>> = Arc::default();
    let seen = Arc::clone(&calls);
    let weak = Arc::downgrade(&sessions);
    sessions.watch(Box::new(move |count| {
        let locked = weak
            .upgrade()
            .is_some_and(|sessions| sessions.inner.try_lock().is_err());
        seen.lock().unwrap().push((count, locked));
    }));

    let session = sessions.create(base.path(), 80, 24).unwrap();
    sessions.kill(&session.id).unwrap();
    wait_for("the end of the session", || sessions.count() == 0);
    wait_for("the count of the end", || calls.lock().unwrap().len() == 3);
    assert_eq!(*calls.lock().unwrap(), [(0, true), (1, true), (0, true)]);
}

/// A start that fails after the shell started ends and reaps the shell, and
/// keeps no session: at each step after the start of the shell.
#[cfg(unix)]
#[test]
fn a_start_that_fails_ends_and_reaps_the_shell() {
    let base = tempfile::tempdir().unwrap();
    for step in ["pty", "session-waiter", "session-reader", "session-writer"] {
        let sessions = Arc::new(Sessions::new());
        FAIL.with(|fail| fail.set(Some(step)));
        SHELL.with(|shell| shell.set(None));
        let refused = sessions.create(base.path(), 80, 24).unwrap_err();
        FAIL.with(|fail| fail.set(None));
        assert_eq!(refused.code, ErrorCode::FailedPrecondition, "{step}");
        assert_eq!(sessions.count(), 0, "{step}");
        assert_eq!(sessions.inner().starting, 0, "{step}");
        // The shell is reaped: it is no longer a child of this process.
        let pid = SHELL.with(Cell::get).expect("a shell started");
        let pid = libc::pid_t::try_from(pid).unwrap();
        // SAFETY: a null status is valid for `waitpid`.
        let waited = unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) };
        let reason = std::io::Error::last_os_error().raw_os_error();
        assert_eq!((waited, reason), (-1, Some(libc::ECHILD)), "{step}");
    }
}
