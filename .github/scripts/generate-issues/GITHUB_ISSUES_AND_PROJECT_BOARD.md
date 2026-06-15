# Rules for GitHub Issues & Project Board

To maintain a professional and transparent development process for the **Monetarium Explorer**, the team adheres to the following rules.

---

## 1. Single Source of Truth

- All feature discussions, bug reports, and technical decisions take place within **GitHub Issues**, not in external messengers — a searchable history for the client and the team.
- The generic issue-writing principles this implies (the issue as a standalone record; spec, not implementation) live in the [`generate-tasks-json` skill](../../../.claude/skills/generate-tasks-json/SKILL.md).

---

## 2. Milestone-Driven Progress

- Every issue must be attached to a specific **Milestone** (e.g., `v1`). This allows the Product Owner to track the overall completion percentage of the release.
- The team's current milestone is set **once**, in the committed [`config.json`](config.json) next to the creation script — the script reads it from there. Rolling to the next release (`v1` → `v2`) is a **one-line change to that file**, not something anyone re-types per run.
- A single run can still be overridden without touching `config.json`, via the `--milestone` flag or the `MILESTONE` env var (see §8).

---

## 3. Issue Granularity & Domain Prefixes

The **granularity model** — one full-stack issue per PR, split by _what the change is_ (never by layer), kept from over-decomposing, plus the large-feature exception (a `parent` with vertical-slice sub-issues, the one place a Feature-Owner `assignee` is reasonable) — is generic issue-writing guidance and lives in the [`generate-tasks-json` skill](../../../.claude/skills/generate-tasks-json/SKILL.md). This section keeps the **project-specific** piece: the domain-prefix set.

---

### 3.1. Domain Prefixes

Every issue title begins with **exactly one domain prefix**, identifying _which part of the explorer_ the issue concerns. Prefixes survive full-stack issues (a prefix marks the **domain**, not a layer) and make the board scannable at a glance.

**Canonical set:**

| Prefix      | Domain                                                                               |
| ----------- | ------------------------------------------------------------------------------------ |
| `[HOME]`    | Homepage: metrics, latest-blocks/mempool/supply cards                                |
| `[BLOCKS]`  | Block list/details, visualblocks, sidechain, disapproved, windows, time-based blocks |
| `[TX]`      | Transaction details, decode/broadcast                                                |
| `[ADDRESS]` | Address overview / summary / charts / transactions                                   |
| `[MEMPOOL]` | Mempool page                                                                         |
| `[CHARTS]`  | Chart pipelines (VAR + SKA supply, etc.)                                             |
| `[STAKING]` | Ticketpool, ticket-price windows, rewards / yield                                    |
| `[PARAMS]`  | Parameters and attack-cost (chain config + calculators)                              |
| `[API]`     | Public HTTP / Insight API (the API as a product area)                                |
| `[INFRA]`   | Build, CI/CD, Docker, tooling                                                        |
| `[DOCS]`    | Wiki, README, CLAUDE.md, in-repo guides                                              |

**Rules:**

- Choose the **one dominant domain**. Do not combine prefixes (❌ `[BLOCKS][API]`).
- The set is **canonical**, but **governed-extensible**: add a new prefix only via a PR to this doc — the same rule §7.2 applies to labels. Keep the set aligned with the wiki's feature/code-analysis areas ([`wiki/index.md`](../../../wiki/index.md)); a genuinely new domain in the wiki is the signal to add a prefix here.

---

## 4. No Default Assignee — Self-Assign on Pickup

Strict frontend/backend ownership is not enforced, and issues are **not** assigned at creation. Any developer can take any issue they want.

---

### 4.1. Issues are created unassigned

- The creation script leaves new issues **unassigned** (no `assignee` in `tasks.json`).
- The unassigned issues form a shared **backlog / pool** that any developer pulls from.

---

### 4.2. Self-assign the moment you start

This is the convention that makes a no-default-assignee model work in practice:

- **Assign yourself when you pick up an issue** (and move its card to **In Progress** — §6).
- Assign-on-pickup, not assign-on-creation. One action signals "I own this now."

---

### 4.3. Pitfalls of unassigned issues — and how we counter them

A free-pick pool has known failure modes. We accept the model **with** these mitigations:

