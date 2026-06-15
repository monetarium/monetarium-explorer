---
name: generate-tasks-json
description: Generate a tasks.json file for the Monetarium Explorer issue-creation script (.github/scripts/generate-issues/create-issues.js). Use whenever the user wants to plan a milestone, batch-create GitHub issues for this project, draft a feature/task/bug, split a large feature into sub-issues, populate or update tasks.json, or asks anything like "create issues for X", "file a bug for Y", "prepare a tasks file", or "let's plan out v2". Trigger even if the user does not say "tasks.json" by name — any request to scaffold issues for this repo runs through this single file.
---

# Generate tasks.json for create-issues.js

This project drives bulk GitHub issue creation through a single Node.js script (`.github/scripts/generate-issues/create-issues.js`) that consumes a `tasks.json` file. This skill is the canonical home for the **generic issue-writing best-practices** — how to size an issue, when to split it, and how to write a good body. The **project-specific conventions** — the domain-prefix set, the allowed labels, the no-default-assignee model, the board, and the script itself — live in the team doc, linked below.

## Generic best-practice here, project specifics in the doc

[`GITHUB_ISSUES_AND_PROJECT_BOARD.md`](../../../.github/scripts/generate-issues/GITHUB_ISSUES_AND_PROJECT_BOARD.md) holds the **project-specific** instructions. Consult it for the concretes this skill points to:

- the **domain-prefix table** (§3.1) and the **allowed label set** (§7),
- the **no-default-assignee model** (§4), and the **board** / **PR-merge** conventions (§5–6),
- the **milestone / `config.json`** (§2) and the **`create-issues.js`** schema, run procedure, and lifecycle (§8).

This skill owns the generic principles that follow (single source of truth, granularity, decomposition, spec-not-plan). The division of labor: **on a generic principle the skill is canonical; on a project-specific concrete the doc wins.** Apply both together.

## Issues are the single source of truth

All feature discussion, bug reports, and decisions belong **in the GitHub issue**, not in external messengers — that one searchable history is what the client and the team rely on. Two consequences when drafting:

- The body must stand on its own as the working record of the change — which is why a client request relayed over a messenger is preserved verbatim (see "Preserving the original client request").
- The issue captures the *spec*, not the implementation; the build history lives in the PR that closes it (see "Write issues as specs, not implementation plans").

## Issue granularity: one issue, one PR

The team is staffed by **full-stack developers** and most work is small bugs and improvements, so issue structure is deliberately flat:

- The **default unit of work is one `type: issue`** that a single developer delivers in **one Pull Request**, covering the change end-to-end — backend, frontend, tests, docs — as one piece.
- **Split by what the change is** (feature / task / bug), **never by which layer it touches.** An `[API]` issue plus a `[UI]` issue for the *same* fix is the classic anti-pattern: one developer implements the whole thing, so the split only adds coordination overhead.
- **Don't oversplit** — over-decomposition is the most common planning failure. Checkbox steps inside the body are planning detail, not a reason to spin up more issues. One self-contained change → one issue.

## Large features: parent + vertical-slice sub-issues

A two-level hierarchy is reserved for a feature that genuinely **cannot land in one PR**:

- One **`parent`** (`issue_type: Feature`) describing the user-visible scope, plus **two or more `sub-issue`s** (`issue_type: Task`).
- Each sub-issue is a **vertical slice** — itself a one-PR, full-stack unit (e.g. the "list view" and the "detail drawer" of one page) — **never a layer split** (no `[DATA]` + `[UI]` pair for a single slice).
- A `parent` **must** have sub-issues; a childless parent is invalid, and a feature too small to slice is a plain `type: issue`. Only two levels — no deeper nesting.
- The `parent` is the one place a default `assignee` is reasonable (a Feature Owner coordinating the slices); the slices themselves stay unassigned.

## Titles and labels — the principle here, the sets in the doc

