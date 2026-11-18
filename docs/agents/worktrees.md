# Worktrees: Twig

Use `git twig new` for every new worktree. Do not use `git worktree add`.

Twig creates ordinary linked Git worktrees. Inside a Twig worktree, use normal
Git commands. `git twig new -b ticket/x ../ticket-x HEAD` is the usual form;
`-C <checkout>` selects the source checkout and the destination path is relative
to it. Use an explicit `-b` or `--detach` to enable the native copy-on-write
path, and choose a new destination. Never overwrite an existing directory.

Twig is a filesystem optimization, not a session or worktree manager. Selecting
the repository, base revision, branch, location, setup, tests, commits and
cleanup stays with the agent.

## Rules

- Only committed tracked files are copied. Local edits, untracked files and
  ignored files are excluded, including `node_modules/` and `dist/`. Install
  dependencies and build in the new worktree before running test gates.
- Native copy-on-write needs macOS/APFS or Linux on Btrfs or reflink-enabled XFS.
  On NTFS, Twig delegates to a stock Git checkout. Set `TWIG_TRACE=1` on the
  create command to see which backend was selected.
- Twig is not a sandbox. Tracked secrets copy like any other tracked file.
- Use `git twig list` to inspect worktrees. Add `--porcelain` only when a script
  parses the output; scripts should use `-z` and parse NUL records, not
  whitespace or newline-delimited paths.
- Choose the base revision deliberately. `HEAD` means the selected source
  checkout's current commit, not necessarily the remote default. Do not carry
  dirty work over, fetch/rebase or reset the source unless the task calls for it.
- Reuse an existing worktree only after confirming its identity and ownership.
  A directory name or branch prefix does not prove it is disposable. Keep using
  the absolute path for subsequent tools; changing one shell's directory does
  not move an agent session.
- Check `git status` (including untracked output), staged changes, unpushed
  commits and locks before removing a worktree. A clean status alone does not
  prove it is disposable. Ask before removing, moving, unlocking or pruning
  anything. Never force removal. After approval, use `git twig remove <path>`.
  Retain branches and commits unless their deletion was separately authorized.
- `git twig prune` removes stale registrations, not working directories. Preview
  with `--dry-run` first and ask before applying.
- `git twig prune` and `git twig repair` do not fix file contents or merge
  conflicts. `git twig repair` only repairs links after a directory was moved
  manually.
- `git twig adopt` (v0.5.0+, experimental) inspects an existing linked worktree
  for files whose current bytes match a donor checkout. Check `git twig adopt -h`
  first. Start with `git -C <donor> twig adopt --dry-run <worktree>`. It never
  replaces files on inspection. `--prepare` (macOS) only retains private clones;
  `--dedupe` (Linux Btrfs/XFS) is in-place and may stop partway, so do not claim
  physical space reclaimed from byte counts. Do not loop over other agents'
  worktrees.
- Since v0.5.0, Twig materializes builtin ident/encoding conversions per file
  and creates empty submodule directories without initializing donor submodules.
  Do not change repository attributes just to force the native path.
- A failed or interrupted create may leave a partial worktree registered. Inspect
  `git twig list` and the reported staging paths before retrying. Do not delete
  staging state automatically.
- Run `git twig skill` for the bundled CLI reference. No other Twig commands or
  flags exist; standard Git worktree options pass through to `new`.

## Prerequisites

Git 2.40 or newer is required. Install Twig 0.5.0 or newer with
`cargo install git-twig --locked` (Rust 1.95+) or the Homebrew tap. Verify with
`git twig --version` (at least 0.5.0), `git twig skill` and `git twig new -h`.
Do not use a curl-to-shell installer. Do not leave multiple versions shadowing
each other in PATH. Upgrade an older release with the same manager; Homebrew
HEAD installs use `brew upgrade --fetch-HEAD leostera/git-twig/git-twig`.
