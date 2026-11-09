//! The behavior of the engine on real git repositories in temporary folders.

use std::path::Path;
use std::process::Command;

use vvorkflow_engine::{Engine, projects_root};
use vvorkflow_protocol::{
    ChangedPath, DirectoryEntry, EntryKind, ErrorCode, GitStatus, Hello, ListDirectory,
    ListProjects, OpenFolder, PROTOCOL_VERSION, Project, ReadStatus, Request, Response,
};

/// Runs git in `directory` without the global or system settings of the
/// machine, such as commit signing.
fn git(directory: &Path, arguments: &[&str]) -> bool {
    Command::new("git")
        .current_dir(directory)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .args([
            "-c",
            "user.name=vvorkflow",
            "-c",
            "user.email=vvorkflow@example.com",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(arguments)
        .output()
        .expect("git runs")
        .status
        .success()
}

/// An engine for the tests that open folders, which do not use its projects
/// root.
fn engine() -> Engine {
    Engine::new(&std::env::temp_dir().canonicalize().unwrap()).unwrap()
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn text(path: &Path) -> String {
    path.canonicalize().unwrap().to_string_lossy().into_owned()
}

/// A repository `app` with one commit, and a linked worktree `app.feature` on
/// the branch `feat/x`.
fn repository(base: &Path) -> std::path::PathBuf {
    let main = base.join("app");
    std::fs::create_dir(&main).unwrap();
    assert!(git(&main, &["init", "-q"]));
    write(&main.join("README.md"), "one\n");
    write(&main.join("src/lib.rs"), "fn a() {}\n");
    write(&main.join(".gitignore"), "node_modules/\n");
    assert!(git(&main, &["add", "."]));
    assert!(git(&main, &["commit", "-q", "-m", "first"]));
    let linked = base.join("app.feature");
    assert!(git(
        &main,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feat/x",
            linked.to_str().unwrap()
        ]
    ));
    main
}

#[test]
fn a_repository_opens_with_its_worktrees_and_the_current_one() {
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    let engine = engine();

    let opened = engine
        .open_folder(OpenFolder {
            path: text(&main.join("src")),
        })
        .unwrap();
    assert_eq!(opened.name, "app");
    assert!(opened.git);
    let worktrees: Vec<_> = opened
        .worktrees
        .iter()
        .map(|w| (w.path.clone(), w.branch.clone(), w.current))
        .collect();
    assert_eq!(
        worktrees,
        vec![
            (text(&main), Some("main".to_owned()), true),
            (
                text(&base.path().join("app.feature")),
                Some("feat/x".to_owned()),
                false
            ),
        ]
    );

    let linked = engine
        .open_folder(OpenFolder {
            path: text(&base.path().join("app.feature")),
        })
        .unwrap();
    assert_eq!(linked.name, "app");
    assert_eq!(
        linked
            .worktrees
            .iter()
            .map(|w| w.current)
            .collect::<Vec<_>>(),
        vec![false, true]
    );
}

#[test]
fn a_plain_folder_opens_as_one_worktree_without_git() {
    let base = tempfile::tempdir().unwrap();
    let folder = base.path().join("notes");
    write(&folder.join("a.md"), "a\n");
    let engine = engine();

    let opened = engine
        .open_folder(OpenFolder {
            path: text(&folder),
        })
        .unwrap();
    assert_eq!(opened.name, "notes");
    assert!(!opened.git);
    assert_eq!(opened.worktrees.len(), 1);
    assert!(opened.worktrees[0].current);
    assert_eq!(opened.worktrees[0].branch, None);
    let status = engine
        .read_status(ReadStatus {
            worktree: text(&folder),
        })
        .unwrap();
    assert_eq!(status, vec![]);
}

#[test]
fn open_folder_refuses_a_relative_or_a_missing_path() {
    let engine = engine();
    let relative = engine
        .open_folder(OpenFolder { path: "app".into() })
        .unwrap_err();
    assert_eq!(relative.code, ErrorCode::InvalidArgument);
    let base = tempfile::tempdir().unwrap();
    let missing = engine
        .open_folder(OpenFolder {
            path: base.path().join("missing").to_string_lossy().into_owned(),
        })
        .unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
}

#[test]
fn a_folder_lists_its_folders_first_without_the_git_folder() {
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    write(&main.join("b.txt"), "b\n");
    write(&main.join("Assets/icon.svg"), "<svg/>\n");
    let engine = engine();
    engine
        .open_folder(OpenFolder { path: text(&main) })
        .unwrap();

    let listed = engine
        .list_directory(ListDirectory {
            worktree: text(&main),
            path: String::new(),
        })
        .unwrap();
    let entry = |name: &str, kind| DirectoryEntry {
        name: name.into(),
        kind,
    };
    assert_eq!(
        listed,
        vec![
            entry("Assets", EntryKind::Folder),
            entry("src", EntryKind::Folder),
            entry(".gitignore", EntryKind::File),
            entry("b.txt", EntryKind::File),
            entry("README.md", EntryKind::File),
        ]
    );
    let nested = engine
        .list_directory(ListDirectory {
            worktree: text(&main),
            path: "src".into(),
        })
        .unwrap();
    assert_eq!(nested, vec![entry("lib.rs", EntryKind::File)]);
}

#[test]
fn a_request_cannot_leave_the_open_folders() {
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    let outside = base.path().join("secret");
    write(&outside.join("key"), "k\n");
    let engine = engine();

    let closed = engine
        .list_directory(ListDirectory {
            worktree: text(&main),
            path: String::new(),
        })
        .unwrap_err();
    assert_eq!(closed.code, ErrorCode::PermissionDenied);

    engine
        .open_folder(OpenFolder { path: text(&main) })
        .unwrap();
    let up = engine
        .list_directory(ListDirectory {
            worktree: text(&main),
            path: "../secret".into(),
        })
        .unwrap_err();
    assert_eq!(up.code, ErrorCode::InvalidArgument);
    let status = engine
        .read_status(ReadStatus {
            worktree: text(&outside),
        })
        .unwrap_err();
    assert_eq!(status.code, ErrorCode::PermissionDenied);
}

#[cfg(unix)]
#[test]
fn a_symbolic_link_cannot_lead_a_request_out_of_the_open_folder() {
    use std::os::unix::fs::symlink;
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    let outside = base.path().join("secret");
    write(&outside.join("key"), "k\n");
    symlink(&outside, main.join("link")).unwrap();
    let engine = engine();
    engine
        .open_folder(OpenFolder { path: text(&main) })
        .unwrap();

    let linked = engine
        .list_directory(ListDirectory {
            worktree: text(&main),
            path: "link".into(),
        })
        .unwrap_err();
    assert_eq!(linked.code, ErrorCode::PermissionDenied);

    // The open folder moves away, and a link to another folder takes its
    // path: a read stays in the folder that the user opened, and git does
    // not run on the other one.
    let path = text(&main);
    std::fs::rename(&main, base.path().join("moved")).unwrap();
    symlink(&outside, &main).unwrap();
    let listed = engine
        .list_directory(ListDirectory {
            worktree: path.clone(),
            path: String::new(),
        })
        .unwrap();
    assert!(listed.iter().all(|entry| entry.name != "key"));
    let status = engine
        .read_status(ReadStatus { worktree: path })
        .unwrap_err();
    assert_eq!(status.code, ErrorCode::PermissionDenied);
}

#[test]
fn git_does_not_look_above_an_open_repository() {
    let base = tempfile::tempdir().unwrap();
    let parent = repository(base.path());
    write(&parent.join("parent-change.rs"), "p\n");
    let nested = parent.join("vendor");
    std::fs::create_dir(&nested).unwrap();
    assert!(git(&nested, &["init", "-q"]));
    let engine = engine();
    engine
        .open_folder(OpenFolder {
            path: text(&nested),
        })
        .unwrap();

    // Without its git folder, the nested folder would belong to the parent.
    std::fs::remove_dir_all(nested.join(".git")).unwrap();
    let status = engine
        .read_status(ReadStatus {
            worktree: text(&nested),
        })
        .unwrap_err();
    assert_eq!(status.code, ErrorCode::FailedPrecondition);
}

#[test]
fn the_status_has_each_kind_of_change_and_short_folder_entries() {
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    write(&main.join("old.rs"), "old\n");
    assert!(git(&main, &["add", "old.rs"]));
    assert!(git(&main, &["commit", "-q", "-m", "old"]));
    // A conflict: two branches change the same line.
    assert!(git(&main, &["checkout", "-q", "-b", "other"]));
    write(&main.join("README.md"), "other\n");
    assert!(git(&main, &["commit", "-q", "-am", "other"]));
    assert!(git(&main, &["checkout", "-q", "main"]));
    write(&main.join("README.md"), "main\n");
    assert!(git(&main, &["commit", "-q", "-am", "main"]));
    assert!(!git(&main, &["merge", "-q", "other"]));
    // The other kinds.
    write(&main.join("src/lib.rs"), "fn b() {}\n");
    write(&main.join("new.rs"), "new\n");
    assert!(git(&main, &["add", "new.rs"]));
    std::fs::remove_file(main.join("old.rs")).unwrap();
    write(&main.join("scratch/a.md"), "a\n");
    write(&main.join("scratch/b.md"), "b\n");
    write(&main.join("node_modules/x/index.js"), "x\n");
    let engine = engine();
    engine
        .open_folder(OpenFolder { path: text(&main) })
        .unwrap();

    let mut status = engine
        .read_status(ReadStatus {
            worktree: text(&main),
        })
        .unwrap();
    status.sort_by(|a, b| a.path.cmp(&b.path));
    let changed = |path: &str, status| ChangedPath {
        path: path.into(),
        status,
    };
    assert_eq!(
        status,
        vec![
            changed("README.md", GitStatus::Conflict),
            changed("new.rs", GitStatus::Added),
            changed("node_modules/", GitStatus::Ignored),
            changed("old.rs", GitStatus::Deleted),
            changed("scratch/", GitStatus::Untracked),
            changed("src/lib.rs", GitStatus::Modified),
        ]
    );
}

#[test]
fn a_repository_opens_without_a_worktree_whose_folder_is_gone() {
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    // The folder of the linked worktree is gone, but git still lists it.
    std::fs::remove_dir_all(base.path().join("app.feature")).unwrap();
    let engine = engine();

    let opened = engine
        .open_folder(OpenFolder { path: text(&main) })
        .unwrap();
    assert_eq!(
        opened
            .worktrees
            .iter()
            .map(|worktree| worktree.path.clone())
            .collect::<Vec<_>>(),
        vec![text(&main)]
    );
}

#[cfg(unix)]
#[test]
fn a_link_to_a_folder_in_the_root_lists_as_a_folder() {
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    write(&main.join("shared/a.rs"), "a\n");
    std::os::unix::fs::symlink("../shared", main.join("src/link")).unwrap();
    let engine = engine();
    engine
        .open_folder(OpenFolder { path: text(&main) })
        .unwrap();

    let listed = engine
        .list_directory(ListDirectory {
            worktree: text(&main),
            path: "src".into(),
        })
        .unwrap();
    assert!(listed.contains(&DirectoryEntry {
        name: "link".into(),
        kind: EntryKind::Folder,
    }));
    let inside = engine
        .list_directory(ListDirectory {
            worktree: text(&main),
            path: "src/link".into(),
        })
        .unwrap();
    assert_eq!(
        inside,
        vec![DirectoryEntry {
            name: "a.rs".into(),
            kind: EntryKind::File,
        }]
    );
}

#[test]
fn a_branch_keeps_a_name_that_starts_like_a_reference() {
    let base = tempfile::tempdir().unwrap();
    let main = repository(base.path());
    let linked = base.path().join("app.topic");
    assert!(git(
        &main,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "refs/heads/topic",
            linked.to_str().unwrap()
        ]
    ));
    let opened = engine()
        .open_folder(OpenFolder { path: text(&main) })
        .unwrap();
    let topic = opened
        .worktrees
        .iter()
        .find(|worktree| worktree.path == text(&linked))
        .unwrap();
    assert_eq!(topic.branch.as_deref(), Some("refs/heads/topic"));
}

#[test]
fn the_projects_are_the_folders_in_the_root() {
    let base = tempfile::tempdir().unwrap();
    // Git on Windows does not take the `\\?\` form of a canonical path.
    repository(base.path());
    let root = base.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("Notes")).unwrap();
    std::fs::create_dir(root.join(".cache")).unwrap();
    write(&root.join("todo.txt"), "one\n");
    let engine = Engine::new(&root).unwrap();

    let projects = engine.list_projects(ListProjects {}).unwrap();
    let project = |name: &str, git: bool| Project {
        name: name.to_owned(),
        path: root.join(name).to_string_lossy().into_owned(),
        git,
    };
    // The linked worktree has a `.git` file, and is a project of its own.
    assert_eq!(
        projects,
        vec![
            project("app", true),
            project("app.feature", true),
            project("Notes", false),
        ]
    );
}

