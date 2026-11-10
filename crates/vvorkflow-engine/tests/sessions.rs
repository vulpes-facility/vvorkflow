//! The terminal sessions of the engine, with the shell in a real
//! pseudo-terminal: the output of each attached client, the screen of an
//! attach while output flows, a client that does not read, the input, the
//! resize, the end, the kill, and the limits.
//!
//! The shell is `/bin/sh` on Linux and macOS, so that the profile of the
//! user does not change the output; Windows uses its own shell, and only the
//! tests that each shell passes run there.

use std::sync::{Arc, Condvar, Mutex, Once};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use vvorkflow_engine::screen::Screen;
use vvorkflow_engine::{Client, ClientKind, Engine, OUTPUT_QUEUE, Outgoing};
use vvorkflow_protocol::{
    AttachSession, CreateSession, ErrorCode, Event, Frame, KillSession, ListSessions, Request,
    ResizeSession, Response, Session, SessionEnded, WriteSession,
};

/// The time that a test waits for a condition at most.
const WAIT: Duration = Duration::from_secs(30);

/// Each test calls this first, so that no test reads the environment while
/// the first one changes it.
fn setup() {
    static SHELL: Once = Once::new();
    SHELL.call_once(|| {
        #[cfg(unix)]
        // SAFETY: each test of this binary waits here before it starts a
        // thread or a process, so nothing reads the environment now.
        unsafe {
            std::env::set_var("SHELL", "/bin/sh");
        }
    });
}

struct Place {
    _base: tempfile::TempDir,
    engine: Engine,
}

fn place() -> Place {
    setup();
    let base = tempfile::tempdir().unwrap();
    let root = base.path().canonicalize().unwrap();
    Place {
        engine: Engine::new(&root).unwrap(),
        _base: base,
    }
}

/// A client that collects its messages, as the writer of a connection
/// does.
struct Viewer {
    client: Client,
    woken: Arc<(Mutex<bool>, Condvar)>,
}

impl Viewer {
    fn new(engine: &Engine) -> Viewer {
        let woken = Arc::new((Mutex::new(false), Condvar::new()));
        let signal = Arc::clone(&woken);
        let client = engine.connect(
            ClientKind::Local,
            Arc::new(move || {
                *signal.0.lock().unwrap() = true;
                signal.1.notify_all();
            }),
        );
        Viewer { client, woken }
    }

    /// The next message, waiting until the deadline.
    fn next(&self, deadline: Instant) -> Option<Outgoing> {
        loop {
            {
                let mut woken = self.woken.0.lock().unwrap();
                *woken = false;
            }
            if let Some(item) = self.client.next() {
                return Some(item);
            }
            let woken = self.woken.0.lock().unwrap();
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            if !*woken {
                let _ = self.woken.1.wait_timeout(woken, deadline - now).unwrap();
            }
        }
    }
}

/// A terminal that follows the frames and the events of one session, as
/// the terminal of the web UI does.
#[derive(Default)]
struct Mirror {
    screen: Option<Screen>,
    ended: Option<SessionEnded>,
    /// The bytes of the output frames after the last screen frame.
    output: usize,
    screens: usize,
}

impl Mirror {
    fn take(&mut self, item: Outgoing) {
        match item {
            Outgoing::Frame(bytes) => match Frame::parse(&bytes).expect("a valid frame") {
                Frame::Screen {
                    columns,
                    rows,
                    screen,
                    ..
                } => {
                    let mut fresh = Screen::new(columns, rows);
                    fresh.feed(screen);
                    self.screen = Some(fresh);
                    self.output = 0;
                    self.screens += 1;
                }
                Frame::Output { output, .. } => {
                    self.output += output.len();
                    self.screen
                        .as_mut()
                        .expect("a screen comes before the output")
                        .feed(output);
                }
            },
            Outgoing::Event(Event::SessionResized(resized)) => {
                assert!(self.ended.is_none(), "nothing follows the end");
                self.screen
                    .as_mut()
                    .expect("a screen comes before an event")
                    .resize(resized.columns, resized.rows);
            }
            Outgoing::Event(Event::SessionEnded(ended)) => {
                assert!(self.ended.is_none(), "the end comes once");
                self.ended = Some(ended);
            }
            Outgoing::Event(other) => panic!("an event for no session: {other:?}"),
        }
    }

    /// The state of the screen; empty before the first screen frame.
    fn describe(&mut self) -> String {
        self.screen
            .as_mut()
            .map(Screen::describe)
            .unwrap_or_default()
    }

