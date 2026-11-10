//! The terminal state of a session: the grid of `alacritty_terminal`, and the
//! parts of the state that it does not keep, or keeps in another way than
//! xterm.js, the terminal of the web UI.
//!
//! [`Terminal`] reads each action of the parser before the grid does. It
//! keeps those parts itself, so that the screen bytes can bring them back,
//! and it leaves out what xterm.js does not do, so that the kept state is the
//! state that xterm.js shows.

use std::ops::Range;

use alacritty_terminal::Term;
use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::{Cursor, Dimensions};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::term::{Config, Osc52, TermMode};
use alacritty_terminal::vte::ansi::{
    Attr, CharsetIndex, ClearMode, CursorStyle, Handler, Hyperlink, KeyboardModes,
    KeyboardModesApplyBehavior, LineClearMode, Mode, ModifyOtherKeys, NamedPrivateMode,
    PrivateMode, Rgb, ScpCharPath, ScpUpdateMode, StandardCharset, TabulationClearMode,
};
use unicode_width::UnicodeWidthChar;

use super::sequence::Run;

/// The lines of the scrollback that a session keeps.
pub const SCROLLBACK: usize = 5_000;

/// The largest title, in bytes.
pub const MAX_TITLE: usize = 1_024;

/// The bytes of text that one cell keeps at most: its character and the
/// combining characters after it.
pub const MAX_CELL_TEXT: usize = 32;

/// A size of the grid, for `alacritty_terminal`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Size {
    pub(crate) columns: usize,
    pub(crate) rows: usize,
}

impl Dimensions for Size {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.columns
    }
}

/// The mouse events that a program asks for, as xterm.js keeps them: one
/// protocol, which each reset of a mouse mode turns off.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum MouseProtocol {
    #[default]
    None,
    /// Mode 9.
    X10,
    /// Mode 1000.
    Vt200,
    /// Mode 1002.
    Drag,
    /// Mode 1003.
    Any,
}

/// The encoding of the mouse events, as xterm.js keeps it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum MouseEncoding {
    #[default]
    Default,
    /// Mode 1006.
    Sgr,
    /// Mode 1016.
    SgrPixels,
}

/// The state of the terminal of one session.
pub(crate) struct Terminal {
    pub(crate) term: Term<VoidListener>,
    /// The last title that the program set, cut to [`MAX_TITLE`] bytes.
    pub(crate) title: Option<String>,
    /// The scroll region of the active screen, as rows from 0, the end not
    /// included; None is the whole screen. `alacritty_terminal` does not
    /// show its own, so this follows each change of it.
    pub(crate) region: Option<Range<usize>>,
    /// The scroll region of the normal screen while the alternate screen is
    /// active: xterm.js keeps one for each screen.
    pub(crate) normal_region: Option<Range<usize>>,
    /// While the alternate screen is active, the saved cursor of the normal
    /// screen: the cursor that DECRC and the exit of mode 1049 restore
    /// there. xterm.js keeps a saved cursor for each screen.
    pub(crate) alternate: Option<Cursor<Cell>>,
    pub(crate) mouse: MouseProtocol,
    pub(crate) encoding: MouseEncoding,
    /// Mode 45.
    pub(crate) reverse_wraparound: bool,
    /// Mode 12, the blink of the cursor. xterm.js keeps it apart from the
    /// style of DECSCUSR (CSI q), as an option that a reset keeps; a style
    /// decides the blink when the program set one.
    pub(crate) blink: bool,
    /// The style of DECSCUSR, or none for the style of the terminal.
    pub(crate) cursor_style: Option<CursorStyle>,
    /// Mode 2026.
    pub(crate) synchronized: bool,
    /// Whether the engine answers the queries of the program: only while no
    /// client is attached.
    pub(crate) answering: bool,
    /// The answers to queries, for the input of the program.
    pub(crate) answers: Vec<u8>,
    /// What the bytes that the parser reads now do: a REP repeats the cell
    /// of the last character, or nothing.
    pub(crate) run: Run,
}

