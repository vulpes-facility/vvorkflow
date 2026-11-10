//! The screen state of a terminal session: what the output of the program
//! made, kept so that a client that attaches later sees the same terminal
//! (`docs/architecture.md`, Screen state).
//!
//! [`Screen`] reads the output with the parser and the grid of
//! `alacritty_terminal`, and makes the screen bytes: bytes that draw the same
//! state in a terminal that was reset to the size of the session. The
//! terminal of the web UI is xterm.js, so the state follows xterm.js where
//! the two differ.

mod encode;
mod sequence;
mod terminal;

use std::fmt::Write as _;
use std::time::Duration;

use alacritty_terminal::grid::{Cursor, Dimensions, Grid};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::TermMode;
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::vte::ansi::{Processor, Timeout};

pub use sequence::MAX_PART;
pub use terminal::{MAX_CELL_TEXT, MAX_TITLE, SCROLLBACK};

use sequence::Sequence;
use terminal::Terminal;

/// The kept state of one terminal.
pub struct Screen {
    parser: Processor<Unbuffered>,
    terminal: Terminal,
    sequence: Sequence,
}

/// A synchronized update (mode 2026) is for the drawing of a terminal: the
/// state takes each byte at once, so that a screen has each byte before it.
#[derive(Default)]
struct Unbuffered;

impl Timeout for Unbuffered {
    fn set_timeout(&mut self, _duration: Duration) {}

    fn clear_timeout(&mut self) {}

    fn pending_timeout(&self) -> bool {
        false
    }
}

impl Screen {
    /// An empty screen of `columns` and `rows`, as a terminal after a reset.
    /// The size MUST be in the limits of a session.
    pub fn new(columns: u16, rows: u16) -> Screen {
        Screen {
            parser: Processor::new(),
            terminal: Terminal::new(columns, rows),
            sequence: Sequence::new(),
        }
    }

    /// Reads the next output of the program.
    pub fn feed(&mut self, output: &[u8]) {
        let Screen {
            parser,
            terminal,
            sequence,
        } = self;
        sequence.feed(output, |bytes| parser.advance(terminal, bytes));
    }

    /// Changes the size. The lines of the normal screen wrap again by the
    /// rules of `alacritty_terminal`.
    pub fn resize(&mut self, columns: u16, rows: u16) {
        self.terminal.resize(columns, rows);
    }

    pub fn columns(&self) -> u16 {
        u16::try_from(self.terminal.columns()).unwrap_or(u16::MAX)
    }

    pub fn rows(&self) -> u16 {
        u16::try_from(self.terminal.rows()).unwrap_or(u16::MAX)
    }

    /// The last title that the program set with OSC 0 or OSC 2, cut to
    /// [`MAX_TITLE`] bytes.
    pub fn title(&self) -> Option<&str> {
        self.terminal.title.as_deref()
    }

    /// The screen bytes of the current state: they draw it in a terminal
    /// that was reset to the size of this screen, and end with the part of
    /// a sequence that the output did not finish, so that the next output
    /// continues it. At most [`vvorkflow_protocol::MAX_SCREEN`] bytes: the
    /// oldest lines of the scrollback are left out when the bytes would be
    /// larger.
    pub fn bytes(&mut self) -> Vec<u8> {
        encode::screen_bytes(
            &mut self.terminal,
            self.sequence.part(),
            self.sequence.printed(),
        )
    }

    /// Sets whether the screen answers the queries for the cursor position
    /// and the device attributes: only while no client is attached, because
    /// the terminal of a client answers them.
    pub(crate) fn answer_queries(&mut self, answer: bool) {
        self.terminal.answering = answer;
    }

