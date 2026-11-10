//! The screen bytes: bytes that draw the kept state in a terminal that was
//! reset to the size of the session (`docs/architecture.md`, Screen state,
//! rules 2 to 4).
//!
//! The bytes draw each line of the normal screen, the oldest first, so that
//! the lines above the screen go to the scrollback of the terminal, and the
//! long lines wrap there as they wrapped in the engine. Then they draw the
//! alternate screen when it is active, set the saved cursor, the scroll
//! region, the cursor, the attributes, the modes, the title, and the colors,
//! and end with the part of a sequence that the output did not finish.

use std::io::Write;

use alacritty_terminal::Term;
use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::{Cursor, Dimensions, Grid};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::TermMode;
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::vte::ansi::{Color, CursorShape, NamedColor, Rgb};
use vvorkflow_protocol::MAX_SCREEN;

use super::terminal::{MouseEncoding, MouseProtocol, Terminal};

/// The attributes of a cell that SGR sets.
const STYLES: Flags = Flags::BOLD
    .union(Flags::DIM)
    .union(Flags::ITALIC)
    .union(Flags::ALL_UNDERLINES)
    .union(Flags::INVERSE)
    .union(Flags::HIDDEN)
    .union(Flags::STRIKEOUT);

/// Reads the normal screen, also while the alternate screen is active.
///
/// `alacritty_terminal` shows only the active grid. While the alternate
/// screen is active, this swaps the grids, reads, and swaps them back. The
/// swap back clears the alternate grid and sets the saved cursor of the
/// normal grid, so the alternate grid comes back from a copy. The saved
/// cursor of the normal grid has no use while the alternate screen is
/// active: [`Terminal`] keeps it, and sets it again at the exit.
pub(crate) fn with_normal_grid<R>(
    term: &mut Term<VoidListener>,
    read: impl FnOnce(&Grid<Cell>) -> R,
) -> R {
    if !term.mode().contains(TermMode::ALT_SCREEN) {
        return read(term.grid());
    }
    let alternate = term.grid().clone();
    term.swap_alt();
    let value = read(term.grid());
    term.swap_alt();
    *term.grid_mut() = alternate;
    value
}

/// The screen bytes of the state, with the `part` of a sequence at the end.
/// `printed` tells that the last action of the output printed a character.
/// When the bytes would be larger than [`MAX_SCREEN`], the oldest lines of
/// the scrollback are left out.
pub(crate) fn screen_bytes(terminal: &mut Terminal, part: &[u8], printed: bool) -> Vec<u8> {
    let columns = terminal.columns();
    let (history, mut tail) = with_normal_grid(&mut terminal.term, |grid| {
        let rows = grid.screen_lines() as i32;
        let screen = encode_lines(grid, 0..rows, columns, false);
        (history_lines(grid, columns), screen)
    });
    if let Some(saved) = &terminal.alternate {
        // The state of the normal screen that comes back at the exit of the
        // alternate screen: its scroll region, and its saved cursor.
        if let Some(region) = &terminal.normal_region {
            put(
                &mut tail,
                format_args!("\x1b[{};{}r", region.start + 1, region.end),
            );
        }
        save_cursor(&mut tail, saved, columns);
        // Enter with the default attributes: xterm.js fills the alternate
        // screen with the background of the attributes.
        tail.extend_from_slice(b"\x1b[0m\x1b[?1047h\x1b[H");
        let grid = terminal.term.grid();
        let rows = grid.screen_lines() as i32;
        tail.extend_from_slice(&encode_lines(grid, 0..rows, columns, false));
    }
    encode_state(&mut tail, terminal, part, printed);

    // The newest lines of the scrollback that fit in the limit.
    let mut budget = MAX_SCREEN.saturating_sub(tail.len());
    let mut kept = Vec::new();
    for line in history.into_iter().rev() {
        if line.len() > budget {
            break;
        }
        budget -= line.len();
        kept.push(line);
    }
    let size = kept.iter().map(Vec::len).sum::<usize>() + tail.len();
    let mut bytes = Vec::with_capacity(size);
    for line in kept.into_iter().rev() {
        bytes.extend_from_slice(&line);
    }
    bytes.extend_from_slice(&tail);
    bytes
}

/// Each line of the scrollback, the oldest first, each with its own end.
fn history_lines(grid: &Grid<Cell>, columns: usize) -> Vec<Vec<u8>> {
    let top = -(grid.history_size() as i32);
    (top..0)
        .map(|line| {
            let previous_wraps = line > top && wraps(grid, line - 1, columns);
            encode_line(grid, line, columns, previous_wraps, true)
        })
        .collect()
}