| Pitfall                                                                              | Mitigation                                                                                   |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Diffusion of responsibility** — unglamorous issues (bugs, refactors) sit unclaimed | **Self-assign on pickup** + periodic triage of the unassigned pool                           |
| **Cherry-picking** — easy/fun issues get grabbed, hard ones languish                 | Triage surfaces stale issues; pull from the top of the prioritized backlog, not the easy end |
| **Collision** — two developers start the same issue                                  | Self-assign **before** starting makes "taken" visible to everyone                            |
| **Board grouping breaks** — "Group by Assignee" (§6) shows one big unassigned column | Self-assign on pickup restores per-developer columns for in-progress work                    |
| **No follow-through owner** — nobody drives a stalled issue                          | The person who self-assigned owns it to completion (§4.4)                                    |
| **Notifications go dark** — GitHub pings the assignee on comments                    | Once self-assigned, the owner is notified of questions/blockers on the issue                 |
| **WIP hoarding** — one developer claims many at once                                 | Soft limit: keep **≤ 2 issues In Progress** per developer                                    |

---

### 4.4. Ownership once picked up

- An in-progress issue has **exactly one assignee** — the developer who picked it up.
- That assignee is responsible for: implementation, opening the PR, and driving the issue to completion.
- Cross-domain work is encouraged. Reviews should be performed by the most experienced developer in the relevant area.

---

## 5. No Direct Pushes to Master

- All code changes must be submitted via **Pull Requests (PR)**.
- Every PR should reference its corresponding issue number in the description (e.g., `Closes #12`). This triggers GitHub automation to move the issue to the **Done** column and close it automatically upon merge.

---

## 6. Project Board Management (Board View)

- The **Board** view is our primary tool for daily operations.
- **Status Integrity:** developers keep their cards updated:
  - Move to **In Progress** when work starts (and self-assign — §4.2)
  - Move toward **Review / Done** when a PR is opened
- **Group by Assignee:** view the board this way to visualize workload. New issues appear in an **unassigned** group (the shared pool); self-assigning on pickup moves a card into your column.

---

## 7. Labels

We use a **strict and predefined set of labels**. Only labels that already exist in the repository are allowed — if a label does not exist, the issue-creation script will fail.

---

### 7.1. Allowed labels

**Core labels:**

- `enhancement`
- `bug`
- `infrastructure`
- `documentation`
- `refactoring` (use only when behavior does not change)

---

### 7.2. Rules

- Only use labels from the approved list above.
- Do **not** introduce new labels without updating the repository first.
- Do **not** use generic or low-value labels such as: `duplicate`, `invalid`, `wontfix`, `question`, `good first issue`, `help wanted`.

---

### 7.3. Notes

- Labels are **optional**: set the one label matching the kind of change (`bug` / `enhancement` / `refactoring`) when it adds value; omitting `labels` leaves the issue unlabeled. Avoid over-labeling beyond that one kind label.
- Classification relies primarily on **structure** (single issue vs. Feature + sub-issues) and **domain prefixes** (§3.1). The `bug` / `enhancement` / `refactoring` labels carry the _kind_ of change; the prefix carries the _domain_. (`[INFRA]` / `[DOCS]` overlap the `infrastructure` / `documentation` labels — that redundancy is acceptable: the prefix scans on the board, the label filters.)

---

## 8. Automated Issue Creation

To speed up the creation of large milestones, we use a custom Node.js script ([`create-issues.js`](create-issues.js)) that reads a `tasks.json` file and handles parent/sub-issue linking via the GitHub API.

---

### 8.1. Prerequisites

- `brew install gh`
- `gh auth login`
- Node.js installed

---

### 8.2. Configuration (`config.json`)

Repo and milestone resolve, per setting, with this precedence:

```text
CLI flag (--repo / --milestone)  >  env var (REPO / MILESTONE)  >  config.json  >  built-in default
```

The committed [`config.json`](config.json) holds the team's standing values (the milestone is the current release — bump it per release):

```json
{
  "repo": "monetarium/monetarium-explorer",
  "milestone": "v2"
}
```

Everyone picks up the change via git.

---

### 8.3. JSON structure & rules

`tasks.json` declares an array of task objects, each with a unique string `id`.

**Types:**

- `parent` → Feature (large-feature exception only; must have sub-issues)
- `sub-issue` → Task linked to a parent (a vertical slice)
- `issue` → standalone full-stack task (**the default**)

**Rules:**

