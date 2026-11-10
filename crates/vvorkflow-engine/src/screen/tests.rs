//! The round trip of the engine: a screen that reads the screen bytes of a
//! position, and then the output after it, MUST have the same state as a
//! screen that reads all the output.

use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line};

use super::*;

/// Checks the round trip at each position of `output`, and returns the
/// screen bytes at the end.
fn round_trip(columns: u16, rows: u16, output: &[u8], positions: impl IntoIterator<Item = usize>) {
    let mut whole = Screen::new(columns, rows);
    whole.feed(output);
    let expected = whole.describe();
    for position in positions {
        let mut before = Screen::new(columns, rows);
        before.feed(&output[..position]);
        let bytes = before.bytes();
        let mut copy = Screen::new(columns, rows);
        copy.feed(&bytes);
        assert_eq!(
            copy.describe(),
            before.describe(),
            "the screen bytes at {position} draw another state: {:?}",
            String::from_utf8_lossy(&bytes)
        );
        copy.feed(&output[position..]);
        assert_eq!(
            copy.describe(),
            expected,
            "the output after the screen at {position} gives another state: {:?}",
            String::from_utf8_lossy(&bytes)
        );
    }
}

fn each_position(output: &[u8]) -> std::ops::RangeInclusive<usize> {
    0..=output.len()
}

#[test]
fn colors_and_styles() {
    let output = "plain \x1b[1mbold\x1b[22m \x1b[2mdim\x1b[0m \x1b[3;4mitalic underline\x1b[0m\r\n\
        \x1b[4:3;58;2;255;0;0mcurly\x1b[4:2;58;5;33mdouble\x1b[59;4:4mdotted\x1b[4:5mdashed\x1b[24m\r\n\
        \x1b[7minverse\x1b[27m \x1b[8mhidden\x1b[28m \x1b[9mstrike\x1b[29m\r\n\
        \x1b[31mred\x1b[92mbright\x1b[38;5;208m256\x1b[38;2;10;20;30mrgb\x1b[39m\r\n\
        \x1b[41mbg\x1b[103mbright\x1b[48;5;17m256\x1b[48;2;1;2;3mrgb\x1b[K\x1b[0m\r\n\
        \x1b[44m\x1b[2K\x1b[0mafter a blue line\r\n\x1b[1;31;44mnext";
    round_trip(40, 8, output.as_bytes(), each_position(output.as_bytes()));
}

#[test]
fn wide_and_combining_characters() {
    let output = "wide 日本語 e\u{301} 👍 x\u{300}\u{301}\u{302}\r\n0123456789日本\r\nabcdefghi日x";
    round_trip(10, 5, output.as_bytes(), each_position(output.as_bytes()));
}

#[test]
fn lines_that_wrap_and_the_scrollback() {
    let mut output = String::new();
    for line in 0..12 {
        output.push_str(&format!("\x1b[3{}mline {line} ", line % 8));
        output.push_str(&"x".repeat(line * 3));
        output.push_str("\x1b[0m\r\n");
    }
    output.push_str("0123456789012345678901234");
    round_trip(12, 4, output.as_bytes(), each_position(output.as_bytes()));
}

#[test]
fn the_alternate_screen_and_the_normal_screen_under_it() {
    let output = "normal 1\r\nnormal 2\r\n\x1b[31mred\x1b7\x1b[0m\x1b[?1049h\x1b[2Jalt\x1b[3;3Hthree\x1b7\x1b[H\x1b[1mtop\
        \x1b[?1049lback\x1b[?1047hplain\x1b[?1047lafter\x1b[?47hold\x1b[?47l\x1b8end";
    round_trip(20, 5, output.as_bytes(), each_position(output.as_bytes()));
}