impl Terminal {
    pub(crate) fn new(columns: u16, rows: u16) -> Terminal {
        let config = Config {
            scrolling_history: SCROLLBACK,
            // xterm.js has no keyboard protocol of kitty, so the program
            // never gets an answer that turns it on.
            kitty_keyboard: false,
            osc52: Osc52::Disabled,
            ..Config::default()
        };
        let size = Size {
            columns: usize::from(columns),
            rows: usize::from(rows),
        };
        Terminal {
            term: Term::new(config, &size, VoidListener),
            title: None,
            region: None,
            normal_region: None,
            alternate: None,
            mouse: MouseProtocol::None,
            encoding: MouseEncoding::Default,
            reverse_wraparound: false,
            blink: false,
            cursor_style: None,
            synchronized: false,
            answering: true,
            answers: Vec::new(),
            run: Run::Plain,
        }
    }

    pub(crate) fn columns(&self) -> usize {
        self.term.columns()
    }

    pub(crate) fn rows(&self) -> usize {
        self.term.screen_lines()
    }

    /// Changes the size. The scroll regions of both screens go back to the
    /// whole screen, as in xterm.js.
    pub(crate) fn resize(&mut self, columns: u16, rows: u16) {
        self.term.resize(Size {
            columns: usize::from(columns),
            rows: usize::from(rows),
        });
        self.region = None;
        self.normal_region = None;
    }

    /// Sets the scroll region of `alacritty_terminal`, and keeps the cursor
    /// where it is, because the change of a screen does not move it.
    fn apply_region(&mut self, region: Option<Range<usize>>) {
        let cursor = self.term.grid().cursor.clone();
        match &region {
            Some(rows) => self
                .term
                .set_scrolling_region(rows.start + 1, Some(rows.end)),
            None => self.term.set_scrolling_region(1, None),
        }
        self.term.grid_mut().cursor = cursor;
        self.region = region;
    }

    /// Enters the alternate screen, cleared, with the cursor of the normal
    /// screen, and the whole screen as its scroll region, as xterm.js does.
    fn enter_alternate(&mut self) {
        if self.alternate.is_some() {
            return;
        }
        let saved = self.term.grid().saved_cursor.clone();
        self.term.set_private_mode(PrivateMode::Named(
            NamedPrivateMode::SwapScreenAndSetRestoreCursor,
        ));
        self.alternate = Some(saved);
        self.normal_region = self.region.take();
        self.apply_region(None);
    }

    /// Enters the normal screen with its scroll region and its saved
    /// cursor. Returns the cursor of the alternate screen, or None when the
    /// normal screen is active.
    fn exit_alternate(&mut self) -> Option<Cursor<Cell>> {
        let saved = self.alternate.take()?;
        let alternate_cursor = self.term.grid().cursor.clone();
        self.term.unset_private_mode(PrivateMode::Named(
            NamedPrivateMode::SwapScreenAndSetRestoreCursor,
        ));
        let region = self.normal_region.take();
        self.apply_region(region);
        // The swap of `alacritty_terminal` changed the saved cursor of the
        // normal screen when it entered the alternate screen.
        self.term.grid_mut().saved_cursor = saved;
        Some(alternate_cursor)
    }

    /// Prints the text of the cell of the last character again, with its
    /// combining characters, as the REP of xterm.js does. `vte` gives only
    /// the last character, which can be a combining one.
    fn repeat(&mut self) {
        let grid = self.term.grid();
        let cursor = &grid.cursor;
        let line = &grid[cursor.point.line];
        let mut column = if cursor.input_needs_wrap {
            cursor.point.column.0
        } else {
            cursor.point.column.0.saturating_sub(1)
        };
        if column > 0 && line[Column(column)].flags.contains(Flags::WIDE_CHAR_SPACER) {
            column -= 1;
        }
        let cell = &line[Column(column)];
        let mut text = vec![cell.c];
        text.extend(cell.zerowidth().unwrap_or_default());
        self.run = Run::Plain;
        for c in text {
            self.input(c);
        }
        self.run = Run::Repeat;
    }

    /// Whether `line` continues on the next line: the flag WRAPLINE on its
    /// last cell. xterm.js keeps the flag on the next line instead, and only
    /// an autowrap, an erase from the start of that line, and a reset change
    /// it. `alacritty_terminal` also loses the flag when a cell moves or an
    /// erase reaches the last cell, so the actions that do so keep it.
    fn wraps(&self, line: i32) -> bool {
        let grid = self.term.grid();
        let in_grid = line >= -(grid.history_size() as i32) && line < grid.screen_lines() as i32;
        in_grid
            && grid[Line(line)][Column(grid.columns() - 1)]
                .flags
                .contains(Flags::WRAPLINE)
    }

