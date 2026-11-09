//! The git command line: the engine runs git and reads its porcelain output,
//! which git keeps stable for scripts.

use std::path::{Path, PathBuf};
use std::process::Command;

use vvorkflow_protocol::{ChangedPath, EngineError, ErrorCode, GitStatus};

fn git(directory: &Path, arguments: &[&str]) -> Result<Vec<u8>, EngineError> {
    run(
        Command::new("git").arg("-C").arg(directory).args(arguments),
        arguments,
    )
}

fn run(command: &mut Command, arguments: &[&str]) -> Result<Vec<u8>, EngineError> {
    let output = command.output().map_err(|error| EngineError {
        code: ErrorCode::FailedPrecondition,
        message: format!("The engine cannot run git: {error}"),
    })?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(EngineError {
            code: ErrorCode::FailedPrecondition,
            message: format!(
                "git {} failed: {}",
                arguments.join(" "),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        })
    }
}

/// The path in one line of git output, without the newline at its end. A
/// path can end with a space, so nothing else is cut.
fn line_path(output: &[u8]) -> PathBuf {
    let text = String::from_utf8_lossy(output);
    PathBuf::from(text.strip_suffix('\n').unwrap_or(&text))
}

/// The root of the worktree that holds `folder`, or None when the folder is
/// not in a git worktree or git is missing.
pub fn toplevel(folder: &Path) -> Option<PathBuf> {
    let output = git(folder, &["rev-parse", "--show-toplevel"]).ok()?;
    line_path(&output).canonicalize().ok()
}

/// The git directory of a worktree: `.git` of the main worktree, or the
/// folder of a linked worktree in it.
pub fn git_dir(worktree: &Path) -> Result<PathBuf, EngineError> {
    let output = git(worktree, &["rev-parse", "--absolute-git-dir"])?;
    Ok(line_path(&output))
}

/// The worktrees of the repository of `top`, the main worktree first, each
/// with its branch. A bare repository has no files, so it is left out.
pub fn worktrees(top: &Path) -> Result<Vec<(PathBuf, Option<String>)>, EngineError> {
    let output = git(top, &["worktree", "list", "--porcelain", "-z"])?;
    let mut list = Vec::new();
    let mut path: Option<PathBuf> = None;
    let mut branch = None;
    let mut bare = false;
    for field in output.split(|byte| *byte == 0) {
        let field = String::from_utf8_lossy(field);
        if field.is_empty() {
            // An empty field ends a worktree.
            if let Some(path) = path.take().filter(|_| !bare) {
                list.push((path.canonicalize().unwrap_or(path), branch.take()));
            }
            branch = None;
            bare = false;
        } else if let Some(value) = field.strip_prefix("worktree ") {
            path = Some(PathBuf::from(value));
        } else if let Some(value) = field.strip_prefix("branch ") {
            branch = Some(value.trim_start_matches("refs/heads/").to_owned());
        } else if field == "bare" {
            bare = true;
        }
    }
    Ok(list)
}

/// The changed, untracked, conflicted, and ignored paths of a worktree. Git
/// runs with the git directory and the worktree of the opened folder, so it
/// does not look for a repository on its own.
pub fn status(git_dir: &Path, worktree: &Path) -> Result<Vec<ChangedPath>, EngineError> {
    let arguments = [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=normal",
        "--ignored=matching",
    ];
    let output = run(
        Command::new("git")
            .arg("--git-dir")
            .arg(git_dir)
            .arg("--work-tree")
            .arg(worktree)
            .arg("-C")
            .arg(worktree)
            .args(arguments),
        &arguments,
    )?;
    let mut list = Vec::new();
    let mut fields = output.split(|byte| *byte == 0);
    while let Some(field) = fields.next() {
        let field = String::from_utf8_lossy(field);
        let mut parts = field.splitn(2, ' ');
        let (Some(kind), Some(rest)) = (parts.next(), parts.next()) else {
            continue;
        };
        let (status, path) = match kind {
            // 1 XY sub mH mI mW hH hI path
            "1" => (changed(rest), rest.splitn(8, ' ').nth(7)),
            // 2 XY sub mH mI mW hH hI Xscore path, then the original path
            "2" => {
                fields.next();
                (changed(rest), rest.splitn(9, ' ').nth(8))
            }
            // u XY sub m1 m2 m3 mW h1 h2 h3 path
            "u" => (GitStatus::Conflict, rest.splitn(10, ' ').nth(9)),
            "?" => (GitStatus::Untracked, Some(rest)),
            "!" => (GitStatus::Ignored, Some(rest)),
            _ => continue,
        };
        if let Some(path) = path {
            list.push(ChangedPath {
                path: path.to_owned(),
                status,
            });
        }
    }
    Ok(list)
}

/// The status of an ordinary or a renamed entry, from its XY field: the index
/// and the worktree. A new file in the index is added, a deletion on either
/// side is deleted, and the other changes are modified.
fn changed(rest: &str) -> GitStatus {
    let xy = rest.get(..2).unwrap_or("..");
    if xy.starts_with('A') {
        GitStatus::Added
    } else if xy.contains('D') {
        GitStatus::Deleted
    } else {
        GitStatus::Modified
    }
}