    /// The answers to the queries of the program, for its input.
    pub(crate) fn take_answers(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.terminal.answers)
    }

    /// The whole state as text, one line for each row: the text, the
    /// attributes, the cursor, and the modes. Two screens with the same text
    /// show the same in a terminal. The parts that the engine does not keep
    /// (`docs/architecture.md`, Screen state, rule 5) are not in it. For
    /// tests, and to find where two states differ.
    pub fn describe(&mut self) -> String {
        let terminal = &mut self.terminal;
        let mut text = String::new();
        let _ = writeln!(text, "size {}x{}", terminal.columns(), terminal.rows());
        // While the alternate screen is active, the cursor of the normal
        // screen has no use: each exit sets it.
        let alternate = terminal.alternate.is_some();
        let normal = encode::with_normal_grid(&mut terminal.term, |grid| {
            let mut text = String::new();
            describe_grid(&mut text, grid, !alternate);
            text
        });
        text.push_str("normal\n");
        text.push_str(&normal);
        if let Some(saved) = &terminal.alternate {
            let _ = writeln!(text, "normal saved {}", describe_cursor(saved, false));
            text.push_str("alternate\n");
            describe_grid(&mut text, terminal.term.grid(), true);
        }
        let mode = *terminal.term.mode()
            & (TermMode::APP_CURSOR
                | TermMode::APP_KEYPAD
                | TermMode::LINE_WRAP
                | TermMode::SHOW_CURSOR
                | TermMode::INSERT
                | TermMode::LINE_FEED_NEW_LINE
                | TermMode::ORIGIN
                | TermMode::FOCUS_IN_OUT
                | TermMode::BRACKETED_PASTE
                | TermMode::ALT_SCREEN);
        let _ = writeln!(
            text,
            "modes {mode:?} mouse {:?} {:?} reverse-wraparound {} synchronized {}",
            terminal.mouse, terminal.encoding, terminal.reverse_wraparound, terminal.synchronized
        );
        let _ = writeln!(
            text,
            "region {:?} normal region {:?} cursor style {:?}",
            terminal.region,
            terminal.normal_region,
            terminal.term.cursor_style(),
        );
        let _ = writeln!(text, "title {:?}", terminal.title);
        let colors = terminal.term.colors();
        let changed: Vec<String> = (0..alacritty_terminal::term::color::COUNT)
            .filter_map(|index| colors[index].map(|rgb| format!("{index}={rgb:?}")))
            .collect();
        let _ = writeln!(text, "colors {}", changed.join(" "));
        let _ = writeln!(
            text,
            "part {:?}",
            String::from_utf8_lossy(self.sequence.part())
        );
        text
    }
}

/// A cursor. A saved cursor never waits to wrap when it comes back, so its
/// `waits` is false.
fn describe_cursor(cursor: &Cursor<Cell>, waits: bool) -> String {
    format!(
        "{},{}{} {}",
        cursor.point.line.0,
        cursor.point.column.0,
        if waits && cursor.input_needs_wrap {
            " wraps"
        } else {
            ""
        },
        describe_attributes(&cursor.template)
    )
}

fn describe_attributes(cell: &Cell) -> String {
    let flags = cell.flags
        & !(Flags::WRAPLINE
            | Flags::WIDE_CHAR
            | Flags::WIDE_CHAR_SPACER
            | Flags::LEADING_WIDE_CHAR_SPACER);
    format!(
        "{:?}/{:?}/{:?}/{:?}",
        cell.fg,
        cell.bg,
        flags,
        cell.underline_color()
    )
}

fn describe_grid(text: &mut String, grid: &Grid<Cell>, cursors: bool) {
    let columns = grid.columns();
    let top = -(grid.history_size() as i32);
    for line in top..grid.screen_lines() as i32 {
        let row = &grid[Line(line)];
        let mut chars = String::new();
        let mut runs = Vec::new();
        let mut last: Option<(String, usize)> = None;
        for column in 0..columns {
            let cell = &row[Column(column)];
            chars.push(cell.c);
            if let Some(marks) = cell.zerowidth() {
                chars.extend(marks);
            }
            if cell.flags.contains(Flags::WIDE_CHAR) {
                chars.push('⟩');
            }
            let attributes = describe_attributes(cell);
            match &mut last {
                Some((previous, count)) if *previous == attributes => *count += 1,
                _ => {
                    if let Some(run) = last.take() {
                        runs.push(run);
                    }
                    last = Some((attributes, 1));
                }
            }
        }
        runs.extend(last);
        let wraps = row[Column(columns - 1)].flags.contains(Flags::WRAPLINE);
        let _ = write!(
            text,
            "{line:>6}{} {:?}",
            if wraps { "+" } else { " " },
            chars.trim_end()
        );
        if !(runs.len() == 1 && runs[0].0 == describe_attributes(&Cell::default())) {
            for (attributes, count) in runs {
                let _ = write!(text, " {count}×{attributes}");
            }
        }
        text.push('\n');
    }
    if cursors {
        let _ = writeln!(text, "cursor {}", describe_cursor(&grid.cursor, true));
        let _ = writeln!(text, "saved {}", describe_cursor(&grid.saved_cursor, false));
    }
}

#[cfg(test)]
mod tests;