/// The lines `lines` of the grid, one after the other. The last line has no
/// line end when `end_last` is false.
fn encode_lines(
    grid: &Grid<Cell>,
    lines: std::ops::Range<i32>,
    columns: usize,
    end_last: bool,
) -> Vec<u8> {
    let mut bytes = Vec::new();
    let top = -(grid.history_size() as i32);
    let last = lines.end - 1;
    for line in lines {
        let previous_wraps = line > top && wraps(grid, line - 1, columns);
        bytes.extend_from_slice(&encode_line(
            grid,
            line,
            columns,
            previous_wraps,
            end_last || line != last,
        ));
    }
    bytes
}

/// Whether the line continues on the next line.
fn wraps(grid: &Grid<Cell>, line: i32, columns: usize) -> bool {
    grid[Line(line)][Column(columns - 1)]
        .flags
        .contains(Flags::WRAPLINE)
}

/// Whether a cell is the same as a cell that was never written.
fn is_blank(cell: &Cell) -> bool {
    cell.c == ' '
        && cell.fg == Color::Named(NamedColor::Foreground)
        && cell.bg == Color::Named(NamedColor::Background)
        && !cell.flags.intersects(STYLES | Flags::WIDE_CHAR)
        && cell.extra.is_none()
}

/// Whether a cell is an erased cell with a background color, as an erase
/// leaves it.
fn is_erased(cell: &Cell, background: Color) -> bool {
    cell.c == ' '
        && cell.bg == background
        && cell.fg == Color::Named(NamedColor::Foreground)
        && !cell.flags.intersects(STYLES | Flags::WIDE_CHAR)
        && cell.extra.is_none()
}

/// One line, which starts and ends with the default attributes, so that the
/// lines of the scrollback do not depend on each other.
///
/// A line that wraps writes each cell up to the last column, and no line
/// end: the terminal wraps it when the next line starts. `previous_wraps`
/// tells that this line continues the line before it. With `end`, a line
/// that does not wrap ends with CR LF.
fn encode_line(
    grid: &Grid<Cell>,
    line: i32,
    columns: usize,
    previous_wraps: bool,
    end: bool,
) -> Vec<u8> {
    let cells = &grid[Line(line)][..Column(columns)];
    let wrapped = cells[columns - 1].flags.contains(Flags::WRAPLINE);
    let mut count = if wrapped {
        columns
    } else {
        cells
            .iter()
            .rposition(|cell| !is_blank(cell))
            .map_or(0, |last| last + 1)
    };
    // A wide character that did not fit leaves the last column empty, and
    // wraps when the next line starts.
    if wrapped
        && cells[columns - 1]
            .flags
            .contains(Flags::LEADING_WIDE_CHAR_SPACER)
    {
        count = columns - 1;
    }
    // A run of erased cells with a color up to the end of the line: an erase
    // with that color, which leaves the cells as the program left them. An
    // erase at the start of a line that continues the line before it would
    // not wrap that line, so it then writes the cells.
    let mut erase = None;
    if !wrapped && count == columns {
        let background = cells[columns - 1].bg;
        if background != Color::Named(NamedColor::Background) {
            let start = cells
                .iter()
                .rposition(|cell| !is_erased(cell, background))
                .map_or(0, |last| last + 1);
            if start < columns && (start > 0 || !previous_wraps) {
                erase = Some((start, background));
                count = start;
            }
        }
    }
    let mut bytes = Vec::with_capacity(count + 8);
    let mut pen = Pen::default();
    // A line that continues the line before it starts with a character, so
    // that the terminal wraps the line before it.
    if previous_wraps && count == 0 && erase.is_none() {
        bytes.push(b' ');
    }
    for cell in &cells[..count] {
        if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
            continue;
        }
        pen.change(&mut bytes, Pen::of(cell));
        write_text(&mut bytes, cell);
    }
    if let Some((_, background)) = erase {
        pen.change(
            &mut bytes,
            Pen {
                background,
                ..Pen::default()
            },
        );
        bytes.extend_from_slice(b"\x1b[K");
    }
    pen.change(&mut bytes, Pen::default());
    if end && !wrapped {
        bytes.extend_from_slice(b"\r\n");
    }
    bytes
}

/// The text of a cell: its character and the combining characters after it.
fn write_text(bytes: &mut Vec<u8>, cell: &Cell) {
    let mut buffer = [0; 4];
    bytes.extend_from_slice(cell.c.encode_utf8(&mut buffer).as_bytes());
    for mark in cell.zerowidth().unwrap_or_default() {
        bytes.extend_from_slice(mark.encode_utf8(&mut buffer).as_bytes());
    }
}

/// The attributes of the cells that the bytes write next.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Pen {
    foreground: Color,
    background: Color,
    flags: Flags,
    underline: Option<Color>,
}

