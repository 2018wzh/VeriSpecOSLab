# Local thread workflow

Stars stores local conversation threads under `STARS_HOME` (default:
`~/.stars`). Threads preserve their transcript, todos, model, mode, and
reasoning-effort settings so later turns can resume the same context.

## List threads

```sh
stars threads list
```

By default, archived threads are hidden. Use filters to inspect archived
history:

```sh
stars threads list --archived  # archived only
stars threads list --all       # active and archived
```

The older `--list-threads` flag remains as an alias for active threads.

## Continue a thread

Start the interactive UI on an existing thread:

```sh
stars threads continue T-abc123
```

This is equivalent to starting interactive mode with `--thread T-abc123`.
When a thread is resumed without an explicit `--model` or `--mode`, Stars
uses the model/mode/reasoning-effort stored on the thread. Explicit CLI
overrides still win and replace the stored selection for that turn:

```sh
stars --thread T-abc123 -p "follow up"      # stored model/mode
stars --thread T-abc123 --mode smart -p "follow up"  # explicit mode
stars --thread T-abc123 --model gpt-5 -p "follow up" # raw model, no mode effort
```

Archived threads cannot be continued directly; fork them first.

## Archive a thread

```sh
stars threads archive T-abc123
```

Archiving sets `archivedAt` on the thread and hides it from the default
list. It does not delete transcript data. Archive is workspace-scoped:
Stars refuses to archive a thread that belongs to another workspace.

## Fork a thread

```sh
stars threads fork T-abc123
```

Forking copies the transcript, todos, guidance refs, model, mode, and
reasoning effort into a new active thread. Use this to continue from an
archived thread while keeping the original immutable. Fork is also
workspace-scoped, so a thread from another workspace cannot be copied
into the current workspace accidentally.