/// A resize changes both screens, the lines that wrap, the cursor, and the
/// saved cursor: the screen bytes after it draw that state, at each
/// position of the output after it.
#[test]
fn a_resize_on_the_normal_and_the_alternate_screen() {
    let mut lines = String::new();
    for line in 0..8 {
        lines.push_str(&format!("\x1b[3{}mline {line} ", line % 8));
        lines.push_str(&"x".repeat(line * 3));
        lines.push_str("\x1b[0m\r\n");
    }
    let normal = format!("{lines}wide 日本 e\u{301}\x1b7\x1b[2;3H");
    let alternate = format!("{normal}\x1b[?1049h\x1b[2Jalt\x1b[3;3H\x1b[44mthree\x1b[0m");
    let cases = [
        (normal.as_str(), "after\r\nmore \x1b8saved"),
        (
            alternate.as_str(),
            "more\x1b[?1049lback\r\nnormal again \x1b8saved",
        ),
    ];
    for (before, after) in cases {
        for (columns, rows) in [(30, 8), (8, 3), (12, 5)] {
            let start = || {
                let mut screen = Screen::new(12, 4);
                screen.feed(before.as_bytes());
                screen.resize(columns, rows);
                screen
            };
            let mut whole = start();
            whole.feed(after.as_bytes());
            let expected = whole.describe();
            for position in each_position(after.as_bytes()) {
                let mut screen = start();
                screen.feed(&after.as_bytes()[..position]);
                let bytes = screen.bytes();
                let mut copy = Screen::new(columns, rows);
                copy.feed(&bytes);
                assert_eq!(
                    copy.describe(),
                    screen.describe(),
                    "{columns}x{rows}, at {position}: {:?}",
                    String::from_utf8_lossy(&bytes)
                );
                copy.feed(&after.as_bytes()[position..]);
                assert_eq!(copy.describe(), expected, "{columns}x{rows}, at {position}");
            }
        }
    }
}

#[test]
fn a_scroll_region_and_the_origin_mode() {
    let output = "1\r\n2\r\n3\r\n4\r\n5\r\n6\x1b[2;4r\x1b[4Hx\r\ny\r\nz\r\n\x1b[?6h\x1b[1;1Ho\x1b[2;2Hp\
        \x1b[?1049h\x1b[1;2rq\r\nr\x1b[?1049l\r\nback\x1b[?6l\x1b[r";
    round_trip(10, 6, output.as_bytes(), each_position(output.as_bytes()));
}

#[test]
fn the_modes_the_title_and_the_colors() {
    let output = "\x1b[?1h\x1b=\x1b[?2004h\x1b[?1002h\x1b[?1006h\x1b[?1004h\x1b[?25l\x1b[4h\x1b[5 q\
        \x1b]2;a title\x07\x1b]4;1;rgb:12/34/56\x1b\\\x1b]11;rgb:01/02/03\x07ins\x1b[1D\x1b[?2026hsync\
        \x1b[?9h\x1b[?1016h\x1b[?45h\x1b[?7lnowrap\x1b[?2026l\x1b[?1000l\x1b[?1006l\x1b[?25h";
    round_trip(20, 4, output.as_bytes(), each_position(output.as_bytes()));
}

#[test]
fn a_long_osc_string() {
    let mut output = b"before \x1b]2;".to_vec();
    output.extend(std::iter::repeat_n(b'x', MAX_PART + 500));
    output.extend_from_slice(b"\x07after \x1b]0;short\x1b\\end");
    let positions = [
        10,
        100,
        MAX_PART,
        MAX_PART + 100,
        output.len() - 20,
        output.len(),
    ];
    round_trip(20, 4, &output, positions);
}

#[test]
fn the_scrollback_keeps_at_most_5000_lines() {
    let mut screen = Screen::new(20, 24);
    for line in 0..6_000 {
        screen.feed(format!("line {line}\r\n").as_bytes());
    }
    let grid = screen.terminal.term.grid();
    assert_eq!(grid.history_size(), SCROLLBACK);
    // The screen holds the last 23 lines and the empty line of the cursor.
    let oldest = &grid[Line(-(SCROLLBACK as i32))];
    let text: String = (0..20).map(|column| oldest[Column(column)].c).collect();
    assert_eq!(text.trim_end(), format!("line {}", 6_000 - 23 - SCROLLBACK));
}

