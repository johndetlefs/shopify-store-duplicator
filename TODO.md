# TODO

Outstanding tasks and fixes discussed in this chat.

## High Priority

- [ ] Preserve metaobject publish status during migration (`data:dump` -> `data:apply`)
  - Problem: destination metaobjects were created as `DRAFT` even when source entries were published.
  - Fix:
    - Include publishable status in metaobject dump payload.
    - Apply that status on upsert/update in apply flow.
    - Keep backward compatibility for older dumps that do not contain status.

- [ ] Make metaobject apply deterministic for cross-metaobject references
  - Problem: some references fail on first pass when target entries are not yet indexed/applied.
  - Fix:
    - Add multi-pass retry flow for unresolved refs.
    - Rebuild index between passes.
    - Stop when no unresolved refs remain (or max pass count reached).
    - Emit clear summary of unresolved references at end.

## Medium Priority

- [ ] Clarify/selective apply behavior for `data:apply --metaobjects-only`
  - Current behavior intentionally still runs file apply/relink stage before metaobjects.
  - Decide and implement one of:
    - Keep behavior but document clearly in CLI help/docs, or
    - Add `--skip-files` for true “metaobjects only” execution.

- [ ] Improve docs for selective commands and gotchas
  - Update `QUICK_REFERENCE.md`, `README.md`, and `SETUP.md` with:
    - `data:apply --metaobjects-only` behavior (files + metaobjects).
    - Explanation of why reruns can resolve more references today.
    - Metaobject publish status parity status (once fixed).

## Operational / One-off

- [ ] Decide whether to keep or remove `scripts/publish-draft-metaobjects.mjs`
  - Current use: safe recovery script to publish draft metaobjects in destination.
  - If keeping: document in `QUICK_REFERENCE.md`.
  - If removing: delete script and remove npm script entry `metaobjects:publish-drafts`.

## Validation

- [ ] Add verification steps for the above fixes
  - `data:apply --metaobjects-only` should complete with references resolved in one run.
  - Post-apply check should show no unexpected draft metaobjects.
  - Regression check for file relinking should still pass.
