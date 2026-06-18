# Wiki Maintenance Instructions

This file defines conventions for maintaining the **`wiki/code-analysis/`** knowledge base
produced by the mutation-analyzer skill. It is a reference for the human and for LLMs working on
wiki housekeeping — not part of the analysis skill itself.

**Scope.** The mutation-analyzer skill produces and maintains only `wiki/code-analysis/`. The
sibling trees are NOT produced by the skill and are out of scope here:

- `wiki/core/` — human-curated architecture, domain rules, and the canonical constraint list
  (`core/constraints.md`, C1…Cn). Hand-maintained.
- `wiki/specs/` — human-curated feature requirements and page specs. Hand-maintained.
- `wiki/index.md` — shared index covering all three trees. The skill updates only the
  `code-analysis` entries in it; the core/specs sections are maintained by humans.

The `code-analysis` tree grows incrementally — one feature at a time. There is no pre-defined
structure to fill in. Domains and files are created only when a real implementation session
produces knowledge worth preserving.

---

## Growth Model

`wiki/code-analysis/` is feature-driven, not domain-driven. When starting work on a new feature:

1. Run Interview + Explore using the mutation-analyzer skill.
2. Explore auto-chains into Synthesize, which writes the wiki file(s) for that area — you do
   not need to issue a separate `Synthesize:` trigger; generated files are the expected outcome
   of a completed Explore pass.
3. The skill updates the `code-analysis` entries in `wiki/index.md` in the same run.
4. Repeat for the next feature.

The directory structure emerges from this process. Do not create domains speculatively.

---

## Directory Structure

```
wiki/
  index.md            ← shared index; code-analysis section is skill-maintained
  core/               ← human-curated (NOT produced by the skill)
  specs/              ← human-curated (NOT produced by the skill)
  code-analysis/      ← produced and maintained by the mutation-analyzer skill
    <domain>/         ← created when the first synthesis for that area is saved
      flow.full.md
      flow.compact.md
      flow.<name>.full.md / flow.<name>.compact.md  (optional — genuinely distinct flows)
      patterns.md       (created at Synthesize time when reusable behavior is found)
      impact.md         (created at Synthesize time when mutation risk is found)
      <subarea>.impact.md (optional — a sub-area with its own blast radius,
                            e.g. summary.impact.md / transactions.impact.md / charts.impact.md)
```

**Domain naming:** name it after the feature area being modified, not after an abstract
architectural layer. Examples: `mempool/`, `voting-rewards/`, `supply-section/`, `block-table/`.
If a feature touches an existing domain, extend that domain's files rather than creating a new
one. Adding a new domain requires no justification — just add it to the index.

---

## File Types

| File | Purpose | Produced by |
|---|---|---|
| `flow.full.md` | Sections 1–8 from synthesis. Source of truth for this flow. | Synthesize |
| `flow.compact.md` | Section 9 from synthesis. For LLM context injection. | Synthesize |
| `patterns.md` | Reusable architectural behavior observed in this domain's flow(s). | Synthesize (per-domain); Consolidate normalizes cross-domain recurrence |
| `impact.md` / `<subarea>.impact.md` | Mutation risks for this domain (or a sub-area). | Synthesize (per-domain); Consolidate normalizes cross-domain recurrence |

Rules:

- Every Synthesize session always produces `flow.full.md` and `flow.compact.md`.
- Synthesize **also** creates or extends `patterns.md` / `impact.md` for the domain whenever
  the flow reveals reusable behavior or non-trivial mutation risk. **Single-domain is
  sufficient — there is no "appears in 2+ flows" precondition for creating these files.**
- A domain may have multiple impact files when distinct sub-areas have distinct blast radii
  (e.g. `summary.impact.md`, `transactions.impact.md`, `charts.impact.md`).
- A domain may have multiple named flow files if the flows are genuinely distinct
  (e.g. `flow.reward-calculation.full.md` + `flow.reward-calculation.compact.md`).
- Consolidate does NOT own creation of `patterns.md` / `impact.md`. It operates across the
  already-written per-domain files to normalize behavior/risks that recur in **2+ domains**:
  pick one canonical home, trim duplicates to references, and wire cross-links.
- Lint detects gaps (a flow that documents reusable behavior/risk but the domain lacks a
  `patterns.md` / `impact.md`, or un-normalized cross-domain recurrence) and flags them; the
  human decides whether to extend via Synthesize or run a Consolidate session.

---

## Index Conventions (`wiki/index.md`)

`wiki/index.md` indexes all three trees. The skill maintains only the **Code Traces**
(`code-analysis`) section; the Core and Specs sections are human-maintained. Each code-analysis
entry follows this format (paths are repo-root-relative, including the `code-analysis/` prefix):

```markdown
### mempool/
- [mempool flow](code-analysis/mempool/flow.full.md) — transaction table, fill indicators, WS data
- [mempool impact](code-analysis/mempool/impact.md) — mutation risks: WS payload, coin handling
```