- Default to a **single `issue`** per piece of work; use `parent` + `sub-issue`s only for the large-feature exception — see the granularity model in the [`generate-tasks-json` skill](../../../.claude/skills/generate-tasks-json/SKILL.md).
- Every title carries **exactly one domain prefix** (§3.1).
- Do **not** split by layer or by developer specialization.
- **Omit `assignee`** — issues are created unassigned (§4). The one reasonable exception is a Feature Owner on a `parent`.

---

### 8.4. Example `tasks.json`

**The common case — a single full-stack issue (one PR):**

```json
{
  "tasks": [
    {
      "id": "fix-ticket-price-default",
      "type": "issue",
      "issue_type": "Task",
      "title": "[CHARTS] Default Tickets-Bought visibility to checked on Ticket Price chart",
      "description": "Full-stack fix. Spec/context: link the relevant wiki/specs or wiki/code-analysis (link, don't transcribe). Steps:\n\n- [ ] ...\n- [ ] ...\n\nAcceptance: lift the spec's acceptance checklist; note any hard invariant as a one-line 'must not regress' constraint and link the page (e.g. SKA atoms stay big.Int-derived strings) — implementation goes in the PR, not the issue.",
      "labels": ["bug"]
    }
  ]
}
```

Note: no `assignee` (unassigned pool), no per-task `milestone` (applied globally from `config.json`).

**The exception — a large feature split into vertical slices:**

```json
{
  "tasks": [
    {
      "id": "feature-blocks-list",
      "type": "parent",
      "issue_type": "Feature",
      "title": "[BLOCKS] Blocks List Page",
      "description": "Paginated list of blocks with VAR and SKA{n} metrics. Spec: wiki/specs/blocks-list/spec.md. Too large for one PR — delivered as the vertical slices below.",
      "assignee": "yanchenko-igor",
      "labels": ["enhancement"]
    },
    {
      "id": "blocks-list-table",
      "type": "sub-issue",
      "parent": "feature-blocks-list",
      "issue_type": "Task",
      "title": "[BLOCKS] Blocks list — main table (full-stack)",
      "description": "Full-stack slice: data + rendering + tests for the paginated block table. Acceptance: the spec's table checklist; note any block invariant as a one-line 'must not regress' constraint and link wiki/code-analysis.",
      "labels": ["enhancement"]
    },
    {
      "id": "blocks-list-detail-drawer",
      "type": "sub-issue",
      "parent": "feature-blocks-list",
      "issue_type": "Task",
      "title": "[BLOCKS] Blocks list — per-row detail drawer (full-stack)",
      "description": "Full-stack slice: the expandable per-block detail drawer, data through UI. Acceptance: the spec's drawer checklist.",
      "labels": ["enhancement"]
    }
  ]
}
```

Each sub-issue is a **vertical slice** that one developer ships in one PR — not a backend/frontend split of the same slice.

---

### 8.5. Running the script

```bash
cd .github/scripts/generate-issues

# Dry-run (validates and prints what WILL be created using deterministic mock IDs, no API calls):
node create-issues.js --dry-run

# Live run (uses config.json for repo + milestone; pauses for an interactive 'yes'):
node create-issues.js

# Resume a previous failed or interrupted run to prevent duplicate issues:
node create-issues.js --resume

# Skip the interactive confirmation (useful for CI):
node create-issues.js -y

# Override repo and/or milestone for a single run (takes precedence over config.json):
node create-issues.js --repo monetarium/monetarium-explorer --milestone v2
# (env vars also work: REPO=... MILESTONE=v2 node create-issues.js)
```

---

### 8.6. Lifecycle & cleanup

A `tasks.json` is a **transient input**, not a record (the source of truth is the GitHub Issues it creates, §1):

- All transient files live in one gitignored dir, **`.github/scripts/generate-issues/.local/`** (`tasks.json`, the resume state, the log, and `archive/`) — a single `.gitignore` entry, nothing committed.
- On a **successful live run**, the script removes the state file and **moves `tasks.json` into `.local/archive/`** (named `tasks-<milestone>-<timestamp>.json`). The default slot is then empty.
- So **a `tasks.json` sitting in the slot means a draft is pending or was abandoned** — never a base to extend. Start each new batch from a fresh file; overwrite a leftover rather than appending to it.
- Even `--dry-run` creates `.local/` and writes a log there: it makes **no GitHub API calls**, but is not entirely side-effect-free locally.