    fn set_wraps(&mut self, line: i32, wraps: bool) {
        let grid = self.term.grid_mut();
        if line < -(grid.history_size() as i32) || line >= grid.screen_lines() as i32 {
            return;
        }
        let last = Column(grid.columns() - 1);
        grid[Line(line)][last].flags.set(Flags::WRAPLINE, wraps);
    }

    /// Does an action that changes only the cells of the cursor line, and
    /// keeps whether that line continues on the next line. With
    /// `from_start`, the action erases the line from its first cell, which
    /// in xterm.js makes it a line of its own.
    fn in_line(&mut self, from_start: bool, action: impl FnOnce(&mut Term<VoidListener>)) {
        let line = self.term.grid().cursor.point.line.0;
        let wraps = self.wraps(line);
        action(&mut self.term);
        self.set_wraps(line, wraps);
        if from_start {
            self.set_wraps(line - 1, false);
        }
    }

    /// Restores the saved cursor of the active screen. As xterm.js, the
    /// cursor is then in the screen, also when the saved cursor waited to
    /// wrap after the last column.
    fn restore_cursor(&mut self) {
        self.term.restore_cursor_position();
        self.term.grid_mut().cursor.input_needs_wrap = false;
    }

    fn answer(&mut self, text: &str) {
        if self.answering {
            self.answers.extend_from_slice(text.as_bytes());
        }
    }

    /// The cell that a combining character joins, as `Term::input` finds it.
    fn combining_target(&self) -> &Cell {
        let grid = self.term.grid();
        let cursor = &grid.cursor;
        let mut column = cursor.point.column;
        if !cursor.input_needs_wrap {
            column.0 = column.0.saturating_sub(1);
        }
        let row = &grid[cursor.point.line];
        if row[column].flags.contains(Flags::WIDE_CHAR_SPACER) {
            column.0 = column.0.saturating_sub(1);
        }
        &row[column]
    }
}

/// The bytes of text of a cell.
pub(crate) fn cell_text_len(cell: &Cell) -> usize {
    cell.c.len_utf8()
        + cell
            .zerowidth()
            .map_or(0, |marks| marks.iter().map(|mark| mark.len_utf8()).sum())
}

/// Cuts a title to [`MAX_TITLE`] bytes, at the start of a character, and
/// leaves out the control characters, which are not text.
fn cut_title(title: String) -> String {
    let mut title = if title.chars().any(char::is_control) {
        title.chars().filter(|c| !c.is_control()).collect()
    } else {
        title
    };
    if title.len() > MAX_TITLE {
        let mut end = MAX_TITLE;
        while !title.is_char_boundary(end) {
            end -= 1;
        }
        title.truncate(end);
    }
    title
}

/// Each action of the parser goes to the grid, except the ones that this
/// state keeps itself, and the ones that xterm.js does not do. A method that
/// this does not write is an action that `vte` names and xterm.js does not
/// do, such as the mouse cursor icon (OSC 22).
impl Handler for Terminal {
    fn set_title(&mut self, title: Option<String>) {
        // `alacritty_terminal` uses the title only for its own events.
        self.title = title.map(cut_title);
    }

    fn set_cursor_style(&mut self, style: Option<CursorStyle>) {
        self.cursor_style = style;
    }

    fn input(&mut self, c: char) {
        match self.run {
            Run::Plain => {}
            Run::Repeat => return self.repeat(),
            Run::Silent => return,
        }
        // A cell keeps at most 32 bytes of text, so that a program that
        // writes only combining characters cannot fill the memory.
        if c.width() == Some(0)
            && cell_text_len(self.combining_target()) + c.len_utf8() > MAX_CELL_TEXT
        {
            return;
        }
        // A character in the last column replaces its cell, with the flag
        // that the line continues; when the cursor then waits to wrap on the
        // same line, the flag of xterm.js did not change.
        let cursor = &self.term.grid().cursor;
        if cursor.input_needs_wrap {
            self.term.input(c);
            return;
        }
        let line = cursor.point.line.0;
        let wraps = self.wraps(line);
        self.term.input(c);
        let cursor = &self.term.grid().cursor;
        if cursor.point.line.0 == line && cursor.input_needs_wrap {
            self.set_wraps(line, wraps);
        }
    }