impl Default for Pen {
    fn default() -> Pen {
        Pen {
            foreground: Color::Named(NamedColor::Foreground),
            background: Color::Named(NamedColor::Background),
            flags: Flags::empty(),
            underline: None,
        }
    }
}

impl Pen {
    fn of(cell: &Cell) -> Pen {
        Pen {
            foreground: cell.fg,
            background: cell.bg,
            flags: cell.flags & STYLES,
            underline: cell.underline_color(),
        }
    }

    /// Writes the SGR that changes the attributes to `next`.
    fn change(&mut self, bytes: &mut Vec<u8>, next: Pen) {
        if *self == next {
            return;
        }
        *self = next;
        bytes.extend_from_slice(b"\x1b[0");
        let flags = next.flags;
        for (flag, code) in [
            (Flags::BOLD, &b";1"[..]),
            (Flags::DIM, b";2"),
            (Flags::ITALIC, b";3"),
            (Flags::UNDERLINE, b";4"),
            (Flags::DOUBLE_UNDERLINE, b";4:2"),
            (Flags::UNDERCURL, b";4:3"),
            (Flags::DOTTED_UNDERLINE, b";4:4"),
            (Flags::DASHED_UNDERLINE, b";4:5"),
            (Flags::INVERSE, b";7"),
            (Flags::HIDDEN, b";8"),
            (Flags::STRIKEOUT, b";9"),
        ] {
            if flags.contains(flag) {
                bytes.extend_from_slice(code);
            }
        }
        color(bytes, next.foreground, 30, 90, 38);
        color(bytes, next.background, 40, 100, 48);
        if let Some(underline) = next.underline {
            let index = match underline {
                Color::Named(named) if (named as usize) < 16 => Some(named as u8),
                Color::Indexed(index) => Some(index),
                _ => None,
            };
            match (underline, index) {
                (_, Some(index)) => put(bytes, format_args!(";58;5;{index}")),
                (Color::Spec(Rgb { r, g, b }), None) => {
                    put(bytes, format_args!(";58;2;{r};{g};{b}"));
                }
                _ => {}
            }
        }
        bytes.push(b'm');
    }
}

/// The SGR parameters of a foreground or a background color. A default
/// color has none, because SGR 0 sets it.
fn color(bytes: &mut Vec<u8>, color: Color, normal: u8, bright: u8, extended: u8) {
    match color {
        Color::Named(named) => {
            let index = named as usize;
            if index < 8 {
                put(bytes, format_args!(";{}", usize::from(normal) + index));
            } else if index < 16 {
                put(bytes, format_args!(";{}", usize::from(bright) + index - 8));
            }
        }
        Color::Indexed(index) => put(bytes, format_args!(";{extended};5;{index}")),
        Color::Spec(Rgb { r, g, b }) => put(bytes, format_args!(";{extended};2;{r};{g};{b}")),
    }
}

/// Moves to a cursor and saves it with DECSC, when it is not the cursor of a
/// terminal that was reset.
fn save_cursor(bytes: &mut Vec<u8>, saved: &Cursor<Cell>, columns: usize) {
    let default = Cell::default();
    let at_start = saved.point.line.0 == 0 && saved.point.column.0 == 0;
    if at_start && Pen::of(&saved.template) == Pen::of(&default) {
        return;
    }
    let column = saved.point.column.0.min(columns - 1);
    put(
        bytes,
        format_args!("\x1b[{};{}H", saved.point.line.0 + 1, column + 1),
    );
    let mut pen = Pen::default();
    pen.change(bytes, Pen::of(&saved.template));
    bytes.extend_from_slice(b"\x1b7");
    pen.change(bytes, Pen::default());
}

