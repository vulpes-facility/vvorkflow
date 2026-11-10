//! The clients of the engine: the context of each request, and the queues
//! of the output of the sessions that a client is attached to.
//!
//! The thread that reads a pseudo-terminal puts the output of its session
//! in the queue of each attached client, and never waits for a client. The
//! writer of the connection takes the next item with [`Client::next`]: an
//! event, an output frame, or a screen frame, which it makes at that moment
//! (`docs/architecture.md`, Attach, output, and input).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use vvorkflow_protocol::{Event, Frame, SessionEnded, SessionResized};

use super::Core;

/// The bytes of output frames that the queue of a client keeps for one
/// session. When the next output does not fit, the engine discards the
/// queue, and sends a screen in its place.
pub const OUTPUT_QUEUE: usize = 1 << 20;

/// The most output bytes in one output frame: the writer joins the queued
/// output of a session up to this size.
const FRAME_OUTPUT: usize = 64 * 1024;

/// The bytes before the output in an output frame.
const FRAME_HEADER: usize = 17;

/// Where a client connects from. A remote client (M6) reaches only the
/// projects root.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientKind {
    /// A client on the computer of the engine, through the local socket.
    Local,
}

/// Tells the writer of a connection that its client has something to send.
/// It MUST NOT block: the thread that reads a pseudo-terminal calls it.
pub type Wake = Arc<dyn Fn() + Send + Sync>;

/// The next message for a client.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outgoing {
    /// A text frame.
    Event(Event),
    /// A binary frame.
    Frame(Vec<u8>),
}

/// The context of the requests of one connection: its kind, and the queues
/// of the sessions that it is attached to. When the last copy of a client
/// drops, it detaches from each session.
#[derive(Clone)]
pub struct Client(pub(super) Arc<Inner>);

pub(super) struct Inner {
    kind: ClientKind,
    outbox: Mutex<Outbox>,
    wake: Wake,
}

/// The queues of one client, one for each attached session.
#[derive(Default)]
struct Outbox {
    slots: Vec<Slot>,
    /// The slot that the writer reads first next time, so that each session
    /// gets its turn.
    turn: usize,
}

/// The screen of a session that a client waits for. While it is not `None`,
/// the engine queues no output of the session for the client.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Screen {
    None,
    /// `session.attach` asked for it; it goes after the answer.
    Asked,
    /// The writer makes it when it is ready.
    Due,
}

struct Slot {
    session: Arc<Core>,
    queue: VecDeque<Item>,
    /// The bytes of the output frames in the queue.
    bytes: usize,
    screen: Screen,
}

enum Item {
    Output(Arc<[u8]>),
    Resized { columns: u16, rows: u16 },
    Ended(SessionEnded),
}

impl Client {
    pub(crate) fn new(kind: ClientKind, wake: Wake) -> Client {
        Client(Arc::new(Inner {
            kind,
            outbox: Mutex::default(),
            wake,
        }))
    }

    pub fn kind(&self) -> ClientKind {
        self.0.kind
    }

    pub(super) fn downgrade(&self) -> Weak<Inner> {
        Arc::downgrade(&self.0)
    }

    /// Tells that the answers to the requests so far are on their way: a
    /// screen that `session.attach` asked for can go now, after its answer.
    pub fn answered(&self) {
        let mut outbox = self.0.outbox();
        let mut due = false;
        for slot in &mut outbox.slots {
            if slot.screen == Screen::Asked {
                slot.screen = Screen::Due;
                due = true;
            }
        }
        drop(outbox);
        if due {
            (self.0.wake)();
        }
    }

    /// The next message for this client, or None when it has nothing to
    /// send. A screen frame is made now, from the state of this moment.
    pub fn next(&self) -> Option<Outgoing> {
        loop {
            let mut outbox = self.0.outbox();
            let count = outbox.slots.len();
            let found = (0..count)
                .map(|offset| (outbox.turn + offset) % count)
                .find(|&index| {
                    let slot = &outbox.slots[index];
                    slot.screen == Screen::Due
                        || (slot.screen == Screen::None && !slot.queue.is_empty())
                })?;
            outbox.turn = (found + 1) % count;
            let slot = &mut outbox.slots[found];
            if slot.screen == Screen::None {
                return Some(take_queued(&mut outbox, found));
            }
            let session = Arc::clone(&slot.session);
            drop(outbox);
            if let Some(frame) = self.make_screen(&session) {
                return Some(Outgoing::Frame(frame));
            }
        }
    }

    /// Makes the screen frame that this client waits for, and takes the
    /// mark away, in one step under the lock of the session. Returns None
    /// when the client no longer waits for it.
    fn make_screen(&self, session: &Arc<Core>) -> Option<Vec<u8>> {
        let mut state = session.state();
        {
            let mut outbox = self.0.outbox();
            let slot = outbox
                .slots
                .iter_mut()
                .find(|slot| Arc::ptr_eq(&slot.session, session))?;
            if slot.screen != Screen::Due {
                return None;
            }
            slot.screen = Screen::None;
        }
        let screen = state.screen.bytes();
        let frame = Frame::Screen {
            session: &session.id,
            columns: state.screen.columns(),
            rows: state.screen.rows(),
            screen: &screen,
        };
        Some(frame.encode())
    }

