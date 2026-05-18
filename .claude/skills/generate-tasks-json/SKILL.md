---
name: generate-tasks-json
description: Generate a tasks.json file for the Monetarium Explorer issue-creation script (.github/scripts/create-issues.js). Use whenever the user wants to plan a milestone, batch-create GitHub issues for this project, draft features and sub-issues, populate or update tasks.json, or asks anything like "create issues for X feature", "split this work into sub-issues", "prepare a tasks file", or "let's plan out v2". Trigger even if the user does not say "tasks.json" by name — any request to scaffold a Feature plus its implementation breakdown for this repo should use this skill, because the team's issue-creation workflow runs through this single file.
---

# Generate tasks.json for create-issues.js

This project drives bulk GitHub issue creation through a single Node.js script (`.github/scripts/create-issues.js`) that consumes a `tasks.json` file. Your job in this skill is to turn the user's high-level intent (a feature, an epic, a chunk of refactoring work) into a valid `tasks.json` that the script will accept on the first try, while honoring the team's hierarchy, naming, and assignment conventions.

The authoritative rule document is [`.github/scripts/GITHUB_ISSUES_AND_PROJECT_BOARD.md`](../../../.github/scripts/GITHUB_ISSUES_AND_PROJECT_BOARD.md). The notes below are the working summary you actually need while drafting — read the full doc only if a question comes up that this skill doesn't answer.

## Workflow

1. **Understand the feature.** Ask the user enough to identify: the user-visible functionality (the Feature), the rough system layers it touches (DB, DATA, API, WS, UI), and any constraints (single PR? small enough to skip sub-issues?).
2. **Decide the shape.** A small Feature can be a single `parent` issue with checkbox steps in its description. A normal Feature is one `parent` plus several `sub-issue` children, one per system boundary that requires its own PR.
3. **Draft the JSON** in memory or directly into the file, following the schema and rules below.
4. **Validate locally** by running the script in dry-run mode before doing anything live (see "Validate" below). Never invoke a non-dry run yourself — that creates real issues on GitHub. Hand the dry-run output to the user and let them run the live command.

## File location and shape

By default the script reads `./tasks.json` from the current working directory, but it accepts `--file <path>`. Unless the user says otherwise, write to `.github/scripts/tasks.json` so it sits next to the script and is easy to commit alongside any related changes.

The top-level structure is a single object with a `tasks` array:

```json
{
  "tasks": [ /* task objects */ ]
}
```

## Task object fields

Each task is one of three `type` values. The script's validator (in `create-issues.js`) enforces:

- `id` — required, unique string. Used internally to wire `parent` ↔ `sub-issue`. Use stable, kebab-case slugs like `feature-blocks-list`, `blocks-api-endpoint`. The id is **not** posted to GitHub; it is purely a local key.
- `title` — required, what appears on GitHub.
- `type` — one of `parent`, `sub-issue`, `issue`. Anything else fails validation.
- `parent` — required when `type` is `sub-issue`; must reference an existing `id` whose task has `type: parent`.
- `issue_type` — `Feature` for parents, `Task` for sub-issues and standalone issues. The script defaults to `Feature`/`Task` if omitted, but set it explicitly so the file is self-documenting.
- `description` — markdown body. For sub-issues the script automatically appends `\n\nPart of #<parent-number>` at create time, so do not include that yourself.
- `assignee` — exactly one GitHub login (see "Assignment" below).
- `labels` — array. Use only the approved set; `enhancement` is the safe default. Omit entirely if no label adds value — over-labeling is discouraged.

## Hierarchy rules

- Only **two levels**: Feature (`parent`) → Sub-issues (`sub-issue`). No nested sub-tasks.
- A sub-issue should be **one PR's worth of work** and self-contained enough that the assignee doesn't need deep context from sibling issues to start.
- If a Feature is genuinely small, emit a single `parent` (or a single `issue`) with a checkbox list in `description` instead of inventing thin sub-issues.
- A standalone task (bug fix, infra tweak) that has no parent uses `type: issue`.

## Sub-issue title prefixes

Every sub-issue title must start with exactly one prefix in square brackets. The prefix marks the **dominant** area of responsibility — where the main work happens — not every layer the change touches.

| Prefix    | Use it when the primary work is…                 |
| --------- | ------------------------------------------------ |
| `[API]`   | Adding/changing an HTTP endpoint or data contract |
| `[DB]`    | SQL queries, indexing, schema, perf in `db/dcrpg`|
| `[UI]`    | Templates, SCSS, Stimulus controllers, frontend  |
| `[WS]`    | WebSocket / pubsub real-time push                |
| `[DATA]`  | Aggregation, transformation, internal Go logic   |
| `[DOCS]`  | Wiki pages, READMEs, CLAUDE.md, in-repo guides   |

Hard rules:

- **One prefix per title.** Never combine (`[API][UI] …` is invalid).
- **Pick the dominant prefix** — the one reflecting the primary area of responsibility, where the main work is performed. Prefixes do not enumerate every layer the change touches; they mark the initiator of the change. An endpoint change that incidentally requires a UI tweak stays `[API]` because the contract is the dominant work — do not split it.
- **Only split when two domains carry genuinely equal weight.** Splitting is the fallback for the rare case where neither domain dominates, not the default response to multi-layer work — over-splitting produces churn and many tiny issues. When it is the right call:
  - ❌ `[API][UI] Add sorting to blocks list`
  - ✅ `[API] Add sorting support to blocks endpoint` + `[UI] Implement sorting in blocks table`

The parent (Feature) title does **not** take a prefix — it names the user-visible functionality (e.g. `Blocks List Page`).

## Assignment

Each issue gets exactly one assignee. The team's preferred mapping:

- `[DB]`, `[DATA]`, `[WS]`, `[API]` → **yanchenko-igor**
- `[UI]` → **edshav**
- `[DOCS]` → no fixed default; assign to whichever developer has the most context on the area being documented.
- Feature (`parent`) assignee is the Feature Owner — typically the developer doing the bulk of the work, often the backend lead for backend-heavy features.

This is a **guideline, not a hard rule**. If following it would pile every sub-issue on one person, rebalance: load balancing beats specialization. Do not invent extra sub-issues just to redistribute work, and do not split a sub-issue purely because of who would own it.

## Labels

Allowed values, and only these:

- `enhancement` (default for new functionality)
- `bug`
- `infrastructure`
- `documentation`
- `refactoring` — only when behavior does not change

The script will fail if a label doesn't already exist on the repo, so do not invent new ones. Generic labels (`duplicate`, `invalid`, `wontfix`, `question`, `good first issue`, `help wanted`) are explicitly disallowed by team policy. When in doubt, omit `labels` rather than add noise.

## Validation cheat-sheet (what the script enforces)

The validator in `create-issues.js` will reject the file if any of these are true — check before handing the file to the user:

- A task is missing `id` or `title`.
- Two tasks share an `id`.
- `type` is anything other than `parent`, `sub-issue`, or `issue`.
- A `sub-issue` has no `parent`, or its `parent` id does not exist, or the referenced parent's `type` is not `parent`.

Sanity-check the JSON yourself against these before declaring done.

## Skeleton to start from

```json
{
  "tasks": [
    {
      "id": "feature-<slug>",
      "type": "parent",
      "issue_type": "Feature",
      "title": "<User-visible feature name>",
      "description": "<Scope, motivation, acceptance criteria>",
      "assignee": "<github-login>",
      "labels": ["enhancement"]
    },
    {
      "id": "<slug>-data",
      "type": "sub-issue",
      "parent": "feature-<slug>",
      "issue_type": "Task",
      "title": "[DATA] <what this sub-issue does>",
      "description": "<concrete implementation scope>",
      "assignee": "yanchenko-igor",
      "labels": ["enhancement"]
    },
    {
      "id": "<slug>-ui",
      "type": "sub-issue",
      "parent": "feature-<slug>",
      "issue_type": "Task",
      "title": "[UI] <what this sub-issue does>",
      "description": "<concrete implementation scope>",
      "assignee": "edshav",
      "labels": ["enhancement"]
    }
  ]
}
```

A fuller worked example (Blocks List Page) lives in [`.github/scripts/GITHUB_ISSUES_AND_PROJECT_BOARD.md`](../../../.github/scripts/GITHUB_ISSUES_AND_PROJECT_BOARD.md) §8.4 — open it if you need a reference for how a real Feature decomposes into 4–6 sub-issues.

## Validate

After writing the file, run the script in dry-run mode. It validates structure, prints what would be created, and makes **no** GitHub API calls:

```bash
cd .github/scripts && node create-issues.js --dry-run
```

If the user wrote the file somewhere else, point the script at it: `node create-issues.js --dry-run --file <path>`.

Read the dry-run output for any `❌` lines and fix the file before reporting done. Do **not** run the live command (`node create-issues.js` without `--dry-run`) yourself — that creates real GitHub issues, which is a write action that requires explicit user approval per the project's GitHub CLI rules. Show the user the dry-run output and the live command, and let them invoke it.

## Common mistakes to avoid

- **Putting `Part of #N` in a sub-issue description.** The script appends this automatically — duplicating it produces ugly output.
- **Inventing prefixes** (`[BACKEND]`, `[FE]`, `[TEST]`). Only the six listed prefixes are valid.
- **Multi-prefix titles.** Pick the single dominant prefix — the area where the main work is performed — instead of combining. Only split into separate sub-issues when two domains carry genuinely equal weight; otherwise a one-prefix title with a brief note in the description about incidental cross-layer changes is correct.
- **Assigning a sub-issue to multiple people** via comma or array. The field takes one login.
- **Putting CI/dev-tooling work under `enhancement`.** Use `infrastructure`.
- **Reusing an `id` across runs after partial success.** If the user is resuming a previous run with `--resume`, the script reads `.create_issues_state.json` keyed by `id`; renaming an id mid-flight breaks resume linkage.