/// The state after the lines of the active screen.
fn encode_state(bytes: &mut Vec<u8>, terminal: &Terminal, part: &[u8], printed: bool) {
    let term = &terminal.term;
    let grid = term.grid();
    let columns = grid.columns();
    let mode = *term.mode();

    save_cursor(bytes, &grid.saved_cursor, columns);
    // The scroll region and the origin mode move the cursor, so they come
    // before it.
    if let Some(region) = &terminal.region {
        put(
            bytes,
            format_args!("\x1b[{};{}r", region.start + 1, region.end),
        );
    }
    let origin = mode.contains(TermMode::ORIGIN);
    if origin {
        bytes.extend_from_slice(b"\x1b[?6h");
    }
    for (set, code) in [
        (mode.contains(TermMode::APP_CURSOR), &b"\x1b[?1h"[..]),
        (mode.contains(TermMode::APP_KEYPAD), b"\x1b="),
        (mode.contains(TermMode::FOCUS_IN_OUT), b"\x1b[?1004h"),
        (mode.contains(TermMode::BRACKETED_PASTE), b"\x1b[?2004h"),
        (terminal.reverse_wraparound, b"\x1b[?45h"),
        (terminal.mouse == MouseProtocol::X10, b"\x1b[?9h"),
        (terminal.mouse == MouseProtocol::Vt200, b"\x1b[?1000h"),
        (terminal.mouse == MouseProtocol::Drag, b"\x1b[?1002h"),
        (terminal.mouse == MouseProtocol::Any, b"\x1b[?1003h"),
        (terminal.encoding == MouseEncoding::Sgr, b"\x1b[?1006h"),
        (
            terminal.encoding == MouseEncoding::SgrPixels,
            b"\x1b[?1016h",
        ),
    ] {
        if set {
            bytes.extend_from_slice(code);
        }
    }
    // A reset of xterm.js keeps a hidden cursor, the line feed mode, and the
    // blink of mode 12, so the screen bytes set them, also to their
    // defaults.
    let switches: [(bool, &[u8], &[u8]); 3] = [
        (
            mode.contains(TermMode::SHOW_CURSOR),
            b"\x1b[?25h",
            b"\x1b[?25l",
        ),
        (
            mode.contains(TermMode::LINE_FEED_NEW_LINE),
            b"\x1b[20h",
            b"\x1b[20l",
        ),
        (terminal.blink, b"\x1b[?12h", b"\x1b[?12l"),
    ];
    for (set, on, off) in switches {
        bytes.extend_from_slice(if set { on } else { off });
    }
    if let Some(style) = terminal.cursor_style {
        let shape = match style.shape {
            CursorShape::Underline => 3,
            CursorShape::Beam => 5,
            _ => 1,
        };
        put(
            bytes,
            format_args!("\x1b[{} q", shape + u8::from(!style.blinking)),
        );
    }
    if let Some(title) = &terminal.title {
        put(bytes, format_args!("\x1b]2;{title}\x1b\\"));
    }
    let colors = term.colors();
    for index in 0..256 {
        if let Some(Rgb { r, g, b }) = colors[index] {
            put(
                bytes,
                format_args!("\x1b]4;{index};rgb:{r:02x}/{g:02x}/{b:02x}\x1b\\"),
            );
        }
    }
    for (named, code) in [
        (NamedColor::Foreground, 10),
        (NamedColor::Background, 11),
        (NamedColor::Cursor, 12),
    ] {
        if let Some(Rgb { r, g, b }) = colors[named as usize] {
            put(
                bytes,
                format_args!("\x1b]{code};rgb:{r:02x}/{g:02x}/{b:02x}\x1b\\"),
            );
        }
    }
    if terminal.synchronized {
        bytes.extend_from_slice(b"\x1b[?2026h");
    }

    // Insert mode, and the end of autowrap, do not change the print of the
    // cursor below.
    let insert = mode.contains(TermMode::INSERT);
    if insert {
        bytes.extend_from_slice(b"\x1b[4h");
    }
    if !mode.contains(TermMode::LINE_WRAP) {
        bytes.extend_from_slice(b"\x1b[?7l");
    }

    // The cursor comes last. A cursor that waits to wrap after the last
    // column, or that follows the character that the output printed last,
    // gets there with that character printed again: the terminal is then in
    // the same state, and in xterm.js a combining character at the start of
    // the next output joins that character. Insert mode would move the cells
    // after a character that is not in the last column.
    let top = match (&terminal.region, origin) {
        (Some(region), true) => region.start,
        _ => 0,
    };
    let cursor = &grid.cursor;
    let row = (cursor.point.line.0 as usize).saturating_sub(top) + 1;
    let line = &grid[cursor.point.line];
    let column = cursor.point.column.0;
    let again = if cursor.input_needs_wrap {
        Some(column)
    } else if printed && column > 0 && !insert {
        Some(column - 1)
    } else {
        None
    };
    let template = Pen::of(&cursor.template);
    match again {
        Some(mut last) => {
            if last > 0 && line[Column(last)].flags.contains(Flags::WIDE_CHAR_SPACER) {
                last -= 1;
            }
            let cell = &line[Column(last)];
            let mut pen = Pen::default();
            pen.change(bytes, Pen::of(cell));
            put(bytes, format_args!("\x1b[{row};{}H", last + 1));
            write_text(bytes, cell);
            pen.change(bytes, template);
        }
        None => {
            Pen::default().change(bytes, template);
            put(bytes, format_args!("\x1b[{row};{}H", column + 1));
        }
    }
    bytes.extend_from_slice(part);
}

fn put(bytes: &mut Vec<u8>, text: std::fmt::Arguments<'_>) {
    bytes.write_fmt(text).expect("a Vec takes each write");
}