    /// Attaches to a session, or asks for its screen again: the queue of the
    /// session empties, and a screen follows the answer. The caller holds
    /// the lock of the session.
    pub(super) fn attach(&self, session: &Arc<Core>) {
        let mut outbox = self.0.outbox();
        match outbox
            .slots
            .iter_mut()
            .find(|slot| Arc::ptr_eq(&slot.session, session))
        {
            Some(slot) => {
                slot.queue.clear();
                slot.bytes = 0;
                slot.screen = Screen::Asked;
            }
            None => outbox.slots.push(Slot {
                session: Arc::clone(session),
                queue: VecDeque::new(),
                bytes: 0,
                screen: Screen::Asked,
            }),
        }
    }

    /// Detaches from a session: its queue goes away. The caller holds the
    /// lock of the session.
    pub(super) fn detach(&self, session: &Arc<Core>) {
        let mut outbox = self.0.outbox();
        outbox
            .slots
            .retain(|slot| !Arc::ptr_eq(&slot.session, session));
        outbox.turn = 0;
    }
}

/// Takes the next frame or event of a slot that is not waiting for a screen.
/// Output that follows other output in the queue joins it, up to
/// [`FRAME_OUTPUT`] bytes. After `session.ended`, the slot goes away.
fn take_queued(outbox: &mut MutexGuard<'_, Outbox>, index: usize) -> Outgoing {
    let slot = &mut outbox.slots[index];
    let item = slot.queue.pop_front().expect("the slot has an item");
    match item {
        Item::Output(output) => {
            slot.bytes -= output.len() + FRAME_HEADER;
            let mut joined = output.to_vec();
            while let Some(Item::Output(next)) = slot.queue.front() {
                if joined.len() + next.len() > FRAME_OUTPUT {
                    break;
                }
                joined.extend_from_slice(next);
                slot.bytes -= next.len() + FRAME_HEADER;
                slot.queue.pop_front();
            }
            Outgoing::Frame(
                Frame::Output {
                    session: &slot.session.id,
                    output: &joined,
                }
                .encode(),
            )
        }
        Item::Resized { columns, rows } => Outgoing::Event(Event::SessionResized(SessionResized {
            session: slot.session.id.clone(),
            columns,
            rows,
        })),
        Item::Ended(ended) => {
            outbox.slots.remove(index);
            outbox.turn = 0;
            Outgoing::Event(Event::SessionEnded(ended))
        }
    }
}

impl Inner {
    fn outbox(&self) -> MutexGuard<'_, Outbox> {
        self.outbox
            .lock()
            .expect("the outbox lock is never poisoned")
    }

    fn slot(outbox: &mut Outbox, session: &Core) -> Option<usize> {
        outbox
            .slots
            .iter()
            .position(|slot| std::ptr::eq(Arc::as_ptr(&slot.session), session))
    }

    /// Queues output of a session, unless the client waits for its screen.
    /// When the output does not fit in the queue, the queue empties, and the
    /// client gets a screen in its place. Never waits for the client. The
    /// caller holds the lock of the session.
    pub(super) fn output(&self, session: &Core, output: &Arc<[u8]>) {
        let mut outbox = self.outbox();
        let Some(index) = Self::slot(&mut outbox, session) else {
            return;
        };
        let slot = &mut outbox.slots[index];
        if slot.screen != Screen::None {
            return;
        }
        let size = output.len() + FRAME_HEADER;
        if slot.bytes + size > OUTPUT_QUEUE {
            slot.queue.clear();
            slot.bytes = 0;
            slot.screen = Screen::Due;
        } else {
            slot.queue.push_back(Item::Output(Arc::clone(output)));
            slot.bytes += size;
        }
        drop(outbox);
        (self.wake)();
    }

    /// Queues the new size of a session, unless the client waits for its
    /// screen, which has the size. The caller holds the lock of the
    /// session.
    pub(super) fn resized(&self, session: &Core, columns: u16, rows: u16) {
        let mut outbox = self.outbox();
        let Some(index) = Self::slot(&mut outbox, session) else {
            return;
        };
        let slot = &mut outbox.slots[index];
        if slot.screen != Screen::None {
            return;
        }
        slot.queue.push_back(Item::Resized { columns, rows });
        drop(outbox);
        (self.wake)();
    }

    /// Queues the end of a session, after its output and after the screen
    /// that the client waits for. The caller holds the lock of the session.
    pub(super) fn ended(&self, session: &Core, ended: SessionEnded) {
        let mut outbox = self.outbox();
        let Some(index) = Self::slot(&mut outbox, session) else {
            return;
        };
        outbox.slots[index].queue.push_back(Item::Ended(ended));
        drop(outbox);
        (self.wake)();
    }
}

impl Drop for Inner {
    /// The end of the connection detaches the client from each session.
    fn drop(&mut self) {
        let slots = std::mem::take(
            &mut self
                .outbox
                .get_mut()
                .expect("the outbox lock is never poisoned")
                .slots,
        );
        let this: *const Inner = self;
        for slot in slots {
            slot.session
                .state()
                .clients
                .retain(|client| client.as_ptr() != this);
        }
    }
}
