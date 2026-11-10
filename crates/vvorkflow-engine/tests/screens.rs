//! The records of `tests/screens/`: output of programs, positions in it, and
//! the screen bytes that the engine makes at each position.
//!
//! The screen bytes MUST be current: `VVORKFLOW_UPDATE_SCREENS=1 cargo test
//! -p vvorkflow-engine --test screens` writes them again. The Vitest test
//! `apps/desktop/tests/screens.test.ts` then measures them with xterm.js
//! (`docs/architecture.md`, Screen state, rule 2). This test also checks the
//! round trip of the engine at each position: a screen that reads the screen
//! bytes, and then the output after the position, has the state of a screen
//! that reads all the output.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Map, Value};
use vvorkflow_engine::screen::Screen;

/// One record, as its file holds it.
struct Record {
    path: PathBuf,
    json: Map<String, Value>,
    columns: u16,
    rows: u16,
    output: Vec<u8>,
    positions: Vec<usize>,
    /// For each position with a known limit (`docs/architecture.md`, Screen
    /// state, rules 3 and 5), the parts of the state that the round trip
    /// does not keep there, such as `title`.
    limits: Map<String, Value>,
}

fn records() -> Vec<Record> {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/screens");
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no records in {}", folder.display());
    paths
        .into_iter()
        .map(|path| {
            let text = std::fs::read_to_string(&path).unwrap();
            let Value::Object(json) = serde_json::from_str(&text).unwrap() else {
                panic!("{} is not an object", path.display());
            };
            let number = |key: &str| json[key].as_u64().unwrap();
            Record {
                columns: u16::try_from(number("columns")).unwrap(),
                rows: u16::try_from(number("rows")).unwrap(),
                output: json["output"].as_str().unwrap().as_bytes().to_vec(),
                positions: json["positions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|position| usize::try_from(position.as_u64().unwrap()).unwrap())
                    .collect(),
                limits: json["limits"].as_object().cloned().unwrap_or_default(),
                json,
                path,
            }
        })
        .collect()
}

#[test]
fn the_screen_bytes_of_the_records_are_current() {
    let update = std::env::var_os("VVORKFLOW_UPDATE_SCREENS").is_some();
    let mut stale = Vec::new();
    for mut record in records() {
        let mut screens = Map::new();
        for &position in &record.positions {
            let mut screen = Screen::new(record.columns, record.rows);
            screen.feed(&record.output[..position]);
            screens.insert(position.to_string(), STANDARD.encode(screen.bytes()).into());
        }
        let screens = Value::Object(screens);
        if record.json.get("screens") != Some(&screens) {
            if update {
                record.json.insert("screens".to_owned(), screens);
                let text = serde_json::to_string_pretty(&record.json).unwrap() + "\n";
                std::fs::write(&record.path, text).unwrap();
            } else {
                stale.push(record.path.display().to_string());
            }
        }
    }
    assert!(
        stale.is_empty(),
        "{stale:?} are out of date: run `VVORKFLOW_UPDATE_SCREENS=1 cargo test -p vvorkflow-engine --test screens`"
    );
}

#[test]
fn the_screen_bytes_of_the_records_draw_the_same_state() {
    for record in records() {
        let mut whole = Screen::new(record.columns, record.rows);
        whole.feed(&record.output);
        let expected = whole.describe();
        for &position in &record.positions {
            let mut before = Screen::new(record.columns, record.rows);
            before.feed(&record.output[..position]);
            let bytes = before.bytes();
            let mut copy = Screen::new(record.columns, record.rows);
            copy.feed(&bytes);
            assert_eq!(
                copy.describe(),
                before.describe(),
                "{} at {position}: the screen bytes draw another state",
                record.path.display()
            );
            copy.feed(&record.output[position..]);
            let limits = record.limits.get(&position.to_string());
            let without = |text: String| -> String {
                text.lines()
                    .filter(|line| {
                        limits.and_then(Value::as_array).is_none_or(|parts| {
                            !parts.iter().any(|part| {
                                part.as_str().is_some_and(|part| line.starts_with(part))
                            })
                        })
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            assert_eq!(
                without(copy.describe()),
                without(expected.clone()),
                "{} at {position}: the output after the screen gives another state",
                record.path.display()
            );
        }
    }
}
