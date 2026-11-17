# Worktrees: Twig

Use `git twig new` for every new worktree. Do not use `git worktree add`.

Twig creates ordinary linked Git worktrees. Inside a Twig worktree, use normal
Git commands. `git twig new -b ticket/x ../ticket-x HEAD` is the usual form;
`-C <checkout>` selects the source checkout and the destination path is relative
to it. Use an explicit `-b` or `--detach` to enable the native copy-on-write
path, and choose a new destination. Never overwrite an existing directory.

## Rules

- Only committed tracked files are copied. Local edits, untracked files and
  ignored files are excluded, including `node_modules/` and `dist/`. Install
  dependencies and build in the new worktree before running test gates.
- Native copy-on-write needs macOS/APFS or Linux on Btrfs or reflink-enabled XFS.
  On NTFS, Twig delegates to a stock Git checkout. Set `TWIG_TRACE=1` on the
  create command to see which backend was selected.
- Twig is not a sandbox. Tracked secrets copy like any other tracked file.
- Use `git twig list` to inspect worktrees. Add `--porcelain` only when a script
  parses the output.
- Check `git status` before removing a worktree. Ask before removing, moving,
  unlocking or pruning anything. Never force removal. After approval, use
  `git twig remove <path>`.
- `git twig prune` removes stale registrations, not working directories. Preview
  with `--dry-run` first and ask before applying.
- `git twig prune` and `git twig repair` do not fix file contents or merge
  conflicts. `git twig repair` only repairs links after a directory was moved
  manually.
- A failed or interrupted create may leave a partial worktree registered. Inspect
  `git twig list` and the reported staging paths before retrying. Do not delete
  staging state automatically.
- Run `git twig skill` for the bundled CLI reference. No other Twig commands or
  flags exist; standard Git worktree options pass through to `new`.

## Prerequisites

Git 2.40 or newer is required. Install Twig 0.4.0 or newer with
`cargo install git-twig --locked` (Rust 1.95+) or the Homebrew tap. Verify with
`git twig --version` and `git twig new --help`. Do not use a curl-to-shell
installer. Do not leave multiple versions shadowing each other in PATH.