Update the index every time a code-analysis file is created, extended, or merged. The index is
what the LLM reads to understand what knowledge already exists — keep it accurate.

---

## When to Update vs. Create

| Situation | Action |
|---|---|
| Working on a feature in an existing domain | Read existing flow files, then extend/update via Synthesize |
| Working on a feature with no existing domain | Synthesize creates the new `code-analysis/<domain>/` folder + files and adds them to the index |
| New findings extend an existing flow | Edit the existing `flow.full.md` / `flow.compact.md` (and `patterns.md` / `impact.md` if affected) |
| New findings contradict existing knowledge | Flag the conflict explicitly, then update |
| This domain's flow reveals reusable behavior | Synthesize writes/extends `code-analysis/<domain>/patterns.md` (no 2+ requirement) |
| This domain's flow reveals a non-trivial risk | Synthesize writes/extends `code-analysis/<domain>/impact.md` (or a `<subarea>.impact.md`) |
| Same behavior/risk recurs across 2+ domains | Run `Consolidate: <scope>` to normalize to one canonical home + cross-links |
| Lint flags a gap or un-normalized recurrence | Human triggers Synthesize (extend) or `Consolidate: <scope>` |

Never create a parallel file for a flow that already exists. Merge instead.

---

## Cross-Linking Format

Links are optional at the start. Add them when a genuine dependency between domains (or to
`core/constraints.md`) becomes apparent during synthesis or lint.

Place them in a `See also:` block at the bottom of the file, using repo-root-relative `/wiki/`
paths (matching the existing corpus):

```markdown
See also:
- /wiki/code-analysis/block-table/flow.full.md (shares-pattern-with: SKA aggregation logic)
- /wiki/code-analysis/voting-rewards/impact.md (depends-on: ticket price precision)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — float64 VAR vs big.Int SKA)
```

Link types: `depends-on`, `derived-from`, `shares-pattern-with`. If A links to B, check whether
B should reference A.

---

## Lint Schedule

Run `Lint: <scope>` using the mutation-analyzer skill when:

- You are about to modify a domain you haven't touched in several sessions.
- A synthesis produces results that feel inconsistent with existing knowledge.
- The wiki has grown enough that cross-domain dependencies are plausible (typically after 4–6
  domains exist).

Lint detects problems and flags gaps — it does not generate files itself. When Lint flags a
gap, the human decides whether to extend via Synthesize or run `Consolidate: <scope>`.

Lint is not automated — the human decides when to run it. Early in the project, lint is rarely
needed.

---

## Freshness Detection

Each `code-analysis/<domain>/` carries a `meta.yml` manifest so staleness can be detected
deterministically, without an LLM:

```yaml
domain: windows
anchor: 3cdba1e7          # commit the trace was last verified against
files:                    # repo-root-relative code paths this trace covers (globs allowed)
  - cmd/dcrdata/internal/explorer/blocks.go
  - db/dcrpg/blockstats.go
```

`dev/wiki-staleness.sh` runs `git log <anchor>..HEAD -- <files>` per domain and reports
**STALE** (a covered file changed since the anchor), **FRESH**, or **UNTRACKED** (no
`meta.yml`). It never edits traces and never calls the LLM. A warn-only `dev/hooks/pre-push`
runs it scoped to the commits being pushed. The hook uses `--changed <range>` to restrict the
report to domains whose covered files changed within a git commit range; this flag is also usable
directly. Pass `--strict` to make the detector exit non-zero when anything is stale or has an
invalid anchor; set `WIKI_STALENESS_STRICT=1` to make the pre-push hook block instead of warn.

**Reading the signal:** STALE means a covered file moved since the anchor — a prompt to review,
not proof the trace is wrong. Because manifests track whole files, a high-churn shared file
(e.g. `db/dcrpg/pgblockchain.go`, listed by several domains) marks all of them STALE on any
change to it, even one unrelated to a given trace's concern.

Refreshing a STALE trace runs the `mutation-analyzer` skill's **`Refresh: <domain>`** trigger:
it reads the anchor, re-traces the domain's flow end to end (prioritizing what changed since the
anchor, and picking up newly-covered files), updates the trace files in place, and bumps
`meta.yml` (`anchor` → current `HEAD`, refresh `files`). Detection and refresh move
together — the anchor is the "as-of" contract. (If the trace still holds and only the anchor
lagged, the refresh just bumps the anchor — no prose churn.)

Seed a missing manifest with `./dev/wiki-staleness.sh --bootstrap`, then review the generated
`files` list against the trace (the regex seeds candidates; it is not authoritative).

---

## What This File Is NOT

- It does not define how analysis works — that is the mutation-analyzer skill
  (`.claude/skills/mutation-analyzer/SKILL.md`).
- It does not enforce rules during Explore or Interview mode.
- It does not govern `wiki/core/` or `wiki/specs/` — those are human-curated.
- It is not read automatically by the LLM. Load it into context when doing `code-analysis`
  housekeeping or before a synthesis session where existing wiki files are relevant.
