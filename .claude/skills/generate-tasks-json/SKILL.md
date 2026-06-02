---
name: generate-tasks-json
description: Generate a tasks.json file for the Monetarium Explorer issue-creation script (.github/scripts/generate-issues/create-issues.js). Use whenever the user wants to plan a milestone, batch-create GitHub issues for this project, draft a feature/task/bug, split a large feature into sub-issues, populate or update tasks.json, or asks anything like "create issues for X", "file a bug for Y", "prepare a tasks file", or "let's plan out v2". Trigger even if the user does not say "tasks.json" by name — any request to scaffold issues for this repo runs through this single file.
---

# Generate tasks.json for create-issues.js

This project drives bulk GitHub issue creation through a single Node.js script (`.github/scripts/generate-issues/create-issues.js`) that consumes a `tasks.json` file. This skill covers **how to execute** that task: where the file goes, the script's schema, validation, and the safe run procedure. It does **not** restate the team's planning rules — those live in one place (below).

## Authoritative rules — read this first, every time

[`.github/scripts/generate-issues/GITHUB_ISSUES_AND_PROJECT_BOARD.md`](../../../.github/scripts/generate-issues/GITHUB_ISSUES_AND_PROJECT_BOARD.md) is the **single source of truth** for all issue-planning policy. **Read it in full before drafting** — not "only if a question comes up". It is binding; if anything in this skill ever appears to conflict with it, the doc wins and this skill should be fixed.

It owns, and this skill deliberately does **not** duplicate:

- **Issue granularity** (§3): the **default is one full-stack `issue` = one PR**, split by feature/task/bug, **never** by layer; don't oversplit (§3.1–3.2).
- **The large-feature exception** (§3.3): `parent` + sub-issues only when a feature genuinely can't land in one PR, split into **vertical slices** (each a one-PR full-stack unit), never into layer pairs; no childless `parent`.
- **Domain prefixes** (§3.4): every title carries exactly one prefix from the canonical set.
- **Assignment** (§4): issues are created **unassigned** — omit `assignee`. The only reasonable assignee is a Feature Owner on a `parent`.
- **The allowed label set** (§7).

Apply those rules from the doc. The rest of this skill is mechanics.

## Sourcing issue content from the wiki

The repo ships a curated `wiki/` (`wiki/index.md`). Use it to fill issue bodies instead of re-deriving scope — this is drafting technique, not policy. Because issues are now **single and full-stack**, one issue body draws on **both** kinds of wiki page at once:

- **If `wiki/specs/<area>/spec.md` exists, that spec is the issue.** Link it and **lift its acceptance checklist verbatim** into the issue body rather than paraphrasing.
- **If `wiki/code-analysis/<area>/` exists, mine it for "must preserve" acceptance items** — `patterns.md` invariants and `impact.md` failure modes (memoized-pointer no-mutate, lock order, both-transports parity, SKA atoms staying `big.Int`-derived strings, etc.). These go in the **same** issue, not a separate backend/data-only one.
- The change may cascade across several Go modules (7-module workspace) and both transports (HTTP template + WebSocket). That is still **one** issue — the full-stack developer owns it end to end.
- A `[DOCS]` issue is warranted when refreshing those code-analysis files (`flow.compact.md`, `patterns.md`, `impact.md`) is itself a distinct piece of work after a change lands.

## Workflow

1. **Check the slot for a leftover `tasks.json`** (see "File location and shape"). A successful live run auto-archives the file, so any `tasks.json` present is a **previous batch left pending or abandoned** — **never append to or merge with it.** Treat it as stale: confirm with the user, then **overwrite** it for the new batch.
2. **Read the authoritative doc** (above), then understand the work: the user-visible change, the layers it touches, and any constraints.
3. **Decide the shape per §3** — default to a **single `type: issue`** (full-stack, one PR). Use `parent` + vertical-slice sub-issues **only** for the large-feature exception of §3.3.
4. **Pick the one domain prefix** from the §3.4 canonical set; **omit `assignee`** (§4).
5. **Draft the JSON** following the schema below, sourcing content from the wiki.
6. **Validate locally** in dry-run mode (see "Validate"). Never invoke a live run yourself.

## File location and shape

The script reads/writes `tasks.json` in its gitignored runtime dir, `.github/scripts/generate-issues/.local/` (resolved by script location, not cwd); override with `--file <path>`. Unless told otherwise, draft into `.local/tasks.json`.

