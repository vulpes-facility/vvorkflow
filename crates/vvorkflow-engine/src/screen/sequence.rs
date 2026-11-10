//! The part of the output that the parser did not finish: the bytes of an
//! escape sequence since the parser left its ground state, or the first
//! bytes of a character that is not complete.
//!
//! [`Sequence`] follows the states of the parser of `vte`, byte by byte, so
//! that the screen bytes can end with that part, and the next output
//! continues it in the terminal of a client (`docs/architecture.md`, Screen
//! state, rule 3). It keeps only bytes that did not change the state yet: a
//! control that the parser does in the middle of a sequence, such as a line
//! feed, is in the state already, so the part leaves it out.

use std::str;

/// The largest part that the engine keeps, in bytes.
pub const MAX_PART: usize = 4 * 1024;

const ESC: u8 = 0x1b;

/// The states of the parser of `vte`, which follows the parser of DEC.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Ground,
    Escape,
    EscapeIntermediate,
    CsiEntry,
    CsiParam,
    CsiIntermediate,
    CsiIgnore,
    DcsEntry,
    DcsParam,
    DcsIntermediate,
    DcsPassthrough,
    DcsIgnore,
    OscString,
    SosPmApcString,
}

/// What a byte does to the part.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Effect {
    /// The parser keeps the byte for later: it goes in the part.
    Keep,
    /// The parser does the byte at once, or ignores it.
    Done,
}

/// What the terminal does with the bytes that [`Sequence::feed`] gives to
/// the parser.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Run {
    /// The bytes as the output has them.
    Plain,
    /// The final byte of a REP (CSI b), right after a printed character:
    /// as in xterm.js, it repeats the text of the cell of that character,
    /// with its combining characters.
    Repeat,
    /// The final byte of a REP that xterm.js ignores, because no character
    /// comes right before it: it prints nothing. `vte` repeats the last
    /// character that it printed also after a control or a sequence.
    Silent,
}

/// The part of the output that the parser did not finish.
pub(crate) struct Sequence {
    state: State,
    /// The bytes since the parser left its ground state, or, in the ground
    /// state, the start of a character that the parser did not get yet.
    part: Vec<u8>,
    /// The part had more than [`MAX_PART`] bytes: it now holds only the
    /// start of its kind of sequence.
    long: bool,
    /// The last action that the parser finished printed a character.
    /// xterm.js then joins a combining character at the start of the next
    /// output with it, and REP repeats it; after a control or a sequence
    /// that ended, it does not. A sequence that did not end yet changes
    /// nothing.
    printed: bool,
}

impl Sequence {
    pub(crate) fn new() -> Sequence {
        Sequence {
            state: State::Ground,
            part: Vec::new(),
            long: false,
            printed: false,
        }
    }

    /// Whether the last action that the parser finished printed a
    /// character.
    pub(crate) fn printed(&self) -> bool {
        self.printed
    }

    /// The bytes that the screen bytes end with, so that the next output
    /// continues them.
    pub(crate) fn part(&self) -> &[u8] {
        &self.part
    }

    /// Follows `output`, and gives the bytes that the parser reads, in
    /// order, to `parse`, with what the terminal does with them ([`Run`]).
    ///
    /// The parser gets each byte, with two exceptions. The start of a
    /// character at the end of `output` waits for the next output, so that
    /// the parser never holds a part of a character itself. The text of an
    /// OSC string after [`MAX_PART`] bytes does not go to the parser, which
    /// would keep all of it in memory; the parser then reads the string as
    /// its first [`MAX_PART`] bytes.
    pub(crate) fn feed(&mut self, output: &[u8], parse: impl FnMut(&[u8], Run)) {
        if self.state == State::Ground && !self.part.is_empty() {
            // The start of a character, and the output that continues it.
            let mut joined = std::mem::take(&mut self.part);
            joined.extend_from_slice(output);
            self.follow(&joined, parse);
        } else {
            self.follow(output, parse);
        }
    }