    fn goto(&mut self, line: i32, column: usize) {
        self.term.goto(line, column);
    }

    fn goto_line(&mut self, line: i32) {
        self.term.goto_line(line);
    }

    fn goto_col(&mut self, column: usize) {
        self.term.goto_col(column);
    }

    fn insert_blank(&mut self, count: usize) {
        self.in_line(false, |term| term.insert_blank(count));
    }

    fn move_up(&mut self, rows: usize) {
        self.term.move_up(rows);
    }

    fn move_down(&mut self, rows: usize) {
        self.term.move_down(rows);
    }

    fn identify_terminal(&mut self, intermediate: Option<char>) {
        // The answers of xterm.js, so that a program gets the same answer
        // with and without an attached client.
        match intermediate {
            None => self.answer("\x1b[?1;2c"),
            Some('>') => self.answer("\x1b[>0;276;0c"),
            Some(_) => {}
        }
    }

    fn device_status(&mut self, status: usize) {
        if status == 6 {
            // As xterm.js: a cursor after the last column, which waits to
            // wrap, is in the column after the screen.
            let cursor = &self.term.grid().cursor;
            let column = cursor.point.column.0 + usize::from(cursor.input_needs_wrap);
            let text = format!("\x1b[{};{}R", cursor.point.line.0 + 1, column + 1);
            self.answer(&text);
        }
    }

    fn move_forward(&mut self, columns: usize) {
        self.term.move_forward(columns);
    }

    fn move_backward(&mut self, columns: usize) {
        self.term.move_backward(columns);
    }

    fn move_down_and_cr(&mut self, rows: usize) {
        self.term.move_down_and_cr(rows);
    }

    fn move_up_and_cr(&mut self, rows: usize) {
        self.term.move_up_and_cr(rows);
    }

    fn put_tab(&mut self, count: u16) {
        self.term.put_tab(count);
    }

    fn backspace(&mut self) {
        self.term.backspace();
    }

    fn carriage_return(&mut self) {
        self.term.carriage_return();
    }

    fn linefeed(&mut self) {
        // As xterm.js: a line feed in the line feed mode (LNM) also returns
        // the cursor to the first column, and a cursor that waited to wrap
        // stays in the last column. The line that a line feed moves to, and
        // does not scroll, is a line of its own.
        let line = self.term.grid().cursor.point.line.0;
        self.term.linefeed();
        if self.term.mode().contains(TermMode::LINE_FEED_NEW_LINE) {
            self.term.carriage_return();
        }
        let cursor = &mut self.term.grid_mut().cursor;
        cursor.input_needs_wrap = false;
        if cursor.point.line.0 == line + 1 {
            self.set_wraps(line, false);
        }
    }

    fn bell(&mut self) {}

    // xterm.js does nothing for SUB.
    fn substitute(&mut self) {}

    fn newline(&mut self) {
        self.term.newline();
    }

    fn set_horizontal_tabstop(&mut self) {
        self.term.set_horizontal_tabstop();
    }

    fn scroll_up(&mut self, rows: usize) {
        self.term.scroll_up(rows);
    }

    fn scroll_down(&mut self, rows: usize) {
        self.term.scroll_down(rows);
    }

    fn insert_blank_lines(&mut self, rows: usize) {
        self.term.insert_blank_lines(rows);
    }

    fn delete_lines(&mut self, rows: usize) {
        self.term.delete_lines(rows);
    }

    fn erase_chars(&mut self, count: usize) {
        self.in_line(false, |term| term.erase_chars(count));
    }

    fn delete_chars(&mut self, count: usize) {
        self.in_line(false, |term| term.delete_chars(count));
    }

    fn move_backward_tabs(&mut self, count: u16) {
        self.term.move_backward_tabs(count);
    }

    fn move_forward_tabs(&mut self, count: u16) {
        self.term.move_forward_tabs(count);
    }

    fn save_cursor_position(&mut self) {
        self.term.save_cursor_position();
    }

    fn restore_cursor_position(&mut self) {
        self.restore_cursor();
    }

