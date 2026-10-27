# Local state: a daemon or a store that outlives a run

## Versions of what outlives a run

A daemon or a store outlives the CLI that made it, so the next run may be older or newer. Under nvm each Node version has its own global install, so two versions of the CLI run side by side.

- **Compare builds, not only protocols:** `version`, then `build.builtAt`, both from `PortsBase` (`build` is absent in a source run, which counts as oldest). A daemon does not stop on its own, so a fix that keeps the protocol would otherwise wait for a reboot.
- **A newer CLI replaces or rebuilds what is older; an older CLI refuses what is newer** with an `operator` code. Never downgrade: two CLIs that each "fix" the state flip it forever.
- **A shipped protocol only grows:** new messages or optional fields, never a change or removal, so every side can read `{ type: "hello", protocol, build }`.

## A daemon in the CLI's own package

- **Start it as a `hidden` `serve` Command** through `ctx.spawnDetached(ctx.self[0], [...ctx.self.slice(1), "daemon"])`, which works from source and from the bundle alike and resolves with the `pid` once the Daemon has started. The Daemon outlives the run and Ctrl-C, and gets no stdio, so it logs to a file. In a test, `runCli({ spawnDetached })` records the call instead.
- **A Daemon that a newer one replaces stops its work, then calls `ctx.end()`**, which ends its run with exit 0.
- **Replace it by a protocol message, never a signal:** a Coding agent's sandbox blocks `kill`, and a daemon needs its permission to listen on a local port. The daemon decides while reading the client's `hello`, since an older daemon may refuse the rest of the handshake.
- **The lowest free port in a fixed list wins**, instead of a lock file a crash leaves stale.
- **Log a repeating refusal once per distinct cause**, or an outdated client's reconnects flood the log.
- **A bridge to it reports what it is doing** while the Command waits, through `PortsBase`'s `progress`.

## A store that is a cache

- **Rebuild on a schema change; never migrate.** What must survive goes to a file the user named.
- **Rebuild in place,** re-reading the version inside the store's own transaction, rather than deleting the file: deleting fails on Windows while another run holds it, and on POSIX that run writes to a file nobody sees again.
- **Every Command that opens the store rebuilds it, read-only ones included**, and reports what it dropped in its data. A `doctor` row reports the store through a read-only connection and writes nothing; newer and corrupt are problems.
- **Classify the store's failures once**, for reads and writes alike: `ctx.fileError` for an errno; a store that cannot be opened or is read-only, `operator`; a full disk, `DISK_FULL`; a corrupt file, `operator`, whose hint says to move the file aside. Only on the read path does a refused query become `caller`; otherwise an agent rewrites a correct query forever.
- **Never delete a store the CLI thinks is corrupt:** rebuilding on a version change is the CLI's call, a damaged file the operator's.
- **Check `ctx.signal` before every store write**, so nothing new is written after Ctrl-C.
- **A lock wait that blocks the event loop also blocks Ctrl-C:** keep it short, and fail with a `wait` code when it runs out.