    fn follow(&mut self, output: &[u8], mut parse: impl FnMut(&[u8], Run)) {
        // The start of the bytes that go to the parser next.
        let mut run = 0;
        let mut index = 0;
        while index < output.len() {
            if self.state == State::Ground {
                // Only ESC leaves the ground state.
                match memchr(ESC, &output[index..]) {
                    Some(offset) => {
                        // A sequence starts: the parser does it after the
                        // text.
                        if let Some(printed) = printed_last(&output[index..index + offset]) {
                            self.printed = printed;
                        }
                        index += offset;
                    }
                    None => {
                        let held = incomplete_character(&output[index..]);
                        let end = output.len() - held;
                        if let Some(printed) = printed_last(&output[index..end]) {
                            self.printed = printed;
                        }
                        parse(&output[run..end], Run::Plain);
                        self.part.extend_from_slice(&output[end..]);
                        return;
                    }
                }
            }
            let byte = output[index];
            if self.state == State::OscString && self.long && osc_text(byte) {
                // The parser keeps an OSC string without a limit: it does not
                // get more than its first part.
                parse(&output[run..index], Run::Plain);
                run = index + 1;
            } else {
                if byte == b'b' && matches!(self.state, State::CsiEntry | State::CsiParam) {
                    parse(&output[run..index], Run::Plain);
                    let repeat = if self.printed {
                        Run::Repeat
                    } else {
                        Run::Silent
                    };
                    parse(&output[index..=index], repeat);
                    run = index + 1;
                }
                self.step(byte);
            }
            index += 1;
        }
        parse(&output[run..], Run::Plain);
    }

    /// Follows one byte outside the ground state, or the ESC that leaves it.
    fn step(&mut self, byte: u8) {
        let executes = matches!(byte, 0x00..=0x17 | 0x19 | 0x1c..=0x1f)
            && matches!(
                self.state,
                State::Escape
                    | State::EscapeIntermediate
                    | State::CsiEntry
                    | State::CsiParam
                    | State::CsiIntermediate
                    | State::CsiIgnore
            );
        if executes {
            // The parser does a control in the middle of an escape or a CSI
            // sequence.
            self.printed = false;
        }
        let (next, effect) = transition(self.state, byte);
        if next == State::Ground {
            // The sequence ended, or a control cancelled it.
            self.printed = false;
            self.state = State::Ground;
            self.part.clear();
            self.long = false;
            return;
        }
        // An ESC starts a new sequence in each state.
        if byte == ESC {
            self.state = State::Escape;
            self.part.clear();
            self.part.push(ESC);
            self.long = false;
            return;
        }
        self.state = next;
        if effect == Effect::Done || self.long {
            return;
        }
        if self.part.len() < MAX_PART {
            self.part.push(byte);
        } else {
            // A longer part keeps the start of its kind of sequence, so that
            // the terminal reads the rest as that kind, for example the rest
            // of an OSC string as a string and not as text.
            self.long = true;
            let kind = match self.part.get(1) {
                Some(b'[' | b']' | b'P' | b'X' | b'^' | b'_') => 2,
                _ => 1,
            };
            self.part.truncate(kind);
        }
    }
}

/// Whether the last character of a text in the ground state is printed, or
/// is a control. DEL does nothing, so the character before it counts. None
/// for a text without a character that counts.
fn printed_last(text: &[u8]) -> Option<bool> {
    let mut end = text.len();
    while end > 0 {
        let mut start = end - 1;
        while start > 0 && end - start < 4 && text[start] & 0xc0 == 0x80 {
            start -= 1;
        }
        let last = &text[start..end];
        match str::from_utf8(last) {
            Ok(character) => {
                let character = character.chars().next_back()?;
                if character == '\x7f' {
                    end = start;
                    continue;
                }
                return Some(!character.is_control());
            }
            // The parser does a byte up to 0x9f that is not UTF-8 as a C1
            // control, and prints a replacement character for the others.
            Err(_) => return Some(!(last.len() == 1 && (0x80..=0x9f).contains(&last[0]))),
        }
    }
    None
}

/// Whether the parser keeps this byte as text of an OSC string.
fn osc_text(byte: u8) -> bool {
    !matches!(byte, 0x00..=0x1f)
}