    fn clear_line(&mut self, mode: LineClearMode) {
        let cursor = &self.term.grid().cursor;
        let from_start = match mode {
            LineClearMode::Right => cursor.point.column.0 == 0 && !cursor.input_needs_wrap,
            LineClearMode::Left => false,
            LineClearMode::All => true,
        };
        self.in_line(from_start, |term| term.clear_line(mode));
    }

    fn clear_screen(&mut self, mode: ClearMode) {
        let cursor = &self.term.grid().cursor;
        let from_start = matches!(mode, ClearMode::Below)
            && cursor.point.column.0 == 0
            && !cursor.input_needs_wrap;
        let line = cursor.point.line.0;
        self.term.clear_screen(mode);
        if from_start {
            self.set_wraps(line - 1, false);
        }
    }

    fn clear_tabs(&mut self, mode: TabulationClearMode) {
        self.term.clear_tabs(mode);
    }

    fn set_tabs(&mut self, interval: u16) {
        self.term.set_tabs(interval);
    }

    fn reset_state(&mut self) {
        self.term.reset_state();
        self.region = None;
        self.normal_region = None;
        self.alternate = None;
        self.mouse = MouseProtocol::None;
        self.encoding = MouseEncoding::Default;
        self.reverse_wraparound = false;
        self.cursor_style = None;
        self.synchronized = false;
    }

    fn reverse_index(&mut self) {
        self.term.reverse_index();
    }

    fn terminal_attribute(&mut self, attr: Attr) {
        self.term.terminal_attribute(attr);
    }

    fn set_mode(&mut self, mode: Mode) {
        self.term.set_mode(mode);
    }

    fn unset_mode(&mut self, mode: Mode) {
        self.term.unset_mode(mode);
    }

    // A query: the attached terminal answers it.
    fn report_mode(&mut self, _mode: Mode) {}

    fn set_private_mode(&mut self, mode: PrivateMode) {
        match mode {
            PrivateMode::Named(NamedPrivateMode::SwapScreenAndSetRestoreCursor) => {
                // xterm.js saves the cursor of the active screen, and then
                // enters the alternate screen when it is not active.
                self.term.save_cursor_position();
                self.enter_alternate();
            }
            PrivateMode::Unknown(47 | 1047) => self.enter_alternate(),
            PrivateMode::Unknown(1048) => self.term.save_cursor_position(),
            PrivateMode::Unknown(9) => self.mouse = MouseProtocol::X10,
            PrivateMode::Named(NamedPrivateMode::ReportMouseClicks) => {
                self.mouse = MouseProtocol::Vt200;
                self.term.set_private_mode(mode);
            }
            PrivateMode::Named(NamedPrivateMode::ReportCellMouseMotion) => {
                self.mouse = MouseProtocol::Drag;
                self.term.set_private_mode(mode);
            }
            PrivateMode::Named(NamedPrivateMode::ReportAllMouseMotion) => {
                self.mouse = MouseProtocol::Any;
                self.term.set_private_mode(mode);
            }
            PrivateMode::Named(NamedPrivateMode::SgrMouse) => {
                self.encoding = MouseEncoding::Sgr;
                self.term.set_private_mode(mode);
            }
            PrivateMode::Unknown(1016) => self.encoding = MouseEncoding::SgrPixels,
            PrivateMode::Unknown(45) => self.reverse_wraparound = true,
            PrivateMode::Named(NamedPrivateMode::BlinkingCursor) => self.blink = true,
            PrivateMode::Unknown(66) => self.term.set_keypad_application_mode(),
            PrivateMode::Named(NamedPrivateMode::SyncUpdate) => self.synchronized = true,
            // xterm.js does not change the columns, and so does not clear
            // the screen. It has no UTF-8 mouse mode.
            PrivateMode::Named(NamedPrivateMode::ColumnMode | NamedPrivateMode::Utf8Mouse) => {}
            mode => self.term.set_private_mode(mode),
        }
    }