**Lifecycle:** a successful live run moves `tasks.json` into `.local/archive/` (and removes the state file), so the slot is normally empty — its presence means a draft is pending. All transient files (`tasks.json`, resume state, log, `archive/`) live in the single gitignored `.local/` dir. **Always overwrite a leftover `tasks.json`; never append to it** (see Workflow step 1).

```json
{
  "tasks": [
    /* task objects */
  ]
}
```

## Task object fields

This is the `create-issues.js` schema (a script contract, not team policy). The validator enforces:

- `id` — required, unique string. Wires `parent` ↔ `sub-issue` locally; not posted to GitHub. Use stable kebab-case slugs (`fix-ticket-price-default`).
- `title` — required, what appears on GitHub. Carries exactly one domain prefix (§3.4).
- `type` — one of `parent`, `sub-issue`, `issue`. Anything else fails validation. **Default to `issue`.**
- `parent` — required when `type` is `sub-issue`; must reference an existing `id` whose task is `type: parent`.
- `issue_type` — `Feature` for parents, `Task` otherwise. Defaults apply if omitted; set it explicitly.
- `description` — markdown body. The script auto-appends `\n\nPart of #<parent-number>` to sub-issues — do not write that yourself.
- `assignee` — **omit by default** (unassigned pool, §4). Only set it for a `parent`'s Feature Owner.
- `labels` — array from the doc's allowed set only (§7). **Optional**: set the one label matching the kind of change (`bug` / `enhancement` / `refactoring`) when it adds value; omitting `labels` leaves the issue **unlabeled** (the script no longer force-defaults to `enhancement`). There is **no** per-task `milestone` field — the script applies the milestone globally from `config.json` (§8.2).

## Validation cheat-sheet (what the script enforces)

`create-issues.js` rejects the file if any of these hold — check before handing it over:

- a task missing `id` or `title`;
- two tasks sharing an `id`;
- `type` not in `parent` / `sub-issue` / `issue`;
- a `sub-issue` with no `parent`, a non-existent `parent`, or a `parent` whose `type` is not `parent`.

Sanity-check the JSON against these yourself first.

## Skeleton to start from

The default shape is a **single full-stack issue**:

```json
{
  "tasks": [
    {
      "id": "<slug>",
      "type": "issue",
      "issue_type": "Task",
      "title": "[<DOMAIN>] <concise full-stack change>",
      "description": "<scope + checkbox steps; spec acceptance checklist lifted verbatim; code-analysis 'must preserve' invariants>",
      "labels": ["bug"]
    }
  ]
}
```

For the large-feature exception (`parent` + vertical-slice sub-issues), use the worked example in the authoritative doc §8.4.

## Validate

After writing the file, run dry-run mode — it validates, prints what would be created, and makes **no** GitHub API calls:

```bash
cd .github/scripts/generate-issues && node create-issues.js --dry-run
```

If the file is elsewhere: `node create-issues.js --dry-run --file <path>`.

Fix any `❌` lines before reporting done. Do **not** run the live command (`node create-issues.js` without `--dry-run`) yourself — that creates real GitHub issues, a write action requiring explicit user approval per the project's GitHub CLI rules. Show the user the dry-run output and the live command and let them invoke it.

## Common mistakes (mechanics)

Planning mistakes (over-decomposition, splitting by layer, wrong prefix, adding an assignee) are governed by the authoritative doc — follow it. The script-mechanics traps:

- **Oversplitting one change into multiple issues.** The default is a single full-stack `issue`; reach for `parent` + sub-issues only for the §3.3 exception.
- **Adding an `assignee`.** Issues are created unassigned (§4); only a `parent` Feature Owner gets one.
- **Writing `Part of #N` into a sub-issue description.** The script appends it automatically; duplicating produces ugly output.
- **Adding a `milestone` field to a task.** The milestone is applied globally from `config.json` (or `--milestone` / `MILESTONE`) — a per-task field is noise.
- **Appending to / reusing a stale `tasks.json`.** Start a fresh file every time (Workflow step 1); a successful run archives the consumed one to `.local/archive/`, so a file in the slot is a pending/abandoned draft, never a base to extend.
- **Reusing or renaming an `id` across runs after partial success.** With `--resume` the script keys `.create_issues_state.json` by `id`; changing ids mid-flight breaks resume linkage.
- **Running the live command to "just check".** Dry-run is the only thing you run; the live run is the user's.