/// The next state of the parser of `vte` after `byte`, and whether the
/// parser keeps the byte for later. `byte` is never read in the ground state,
/// except ESC.
fn transition(state: State, byte: u8) -> (State, Effect) {
    use Effect::{Done, Keep};
    use State::*;
    // The controls that the parser does in the middle of a sequence.
    let control = matches!(byte, 0x00..=0x17 | 0x19 | 0x1c..=0x1f);
    // The transitions from each state, as `vte::Parser::anywhere`.
    let anywhere = |state| match byte {
        0x18 | 0x1a => (Ground, Done),
        ESC => (Escape, Keep),
        _ => (state, Done),
    };
    match state {
        Ground => anywhere(Ground),
        Escape => match byte {
            _ if control => (Escape, Done),
            0x20..=0x2f => (EscapeIntermediate, Keep),
            b'P' => (DcsEntry, Keep),
            b'X' | b'^' | b'_' => (SosPmApcString, Keep),
            b'[' => (CsiEntry, Keep),
            b']' => (OscString, Keep),
            0x30..=0x7e => (Ground, Done),
            0x18 | 0x1a => (Ground, Done),
            ESC => (Escape, Keep),
            _ => (Escape, Done),
        },
        EscapeIntermediate => match byte {
            _ if control => (state, Done),
            0x20..=0x2f => (state, Keep),
            0x30..=0x7e => (Ground, Done),
            0x7f => (state, Done),
            _ => anywhere(state),
        },
        CsiEntry => match byte {
            _ if control => (state, Done),
            0x20..=0x2f => (CsiIntermediate, Keep),
            0x30..=0x3f => (CsiParam, Keep),
            0x40..=0x7e => (Ground, Done),
            _ => anywhere(state),
        },
        CsiParam => match byte {
            _ if control => (state, Done),
            0x20..=0x2f => (CsiIntermediate, Keep),
            0x30..=0x3b => (state, Keep),
            0x3c..=0x3f => (CsiIgnore, Keep),
            0x40..=0x7e => (Ground, Done),
            0x7f => (state, Done),
            _ => anywhere(state),
        },
        CsiIntermediate => match byte {
            _ if control => (state, Done),
            0x20..=0x2f => (state, Keep),
            0x30..=0x3f => (CsiIgnore, Keep),
            0x40..=0x7e => (Ground, Done),
            _ => anywhere(state),
        },
        CsiIgnore => match byte {
            _ if control => (state, Done),
            0x20..=0x3f => (state, Keep),
            0x40..=0x7e => (Ground, Done),
            0x7f => (state, Done),
            _ => anywhere(state),
        },
        DcsEntry => match byte {
            _ if control => (state, Done),
            0x20..=0x2f => (DcsIntermediate, Keep),
            0x30..=0x3f => (DcsParam, Keep),
            0x40..=0x7e => (DcsPassthrough, Keep),
            0x7f => (state, Done),
            _ => anywhere(state),
        },
        DcsParam => match byte {
            _ if control => (state, Done),
            0x20..=0x2f => (DcsIntermediate, Keep),
            0x30..=0x3b => (state, Keep),
            0x3c..=0x3f => (DcsIgnore, Keep),
            0x40..=0x7e => (DcsPassthrough, Keep),
            0x7f => (state, Done),
            _ => anywhere(state),
        },
        DcsIntermediate => match byte {
            _ if control => (state, Done),
            0x20..=0x2f => (state, Keep),
            0x30..=0x3f => (DcsIgnore, Keep),
            0x40..=0x7e => (DcsPassthrough, Keep),
            0x7f => (state, Done),
            _ => anywhere(state),
        },
        DcsPassthrough => match byte {
            0x18 | 0x1a => (Ground, Done),
            ESC => (Escape, Keep),
            0x00..=0x7e => (state, Keep),
            0x9c => (Ground, Done),
            _ => (state, Done),
        },
        OscString => match byte {
            0x07 | 0x18 | 0x1a => (Ground, Done),
            ESC => (Escape, Keep),
            0x00..=0x1f => (state, Done),
            _ => (state, Keep),
        },
        DcsIgnore | SosPmApcString => anywhere(state),
    }
}

/// The bytes at the end of `text` that start a character and do not finish
/// it, as `str::from_utf8` finds them: at most 3.
fn incomplete_character(text: &[u8]) -> usize {
    for back in 1..=text.len().min(3) {
        let byte = text[text.len() - back];
        if byte < 0x80 {
            return 0;
        }
        // A byte that starts a character of more than one byte.
        if byte >= 0xc0 {
            let tail = &text[text.len() - back..];
            return match str::from_utf8(tail) {
                Err(error) if error.valid_up_to() == 0 && error.error_len().is_none() => tail.len(),
                _ => 0,
            };
        }
    }
    0
}