    fn unset_private_mode(&mut self, mode: PrivateMode) {
        match mode {
            PrivateMode::Named(NamedPrivateMode::SwapScreenAndSetRestoreCursor) => {
                // xterm.js enters the normal screen when it is not active,
                // and then restores its saved cursor.
                self.exit_alternate();
                self.restore_cursor();
            }
            PrivateMode::Unknown(47 | 1047) => {
                // xterm.js moves the cursor of the alternate screen to the
                // normal screen, with the attributes, which it keeps for
                // both screens.
                if let Some(cursor) = self.exit_alternate() {
                    self.term.grid_mut().cursor = cursor;
                }
            }
            PrivateMode::Unknown(1048) => self.restore_cursor(),
            PrivateMode::Unknown(9) => self.mouse = MouseProtocol::None,
            PrivateMode::Named(
                NamedPrivateMode::ReportMouseClicks
                | NamedPrivateMode::ReportCellMouseMotion
                | NamedPrivateMode::ReportAllMouseMotion,
            ) => {
                self.mouse = MouseProtocol::None;
                self.term.unset_private_mode(mode);
            }
            PrivateMode::Named(NamedPrivateMode::SgrMouse) => {
                self.encoding = MouseEncoding::Default;
                self.term.unset_private_mode(mode);
            }
            PrivateMode::Unknown(1016) => self.encoding = MouseEncoding::Default,
            PrivateMode::Unknown(45) => self.reverse_wraparound = false,
            PrivateMode::Named(NamedPrivateMode::BlinkingCursor) => self.blink = false,
            PrivateMode::Unknown(66) => self.term.unset_keypad_application_mode(),
            PrivateMode::Named(NamedPrivateMode::SyncUpdate) => self.synchronized = false,
            PrivateMode::Named(NamedPrivateMode::ColumnMode | NamedPrivateMode::Utf8Mouse) => {}
            mode => self.term.unset_private_mode(mode),
        }
    }

    fn report_private_mode(&mut self, _mode: PrivateMode) {}

    fn set_scrolling_region(&mut self, top: usize, bottom: Option<usize>) {
        // As xterm.js: a bottom below the screen is the last row, and a
        // region without rows changes nothing.
        let rows = self.rows();
        let bottom = bottom.filter(|bottom| *bottom <= rows).unwrap_or(rows);
        if top >= bottom {
            return;
        }
        self.term.set_scrolling_region(top, Some(bottom));
        self.region = (top != 1 || bottom != rows).then_some(top - 1..bottom);
    }

    fn set_keypad_application_mode(&mut self) {
        self.term.set_keypad_application_mode();
    }

    fn unset_keypad_application_mode(&mut self) {
        self.term.unset_keypad_application_mode();
    }

    fn set_active_charset(&mut self, index: CharsetIndex) {
        self.term.set_active_charset(index);
    }

    fn configure_charset(&mut self, index: CharsetIndex, charset: StandardCharset) {
        self.term.configure_charset(index, charset);
    }

    fn set_color(&mut self, index: usize, color: Rgb) {
        self.term.set_color(index, color);
    }

    // A query: the attached terminal answers it.
    fn dynamic_color_sequence(&mut self, _prefix: String, _index: usize, _terminator: &str) {}

    fn reset_color(&mut self, index: usize) {
        self.term.reset_color(index);
    }

    fn clipboard_store(&mut self, _clipboard: u8, _data: &[u8]) {}

    fn clipboard_load(&mut self, _clipboard: u8, _terminator: &str) {}

    fn decaln(&mut self) {
        self.term.decaln();
    }

    // xterm.js keeps no title stack by default (`windowOptions`).
    fn push_title(&mut self) {}

    fn pop_title(&mut self) {}

    fn text_area_size_pixels(&mut self) {}

    fn text_area_size_chars(&mut self) {}

    // Links are not kept (`docs/architecture.md`, Screen state, rule 5).
    fn set_hyperlink(&mut self, _link: Option<Hyperlink>) {}

    fn report_keyboard_mode(&mut self) {}

    fn push_keyboard_mode(&mut self, _mode: KeyboardModes) {}

    fn pop_keyboard_modes(&mut self, _count: u16) {}

    fn set_keyboard_mode(&mut self, _mode: KeyboardModes, _behavior: KeyboardModesApplyBehavior) {}

    fn set_modify_other_keys(&mut self, _mode: ModifyOtherKeys) {}

    fn report_modify_other_keys(&mut self) {}

    fn set_scp(&mut self, _path: ScpCharPath, _update: ScpUpdateMode) {}
}