#[test]
fn a_cell_keeps_at_most_32_bytes_of_text() {
    let mut screen = Screen::new(10, 2);
    // Each combining character U+0301 has 2 bytes.
    let marks = "\u{301}".repeat(100);
    screen.feed(format!("e{marks}x").as_bytes());
    let row = &screen.terminal.term.grid()[Line(0)];
    assert_eq!(terminal::cell_text_len(&row[Column(0)]), 31);
    assert_eq!(row[Column(1)].c, 'x');
}

#[test]
fn a_title_keeps_at_most_1024_bytes() {
    let mut screen = Screen::new(10, 2);
    // A character of 3 bytes does not fit at the end, and a control is not
    // text.
    let title = format!("{}€€\u{9c}", "t".repeat(MAX_TITLE - 4));
    screen.feed(format!("\x1b]2;{title}\x07").as_bytes());
    assert_eq!(
        screen.title(),
        Some(format!("{}€", "t".repeat(MAX_TITLE - 4)).as_str())
    );
    screen.feed(b"\x1b]0;short\x1b\\");
    assert_eq!(screen.title(), Some("short"));
}

#[test]
fn the_screen_answers_the_cursor_position_and_the_device_attributes() {
    let mut screen = Screen::new(10, 4);
    screen.feed(b"ab\x1b[6n\x1b[c\x1b[>c\x1b[5n\x1b]11;?\x07\x1b[?2004$p");
    assert_eq!(
        screen.take_answers(),
        b"\x1b[1;3R\x1b[?1;2c\x1b[>0;276;0c".to_vec()
    );
    // While a client is attached, its terminal answers.
    screen.answer_queries(false);
    screen.feed(b"\x1b[6n\x1b[c");
    assert_eq!(screen.take_answers(), Vec::<u8>::new());
}

/// The largest state: both screens of the largest size, each cell with 32
/// bytes of text and each style, and a scrollback that does not fit. The
/// screen bytes keep both screens and the newest lines of the scrollback,
/// in 32 MiB (`docs/architecture.md`, Screen state, rule 4).
#[test]
fn the_largest_state_fits_in_a_screen_frame() {
    use vvorkflow_protocol::{MAX_COLUMNS, MAX_ROWS, MAX_SCREEN};
    let columns = usize::from(MAX_COLUMNS);
    let rows = usize::from(MAX_ROWS);
    // 'e' and 15 combining characters of 2 bytes: 31 bytes, and the next
    // mark does not fit.
    let text = format!("e{}", "\u{301}".repeat(16));
    let cell = |index: usize| {
        let [r, g, b] = [
            (index % 256) as u8,
            (index / 256 % 256) as u8,
            255 - (index % 256) as u8,
        ];
        format!("\x1b[0;1;2;3;4:5;7;8;9;38;2;{r};{g};{b};48;2;{g};{b};{r};58;2;{b};{r};{g}m{text}")
    };
    let line =
        |offset: usize| -> String { (0..columns).map(|column| cell(offset + column)).collect() };
    let mut screen = Screen::new(MAX_COLUMNS, MAX_ROWS);
    // About 50 KiB for each line: the screens take 20 MiB, and the 400 lines
    // of the scrollback do not fit in the rest.
    for number in 0..(400 + rows) {
        screen.feed(line(number).as_bytes());
    }
    screen.feed(b"\x1b[?1049h");
    for number in 0..rows {
        screen.feed(line(number * 7).as_bytes());
    }
    let bytes = screen.bytes();
    assert!(bytes.len() <= MAX_SCREEN, "{} bytes", bytes.len());

    let mut copy = Screen::new(MAX_COLUMNS, MAX_ROWS);
    copy.feed(&bytes);
    let kept = encode::with_normal_grid(&mut copy.terminal.term, |grid| grid.history_size());
    assert!(kept > 0 && kept < 400, "{kept} lines of the scrollback");
    // Both screens, and the newest lines of the scrollback, are the same.
    let original = screen.describe();
    let restored = copy.describe();
    let keep = |text: &str| -> Vec<String> {
        text.lines()
            .filter(|line| {
                let number = line.trim_start().split(['+', ' ']).next().unwrap_or("");
                number
                    .parse::<i64>()
                    .map_or(true, |number| number >= -(kept as i64))
            })
            .map(str::to_owned)
            .collect()
    };
    assert_eq!(keep(&restored), keep(&original));
}