#[cfg(unix)]
#[test]
fn a_link_out_of_the_root_is_not_a_project() {
    let base = tempfile::tempdir().unwrap();
    let base = base.path().canonicalize().unwrap();
    let root = base.join("root");
    std::fs::create_dir_all(root.join("inside")).unwrap();
    std::fs::create_dir(base.join("outside")).unwrap();
    std::os::unix::fs::symlink(base.join("outside"), root.join("away")).unwrap();
    std::os::unix::fs::symlink("inside", root.join("near")).unwrap();
    let engine = Engine::new(&root).unwrap();

    let names: Vec<String> = engine
        .list_projects(ListProjects {})
        .unwrap()
        .into_iter()
        .map(|project| project.name)
        .collect();
    assert_eq!(names, ["inside", "near"]);
}

#[test]
fn hello_answers_the_root_and_refuses_another_protocol() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().canonicalize().unwrap();
    let engine = Engine::new(&root).unwrap();

    let Response::Welcome(welcome) = engine
        .handle(Request::Hello(Hello {
            protocol: PROTOCOL_VERSION,
        }))
        .unwrap()
    else {
        panic!("hello answers a welcome");
    };
    assert_eq!(welcome.protocol, PROTOCOL_VERSION);
    assert_eq!(welcome.root, root.to_string_lossy());

    let refused = engine
        .hello(Hello {
            protocol: PROTOCOL_VERSION + 1,
        })
        .unwrap_err();
    assert_eq!(refused.code, ErrorCode::FailedPrecondition);
}