- **One domain prefix per title.** Every title starts with exactly **one** prefix marking the *domain* (not a layer), so the board scans at a glance. Choose the single dominant domain; never combine (❌ `[BLOCKS][API]`). The canonical set and how to extend it are the doc's prefix table (§3.1).
- **Labels are a small strict set, and optional.** Set at most the one label matching the *kind* of change (`bug` / `enhancement` / `refactoring`) when it adds value; otherwise omit it and leave the issue unlabeled. The prefix carries the domain, the label the kind — don't over-label. Only labels that already exist in the repo are allowed (the approved set is §7).
- **Omit `assignee`.** New issues go into an unassigned pool and are self-assigned on pickup — the team's model is §4. The only `assignee` you set is a Feature Owner on a `parent`.

## Write issues as specs, not implementation plans

An issue is a **spec**: it states *what* must change and *why*, and what "done" looks like — not *how* to build it. The granularity sections above govern how to **split** work into issues; this governs how to **write** each one. The audience is the whole team and the client / product owner (see "Issues are the single source of truth"), most of whom read the issue without ever opening the code. The implementation — the file-by-file changes, the function names, the actual diff — belongs in the **PR** that closes the issue, authored by whoever picks it up. An issue that prescribes the implementation goes stale the moment the code moves, and quietly pre-decides an approach the implementer may well improve on.

Keep each body lean and outcome-focused:

- **Problem / outcome** — a short statement of the user-visible need or defect and the goal. A reader should grasp what's wanted without domain-internal knowledge.
- **Scope** — a few bullets on what the change covers (and, where useful, what it explicitly doesn't). Checkbox bullets are good, but as *requirement* sub-tasks ("ticket-price chart respects the new default"), not a code walkthrough.
- **Acceptance criteria** — observable, testable outcomes a reviewer checks to call it done ("the API returns the SKA total at height `h`", "the supply card renders with no scientific notation"). This is the part worth being precise about.
- **References** — link the spec / wiki / related issues. **Link, don't transcribe**: a pasted-in spec rots out of sync with its source.

Leave **out** of the body (it lives in the PR instead):

- A step-by-step implementation recipe — which files to edit, which functions to add, line numbers.
- Internal code invariants copied wholesale out of `wiki/code-analysis/` (lock order, memoized-pointer no-mutate, both-transports parity, …). The implementer is already told to read those before touching the area (CLAUDE.md); re-pasting them into every issue bloats the body. If one is genuinely an *acceptance* concern, condense it to a single "must not regress" outcome line and link the page — don't embed the analysis.

**Don't reverse-engineer a plan from source to write the spec.** Drafting an issue does not require reading the Go / JS source — your inputs are the user's request and the wiki. Opening source files to reconstruct an implementation is exactly what produces the bloated, brittle, over-prescribed bodies this section exists to prevent. If the request is genuinely unclear, ask the user; don't go spelunking.

## Sourcing issue content from the wiki

The repo ships a curated `wiki/` (`wiki/index.md`). Use it to source issue content instead of re-deriving scope — or worse, reading source to reconstruct it (see the section above). This is drafting technique, not policy.

- **If `wiki/specs/<area>/spec.md` exists, that spec is the issue.** Link it, and lift its **acceptance checklist** into the body — acceptance is exactly the spec-level content an issue should carry. Summarize the scope in a sentence or two; **link the spec rather than transcribe it**.
- **`wiki/code-analysis/<area>/` is for the implementer, not the issue body.** It documents internal mechanics — invariants in `patterns.md`, failure modes in `impact.md` — that the developer reads *when they implement*. Don't mine it into the spec. At most, if one invariant is a real *acceptance* constraint, condense it to a single "must not regress" line (e.g. "both transports stay in parity", "SKA atoms stay `big.Int`-derived strings") and link the page.
- A change may cascade across several Go modules (7-module workspace) and both transports (HTTP template + WebSocket). That breadth shapes *how the work is split* (see "Issue granularity" above — still usually one full-stack issue), not how much implementation detail the body carries. Describe the outcome, not the cascade.
- A `[DOCS]` issue is warranted when refreshing those code-analysis files (`flow.compact.md`, `patterns.md`, `impact.md`) is itself a distinct piece of work after a change lands.

## Preserving the original client request

Issues are the project's **single source of truth** (see "Issues are the single source of truth" above) — discussion lives in the issue, "not in external messengers." A client request that arrives over a messenger — often in a language other than the one the issue is written in — and gets silently rewritten into the issue body loses that record, and any translation drift becomes invisible. So when an issue's content originates from a **client-provided request** (a message or spec the user pastes in, in *any* language), preserve the client's exact wording inside the issue.

- **How to recognize it (the trigger).** A client citation is the user *forwarding someone else's words*, not describing the work in their own. In priority order:
  1. **Explicit demarcation** — the user marked it: a quoted/fenced block, a `Client:` / `From the client:` lead-in (or its equivalent in another language), or an obviously pasted or forwarded chat chunk. That marked span *is* the citation; take it as-is.
  2. **Register shift** — failing an explicit mark, look for a different language than the user's own instructions (a sudden switch to another language is the usual tell), end-user/reporter phrasing ("it doesn't show up…", "please fix…"), or a casual non-technical tone unlike their directives to you.

  The user's own instructions to you ("create issues for this", "split into two") are **not** the citation — exclude them. And if the user is the originator describing the work in their own words — even in another language — nothing was forwarded, so there is nothing to cite: skip the block.
- **Capture only the client's words, verbatim.** Lift the contiguous span the cues above pick out, trimmed of your-instruction framing — exact wording, no paraphrase, no in-place translation. The issue body *is* the working interpretation; the snippet is the untouched original a reviewer (and the client) can check it against.
- **Slice per issue.** When one client message spawns several issues, give each issue only the excerpt that motivated it — the sentence(s) or paragraph for that change, not the whole message. A short, atomic request goes in whole.
- **Never fabricate — confirm or omit.** The block earns its place only by being the client's *actual* words, checkable against the issue body. So if you can't pin down a clean verbatim span — the request was paraphrased, the boundary is fuzzy, or you're unsure whether text is the client's or the user's — **do not reconstruct or back-translate one.** Ask the user to paste or point at the exact client text, or leave the block out. A made-up "original" is worse than none.
- **Placement.** Append it at the **end** of `description`, under a `---` divider, as a blockquote with a language-tagged heading:

  ```
  ...body: scope, steps, acceptance...

  ---

  **Original client request (<lang>):**

  > <client's exact words, verbatim — first paragraph>
  >
  > <... and any further paragraphs, each line still quoted>
  ```

  Tag the source language in the heading with its code (`(RU)`, `(EN)`, `(ES)`, …). In the JSON this is one `description` string: newlines are `\n`, and **every** quoted line starts with `> ` — including the blank lines between paragraphs, which must be a bare `>` (a fully blank line ends the blockquote and drops the rest out of the quote). Any `"` inside the snippet must be escaped as `\"`; non-ASCII text (Cyrillic, accents, CJK, …) needs no escaping — the file is UTF-8.

## Workflow

1. **Check the slot for a leftover `tasks.json`** (see "File location and shape"). A successful live run auto-archives the file, so any `tasks.json` present is a **previous batch left pending or abandoned** — **never append to or merge with it.** Treat it as stale: confirm with the user, then **overwrite** it for the new batch.
2. **Read the principles above** (and the doc for the project concretes they point to), then understand the work from the request and the wiki — the user-visible change and what "done" means. You're writing a spec, not a plan: don't open source to reverse-engineer an implementation (see "Write issues as specs, not implementation plans"). If the request is unclear, ask the user.
3. **Decide the shape** (see "Issue granularity" / "Large features" above) — default to a **single `type: issue`** (full-stack, one PR). Use `parent` + vertical-slice sub-issues **only** for the large-feature exception.
4. **Pick the one domain prefix** from the doc's canonical set (§3.1); **omit `assignee`** (§4).
5. **Draft the JSON** following the schema below, sourcing content from the wiki. For client-sourced work, end each issue body with the verbatim original snippet (see "Preserving the original client request").
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
- `title` — required, what appears on GitHub. Carries exactly one domain prefix (§3.1).
- `type` — one of `parent`, `sub-issue`, `issue`. Anything else fails validation. **Default to `issue`.**
- `parent` — required when `type` is `sub-issue`; must reference an existing `id` whose task is `type: parent`.
- `issue_type` — `Feature` for parents, `Task` otherwise. Defaults apply if omitted; set it explicitly.
- `description` — markdown body. Write it as a **spec**, not an implementation plan: problem / outcome, scope, acceptance criteria, and links — no file-by-file recipe or transcribed code internals (see "Write issues as specs, not implementation plans"). The script auto-appends `\n\nPart of #<parent-number>` to sub-issues — do not write that yourself. When the work comes from a client request, end the body with the verbatim original-request block (see "Preserving the original client request").
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
      "description": "<problem + outcome; scope bullets; acceptance criteria (lift the spec's checklist) — link the spec, no code-level implementation recipe>\n\n---\n\n**Original client request (<lang>):**\n\n> <client's verbatim words; omit this block for non-client work>",
      "labels": ["bug"]
    }
  ]
}
```

For the large-feature exception (`parent` + vertical-slice sub-issues), use the doc's §8.4 worked example.

## Validate

After writing the file, run dry-run mode — it validates, prints what would be created, and makes **no** GitHub API calls:

```bash
cd .github/scripts/generate-issues && node create-issues.js --dry-run
```

If the file is elsewhere: `node create-issues.js --dry-run --file <path>`.

Fix any `❌` lines before reporting done. Do **not** run the live command (`node create-issues.js` without `--dry-run`) yourself — that creates real GitHub issues, a write action requiring explicit user approval per the project's GitHub CLI rules. Show the user the dry-run output and the live command and let them invoke it.

## Common mistakes (mechanics)

The planning principles above (granularity, decomposition, spec-not-plan) and the doc's project concretes (prefix set §3.1, labels §7, assignee model §4) govern *what* to draft. This list catches the recurring traps — drafting and script-mechanics both:

- **Writing an implementation plan instead of a spec.** Issue bodies state problem, scope, and acceptance — not a file-by-file recipe or code-analysis invariants copied wholesale, and you don't read source to draft one (see "Write issues as specs, not implementation plans"). The implementation lives in the PR that closes the issue.
- **Oversplitting one change into multiple issues.** The default is a single full-stack `issue`; reach for `parent` + sub-issues only for the large-feature exception (see "Large features" above).
- **Adding an `assignee`.** Issues are created unassigned (§4); only a `parent` Feature Owner gets one.
- **Writing `Part of #N` into a sub-issue description.** The script appends it automatically; duplicating produces ugly output.
- **Adding a `milestone` field to a task.** The milestone is applied globally from `config.json` (or `--milestone` / `MILESTONE`) — a per-task field is noise.
- **Appending to / reusing a stale `tasks.json`.** Start a fresh file every time (Workflow step 1); a successful run archives the consumed one to `.local/archive/`, so a file in the slot is a pending/abandoned draft, never a base to extend.
- **Reusing or renaming an `id` across runs after partial success.** With `--resume` the script keys `.create_issues_state.json` by `id`; changing ids mid-flight breaks resume linkage.
- **Mangling or inventing the client snippet.** When the issue comes from a client request, keep the original wording **verbatim** (no translating it in place) and give each issue only **its** excerpt — don't paste the whole message into every issue. And never *manufacture* a snippet: if the client's exact words weren't actually provided, confirm or omit — don't back-translate the issue body into a fake "original" (see "Preserving the original client request").
- **Running the live command to "just check".** Dry-run is the only thing you run; the live run is the user's.