    /// The text of the screen, without the attributes.
    fn text(&mut self) -> String {
        self.describe()
            .lines()
            .filter_map(|line| {
                let start = line.find('"')?;
                let end = line.rfind('"')?;
                (end > start).then(|| line[start + 1..end].to_owned())
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn request(engine: &Engine, client: &Client, request: Request) -> Response {
    engine.handle(client, request).unwrap()
}

fn create(engine: &Engine, client: &Client, columns: u16, rows: u16) -> Session {
    let Response::Session(session) = request(
        engine,
        client,
        Request::CreateSession(CreateSession {
            worktree: None,
            columns,
            rows,
        }),
    ) else {
        panic!("create answers a session");
    };
    session
}

fn attach(engine: &Engine, viewer: &Viewer, session: &str) -> Session {
    let Response::Session(session) = request(
        engine,
        &viewer.client,
        Request::AttachSession(AttachSession {
            session: session.to_owned(),
        }),
    ) else {
        panic!("attach answers a session");
    };
    viewer.client.answered();
    session
}

fn write(engine: &Engine, client: &Client, session: &str, input: &str) {
    request(
        engine,
        client,
        Request::WriteSession(WriteSession {
            session: session.to_owned(),
            data: STANDARD.encode(input),
        }),
    );
}

/// Takes the messages of a viewer into a mirror until `done` holds.
fn follow_until(viewer: &Viewer, mirror: &mut Mirror, mut done: impl FnMut(&mut Mirror) -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done(mirror) {
        let item = viewer
            .next(deadline)
            .unwrap_or_else(|| panic!("the condition does not come: {}", mirror.text()));
        mirror.take(item);
    }
}

/// Answers the cursor position as a terminal does: ConPTY waits for it at
/// start.
fn answer_cursor(engine: &Engine, viewer: &Viewer, session: &str, item: &Outgoing) {
    if let Outgoing::Frame(bytes) = item
        && bytes.windows(4).any(|window| window == b"\x1b[6n")
    {
        write(engine, &viewer.client, session, "\x1b[1;1R");
    }
}

/// Waits for the end of a session, and returns it.
fn ended(engine: &Engine, viewer: &Viewer, mirror: &mut Mirror, session: &str) -> SessionEnded {
    let deadline = Instant::now() + WAIT;
    while mirror.ended.is_none() {
        let item = viewer.next(deadline).expect("the session ends");
        answer_cursor(engine, viewer, session, &item);
        mirror.take(item);
    }
    mirror.ended.clone().unwrap()
}

fn list(engine: &Engine, client: &Client) -> Vec<Session> {
    let Response::Sessions(sessions) =
        request(engine, client, Request::ListSessions(ListSessions {}))
    else {
        panic!("list answers sessions");
    };
    sessions
}

#[test]
fn a_session_runs_the_shell_and_ends_with_its_exit_code() {
    let place = place();
    let viewer = Viewer::new(&place.engine);
    let session = create(&place.engine, &viewer.client, 80, 24);
    assert_eq!(session.id.len(), 16);
    assert!(
        session
            .id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    );
    assert_eq!((session.columns, session.rows), (80, 24));
    assert_eq!(
        session.folder,
        place._base.path().canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(
        list(&place.engine, &viewer.client),
        std::slice::from_ref(&session)
    );

    attach(&place.engine, &viewer, &session.id);
    let mut mirror = Mirror::default();
    let first = viewer.next(Instant::now() + WAIT).expect("a screen");
    assert!(
        matches!(&first, Outgoing::Frame(bytes) if bytes[0] == vvorkflow_protocol::FRAME_SCREEN)
    );
    mirror.take(first);
    write(&place.engine, &viewer.client, &session.id, "exit 3\r");
    let end = ended(&place.engine, &viewer, &mut mirror, &session.id);
    assert_eq!(end.exit_code, Some(3));
    assert_eq!(end.signal, None);
    assert!(viewer.client.next().is_none(), "nothing follows the end");

    assert_eq!(list(&place.engine, &viewer.client), []);
    assert_eq!(place.engine.session_count(), 0);
    let refused = place
        .engine
        .handle(
            &viewer.client,
            Request::AttachSession(AttachSession {
                session: session.id,
            }),
        )
        .unwrap_err();
    assert_eq!(refused.code, ErrorCode::NotFound);
}

#[test]
fn the_requests_check_their_arguments() {
    let place = place();
    let viewer = Viewer::new(&place.engine);
    let refused = |request: Request| {
        place
            .engine
            .handle(&viewer.client, request)
            .unwrap_err()
            .code
    };
    for (columns, rows) in [(1, 24), (501, 24), (80, 0), (80, 201)] {
        assert_eq!(
            refused(Request::CreateSession(CreateSession {
                worktree: None,
                columns,
                rows,
            })),
            ErrorCode::InvalidArgument
        );
    }
    assert_eq!(
        refused(Request::CreateSession(CreateSession {
            worktree: Some(std::env::temp_dir().to_string_lossy().into_owned()),
            columns: 80,
            rows: 24,
        })),
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        refused(Request::AttachSession(AttachSession {
            session: "0123456789abcdef".to_owned(),
        })),
        ErrorCode::NotFound
    );

    let session = create(&place.engine, &viewer.client, 80, 24);
    assert_eq!(
        refused(Request::WriteSession(WriteSession {
            session: session.id.clone(),
            data: "not base64!".to_owned(),
        })),
        ErrorCode::InvalidArgument
    );
    assert_eq!(
        refused(Request::ResizeSession(ResizeSession {
            session: session.id.clone(),
            columns: 1,
            rows: 1,
        })),
        ErrorCode::InvalidArgument
    );
    // An engine with a session does not stop without force.
    let stop = place.engine.stop(false).unwrap_err();
    assert_eq!(stop.code, ErrorCode::FailedPrecondition);
    assert!(
        stop.message.contains("1 terminal session"),
        "{}",
        stop.message
    );
    assert_eq!(place.engine.session_count(), 1);
    // With force it ends the sessions, and starts no new one.
    let start = Instant::now();
    place.engine.stop(true).unwrap();
    assert!(start.elapsed() < Duration::from_secs(10));
    assert_eq!(
        refused(Request::CreateSession(CreateSession {
            worktree: None,
            columns: 80,
            rows: 24,
        })),
        ErrorCode::FailedPrecondition
    );
    let deadline = Instant::now() + WAIT;
    while place.engine.session_count() > 0 {
        assert!(Instant::now() < deadline, "the session ends");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(unix)]
mod unix {
    use super::*;

    fn seq_output(text: &str) -> Vec<u64> {
        text.lines()
            .filter_map(|line| line.trim().parse::<u64>().ok())
            .collect()
    }

    /// Each line once, in order, with no line lost: the numbers of a
    /// counting program are consecutive.
    fn assert_consecutive(numbers: &[u64], last: u64) {
        assert_eq!(numbers.last(), Some(&last));
        for pair in numbers.windows(2) {
            assert_eq!(pair[1], pair[0] + 1, "a line is lost or comes twice");
        }
    }

    #[test]
    fn an_attach_while_output_flows_gives_each_line_once() {
        let place = place();
        let first = Viewer::new(&place.engine);
        let session = create(&place.engine, &first.client, 80, 24);
        attach(&place.engine, &first, &session.id);
        let mut from_start = Mirror::default();
        write(
            &place.engine,
            &first.client,
            &session.id,
            "seq 1 200000; printf 'do%s\\n' ne; read x; exit\r",
        );
        // Attach a second client while the numbers flow.
        follow_until(&first, &mut from_start, |mirror| {
            seq_output(&mirror.text()).last().copied().unwrap_or(0) > 1_000
        });
        let second = Viewer::new(&place.engine);
        attach(&place.engine, &second, &session.id);
        let mut late = Mirror::default();
        let deadline = Instant::now() + WAIT;
        while !(from_start.text().contains("done") && late.text().contains("done")) {
            for (viewer, mirror) in [(&first, &mut from_start), (&second, &mut late)] {
                if let Some(item) = viewer.next(Instant::now() + Duration::from_millis(5)) {
                    mirror.take(item);
                }
            }
            assert!(Instant::now() < deadline, "the output ends");
        }
        // Drain what is left; the program now waits for input.
        for (viewer, mirror) in [(&first, &mut from_start), (&second, &mut late)] {
            while let Some(item) = viewer.next(Instant::now() + Duration::from_millis(200)) {
                mirror.take(item);
            }
        }
        assert_consecutive(&seq_output(&late.text()), 200_000);
        assert_eq!(late.describe(), from_start.describe());
        // A third client gets the state of the engine.
        let third = Viewer::new(&place.engine);
        attach(&place.engine, &third, &session.id);
        let mut engine_state = Mirror::default();
        engine_state.take(third.next(Instant::now() + WAIT).unwrap());
        assert_eq!(engine_state.describe(), late.describe());

        write(&place.engine, &first.client, &session.id, "\r");
        assert_eq!(
            ended(&place.engine, &first, &mut from_start, &session.id).exit_code,
            Some(0)
        );
    }

    #[test]
    fn a_client_that_does_not_read_gets_a_screen_and_is_in_sync_again() {
        let place = place();
        let slow = Viewer::new(&place.engine);
        let fast = Viewer::new(&place.engine);
        let session = create(&place.engine, &fast.client, 80, 24);
        attach(&place.engine, &slow, &session.id);
        attach(&place.engine, &fast, &session.id);
        let mut fast_mirror = Mirror::default();
        // About 1.3 MiB of output, more than the queue of the slow client.
        write(
            &place.engine,
            &fast.client,
            &session.id,
            "seq 1 200000; printf 'do%s\\n' ne; read x; exit\r",
        );
        // The program ends its output although the slow client reads
        // nothing: the reader never waits for a client.
        follow_until(&fast, &mut fast_mirror, |mirror| {
            mirror.text().contains("done")
        });
        while let Some(item) = fast.next(Instant::now() + Duration::from_millis(200)) {
            fast_mirror.take(item);
        }

        let mut slow_mirror = Mirror::default();
        let mut first = true;
        while let Some(item) = slow.next(Instant::now() + Duration::from_millis(200)) {
            if first {
                // The queue overflowed: the next frame is a screen.
                assert!(
                    matches!(&item, Outgoing::Frame(bytes) if bytes[0] == vvorkflow_protocol::FRAME_SCREEN)
                );
                first = false;
            }
            slow_mirror.take(item);
        }
        assert!(
            slow_mirror.output <= OUTPUT_QUEUE,
            "{} bytes after the screen",
            slow_mirror.output
        );
        assert_eq!(slow_mirror.describe(), fast_mirror.describe());
        assert_consecutive(&seq_output(&slow_mirror.text()), 200_000);

        write(&place.engine, &fast.client, &session.id, "\r");
        ended(&place.engine, &fast, &mut fast_mirror, &session.id);
    }

    #[test]
    fn the_screen_comes_after_the_answer_of_attach() {
        let place = place();
        let viewer = Viewer::new(&place.engine);
        let witness = Viewer::new(&place.engine);
        let session = create(&place.engine, &viewer.client, 80, 24);
        attach(&place.engine, &witness, &session.id);
        request(
            &place.engine,
            &viewer.client,
            Request::AttachSession(AttachSession {
                session: session.id.clone(),
            }),
        );
        write(
            &place.engine,
            &viewer.client,
            &session.id,
            "printf 'out%s\\n' put\r",
        );
        // The output flows, as another client sees, but nothing goes to the
        // client before the answer.
        let mut seen = Mirror::default();
        follow_until(&witness, &mut seen, |mirror| {
            mirror.text().contains("output")
        });
        assert!(viewer.client.next().is_none());
        viewer.client.answered();
        let mut mirror = Mirror::default();
        let screen = viewer.next(Instant::now() + WAIT).unwrap();
        assert!(
            matches!(&screen, Outgoing::Frame(bytes) if bytes[0] == vvorkflow_protocol::FRAME_SCREEN)
        );
        mirror.take(screen);
        assert!(mirror.text().contains("output"));
        place.engine.stop(true).unwrap();
    }

    #[test]
    fn a_resize_comes_before_the_output_after_it() {
        let place = place();
        let viewer = Viewer::new(&place.engine);
        let session = create(&place.engine, &viewer.client, 80, 24);
        attach(&place.engine, &viewer, &session.id);
        let mut mirror = Mirror::default();
        follow_until(&viewer, &mut mirror, |mirror| mirror.screen.is_some());
        request(
            &place.engine,
            &viewer.client,
            Request::ResizeSession(ResizeSession {
                session: session.id.clone(),
                columns: 100,
                rows: 30,
            }),
        );
        write(&place.engine, &viewer.client, &session.id, "stty size\r");
        follow_until(&viewer, &mut mirror, |mirror| {
            mirror.text().contains("\n30 100")
        });
        let screen = mirror.screen.as_ref().unwrap();
        assert_eq!((screen.columns(), screen.rows()), (100, 30));
        assert_eq!(list(&place.engine, &viewer.client)[0].columns, 100);
        place.engine.stop(true).unwrap();
    }

    #[test]
    fn the_title_and_the_queries_without_a_client() {
        let place = place();
        let viewer = Viewer::new(&place.engine);
        let session = create(&place.engine, &viewer.client, 80, 24);
        assert_eq!(session.title, "sh");
        // No client is attached: the engine answers the device attributes,
        // which the terminal of the shell then shows as typed input.
        write(
            &place.engine,
            &viewer.client,
            &session.id,
            "printf '\\033]2;my title\\007\\033[c'; read x\r",
        );
        let deadline = Instant::now() + WAIT;
        while list(&place.engine, &viewer.client)[0].title != "my title" {
            assert!(Instant::now() < deadline, "the title comes");
            std::thread::sleep(Duration::from_millis(20));
        }
        attach(&place.engine, &viewer, &session.id);
        let mut mirror = Mirror::default();
        follow_until(&viewer, &mut mirror, |mirror| {
            mirror.text().contains("[?1;2c")
        });
        place.engine.stop(true).unwrap();
    }

    #[test]
    fn a_kill_hangs_up_and_then_kills() {
        let place = place();
        let viewer = Viewer::new(&place.engine);
        let session = create(&place.engine, &viewer.client, 80, 24);
        attach(&place.engine, &viewer, &session.id);
        let mut mirror = Mirror::default();
        write(
            &place.engine,
            &viewer.client,
            &session.id,
            "printf 're%s\\n' ady; sleep 1000\r",
        );
        follow_until(&viewer, &mut mirror, |mirror| {
            mirror.text().contains("ready")
        });
        let kill = || {
            request(
                &place.engine,
                &viewer.client,
                Request::KillSession(KillSession {
                    session: session.id.clone(),
                }),
            )
        };
        kill();
        let end = ended(&place.engine, &viewer, &mut mirror, &session.id);
        assert_eq!((end.exit_code, end.signal), (None, Some(libc_sighup())));

        // A shell that ignores SIGHUP gets SIGKILL after 3 seconds.
        let session = create(&place.engine, &viewer.client, 80, 24);
        attach(&place.engine, &viewer, &session.id);
        let mut mirror = Mirror::default();
        write(
            &place.engine,
            &viewer.client,
            &session.id,
            "trap '' HUP; printf 're%s\\n' ady\r",
        );
        follow_until(&viewer, &mut mirror, |mirror| {
            mirror.text().contains("ready")
        });
        let start = Instant::now();
        request(
            &place.engine,
            &viewer.client,
            Request::KillSession(KillSession {
                session: session.id.clone(),
            }),
        );
        let end = ended(&place.engine, &viewer, &mut mirror, &session.id);
        assert_eq!((end.exit_code, end.signal), (None, Some(9)));
        assert!(start.elapsed() >= Duration::from_millis(2_900));
    }

    fn libc_sighup() -> i32 {
        1
    }

    #[test]
    fn a_full_input_queue_refuses_a_write() {
        let place = place();
        let viewer = Viewer::new(&place.engine);
        let session = create(&place.engine, &viewer.client, 80, 24);
        // `sleep` reads no input: the terminal takes a few KiB, and then the
        // queue fills.
        write(&place.engine, &viewer.client, &session.id, "sleep 1000\r");
        let chunk = "x".repeat(64 * 1024);
        let deadline = Instant::now() + WAIT;
        loop {
            let answer = place.engine.handle(
                &viewer.client,
                Request::WriteSession(WriteSession {
                    session: session.id.clone(),
                    data: STANDARD.encode(&chunk),
                }),
            );
            if let Err(error) = answer {
                assert_eq!(error.code, ErrorCode::FailedPrecondition);
                break;
            }
            assert!(Instant::now() < deadline, "the queue fills");
        }
        place.engine.stop(true).unwrap();
    }

    #[test]
    fn the_engine_keeps_at_most_64_sessions() {
        let place = place();
        let viewer = Viewer::new(&place.engine);
        for _ in 0..vvorkflow_engine::MAX_SESSIONS {
            create(&place.engine, &viewer.client, 20, 5);
        }
        let refused = place
            .engine
            .handle(
                &viewer.client,
                Request::CreateSession(CreateSession {
                    worktree: None,
                    columns: 20,
                    rows: 5,
                }),
            )
            .unwrap_err();
        assert_eq!(refused.code, ErrorCode::FailedPrecondition);
        place.engine.stop(true).unwrap();
        let deadline = Instant::now() + WAIT;
        while place.engine.session_count() > 0 {
            assert!(Instant::now() < deadline, "the sessions end");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