#[test]
fn the_root_comes_from_the_variable_or_the_home_folder() {
    let base = tempfile::tempdir().unwrap();
    let base = base.path().canonicalize().unwrap();

    // A set value MUST be an absolute path to a folder.
    let set = base.join("projects");
    std::fs::create_dir(&set).unwrap();
    assert_eq!(projects_root(Some(set.clone().into()), None).unwrap(), set);
    for value in [
        "relative/projects",
        &*base.join("missing").to_string_lossy(),
    ] {
        let refused = projects_root(Some(value.into()), Some(base.clone())).unwrap_err();
        assert_eq!(refused.code, ErrorCode::FailedPrecondition, "{value}");
    }

    // Else the root is `vvorkflow` in the home folder, which the engine makes.
    let home = base.join("home");
    std::fs::create_dir(&home).unwrap();
    for value in [None, Some("".into())] {
        assert_eq!(
            projects_root(value, Some(home.clone())).unwrap(),
            home.join("vvorkflow")
        );
    }
    assert!(home.join("vvorkflow").is_dir());

    // A file in its place, or no home folder, stops the engine.
    let other = base.join("other");
    std::fs::create_dir(&other).unwrap();
    write(&other.join("vvorkflow"), "not a folder\n");
    for home in [Some(other), None] {
        let refused = projects_root(None, home).unwrap_err();
        assert_eq!(refused.code, ErrorCode::FailedPrecondition);
    }
}