fn memchr(needle: u8, haystack: &[u8]) -> Option<usize> {
    haystack.iter().position(|&byte| byte == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bytes that go to the parser, and the part after them.
    fn follow(chunks: &[&[u8]]) -> (Vec<u8>, Vec<u8>) {
        let mut sequence = Sequence::new();
        let mut parsed = Vec::new();
        for chunk in chunks {
            sequence.feed(chunk, |bytes, _| parsed.extend_from_slice(bytes));
        }
        (parsed, sequence.part().to_vec())
    }

    #[test]
    fn text_and_finished_sequences_leave_no_part() {
        let output = b"plain \x1b[1;31mred\x1b[0m \x1b]2;title\x07 \x1bPq#0\x1b\\ \xe2\x94\x80";
        let (parsed, part) = follow(&[output]);
        assert_eq!(parsed, output);
        assert_eq!(part, b"");
    }

    #[test]
    fn a_sequence_that_is_not_finished_is_the_part() {
        assert_eq!(follow(&[b"a\x1b[1;3"]).1, b"\x1b[1;3");
        assert_eq!(follow(&[b"a\x1b]2;ti"]).1, b"\x1b]2;ti");
        assert_eq!(follow(&[b"\x1b[1", b";2"]).1, b"\x1b[1;2");
        assert_eq!(follow(&[b"\x1b(", b""]).1, b"\x1b(");
        // A line feed in the middle of a sequence is done at once.
        assert_eq!(follow(&[b"\x1b[1\n;2"]).1, b"\x1b[1;2");
        // A new ESC starts a new sequence.
        assert_eq!(follow(&[b"\x1b]2;a\x1b[3"]).1, b"\x1b[3");
        // CAN ends a sequence.
        assert_eq!(follow(&[b"\x1b[1\x18"]).1, b"");
    }

    #[test]
    fn the_start_of_a_character_waits_for_the_next_output() {
        let (parsed, part) = follow(&[b"a\xe2\x94"]);
        assert_eq!(
            (parsed.as_slice(), part.as_slice()),
            (&b"a"[..], &b"\xe2\x94"[..])
        );
        let (parsed, part) = follow(&[b"a\xe2", b"\x94", b"\x80b"]);
        assert_eq!(
            (parsed.as_slice(), part.as_slice()),
            (&b"a\xe2\x94\x80b"[..], &b""[..])
        );
        let (parsed, part) = follow(&[b"\xc3\xa9\xe2"]);
        assert_eq!(
            (parsed.as_slice(), part.as_slice()),
            (&b"\xc3\xa9"[..], &b"\xe2"[..])
        );
        let (parsed, part) = follow(&[b"\xf0", b"\x9f", b"\x98"]);
        assert_eq!(
            (parsed.as_slice(), part.as_slice()),
            (&b""[..], &b"\xf0\x9f\x98"[..])
        );
        let (parsed, part) = follow(&[b"\xf0", b"\x9f", b"\x98\x80"]);
        assert_eq!(
            (parsed.as_slice(), part.as_slice()),
            (&b"\xf0\x9f\x98\x80"[..], &b""[..])
        );
        // A byte that cannot start a character goes to the parser.
        assert_eq!(follow(&[b"a\xff"]), (b"a\xff".to_vec(), Vec::new()));
        assert_eq!(follow(&[b"a\xe2\x41"]), (b"a\xe2\x41".to_vec(), Vec::new()));
    }

    #[test]
    fn a_printed_character_is_the_last_action_until_a_control() {
        let printed = |chunks: &[&[u8]]| {
            let mut sequence = Sequence::new();
            for chunk in chunks {
                sequence.feed(chunk, |_, _| {});
            }
            sequence.printed()
        };
        assert!(printed(&[b"text"]));
        assert!(printed(&[b"\x1b[1mtext", b""]));
        assert!(printed(&[b"\xc3\xa9"]));
        assert!(printed(&[b"e\x7f"]));
        assert!(!printed(&[b"text\r\n"]));
        assert!(!printed(&[b"text\x1b[1m"]));
        // A sequence counts when it ends: a REP that ends it repeats the
        // character.
        assert!(printed(&[b"text\x1b[1"]));
        assert!(printed(&[b"text\x1b"]));
        assert!(!printed(&[b"text\x1b[\x08"]));
        assert!(printed(&[b"text\x1b]2;\x08"]));
        assert!(!printed(&[b""]));
        // The start of a character does not count until it is complete.
        assert!(!printed(&[b"\r\xc3"]));
        assert!(printed(&[b"\r\xc3", b"\xa9"]));
    }

    #[test]
    fn a_long_string_keeps_only_its_kind() {
        let mut title = b"\x1b]2;".to_vec();
        title.resize(MAX_PART + 100, b'x');
        let (parsed, part) = follow(&[&title]);
        assert_eq!(part, b"\x1b]");
        // The parser gets only the first part of the string, and its end.
        assert_eq!(parsed.len(), MAX_PART + 1);
        let (parsed, part) = follow(&[&title, b"x\x07after"]);
        assert_eq!(part, b"");
        assert!(parsed.ends_with(b"\x07after"));
        assert_eq!(parsed.len(), MAX_PART + 1 + b"\x07after".len());

        let mut csi = b"\x1b[".to_vec();
        csi.resize(MAX_PART + 1, b'1');
        assert_eq!(follow(&[&csi]).1, b"\x1b[");
        let mut escape = b"\x1b".to_vec();
        escape.resize(MAX_PART + 1, b' ');
        assert_eq!(follow(&[&escape]).1, b"\x1b");
    }
}
