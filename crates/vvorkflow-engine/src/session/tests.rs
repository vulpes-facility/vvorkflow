//! Unit tests of the sessions that need their inner parts: the order of the
//! counts that the watch gets.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::Sessions;

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