#[cfg(unix)]
#[test]
fn a_project_with_a_broken_git_link_is_still_git() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("app")).unwrap();
    std::os::unix::fs::symlink("../gone", root.join("app/.git")).unwrap();
    let projects = Engine::new(&root)
        .unwrap()
        .list_projects(ListProjects {})
        .unwrap();
    assert!(projects[0].git);
}

// macOS refuses a file name that is not UTF-8, so only Linux can make one.
#[cfg(target_os = "linux")]
#[test]
fn a_name_that_is_not_utf8_is_not_a_project() {
    use std::os::unix::ffi::OsStrExt;
    let base = tempfile::tempdir().unwrap();
    let root = base.path().canonicalize().unwrap();
    std::fs::create_dir(root.join(std::ffi::OsStr::from_bytes(b"bad\xff"))).unwrap();
    std::fs::create_dir(root.join("bad\u{fffd}")).unwrap();
    let names: Vec<String> = Engine::new(&root)
        .unwrap()
        .list_projects(ListProjects {})
        .unwrap()
        .into_iter()
        .map(|project| project.name)
        .collect();
    assert_eq!(names, ["bad\u{fffd}"]);

    let not_text = root.join(std::ffi::OsStr::from_bytes(b"root\xff"));
    std::fs::create_dir(&not_text).unwrap();
    let refused = projects_root(Some(not_text.into()), None).unwrap_err();
    assert_eq!(refused.code, ErrorCode::FailedPrecondition);
}
