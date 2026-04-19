# Wiki Maintenance Instructions

This file defines conventions for maintaining the `/wiki/` knowledge base produced by the
mutation-analyzer skill. It is a reference for the human and for LLMs working on wiki
housekeeping — not part of the analysis skill itself.

The wiki grows incrementally — one feature at a time. There is no pre-defined structure to
fill in. Domains and files are created only when a real implementation session produces
knowledge worth preserving.

---

## Growth Model

The wiki is feature-driven, not domain-driven. When starting work on a new feature:

1. Run Interview + Explore + Synthesize using the mutation-analyzer skill.
2. The synthesis output becomes the first (or updated) wiki file for that area.
3. Add the file to `index.md`.
4. Repeat for the next feature.

The directory structure emerges from this process. Do not create domains speculatively.

---

## Directory Structure

```
/wiki/
  index.md        ← source of truth; always update when adding files
  <domain>/       ← created when the first synthesis for that area is saved
    flow.full.md
    flow.compact.md
    patterns.md     (optional — only when a pattern appears across 2+ flows)
    impact.md       (optional — only when mutation risks are explicitly identified)
```

**Domain naming:** name it after the feature area being modified, not after an abstract
architectural layer. Examples: `mempool/`, `voting-rewards/`, `supply-section/`, `block-table/`.
If a feature touches an existing domain, extend that domain's files rather than creating a new one.

Adding a new domain requires no justification — just add it to the index.

---

## File Types

| File              | Purpose                                                     | When to create                            |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `flow.full.md`    | Sections 1–8 from synthesis. Source of truth for this flow. | Always — first output of every synthesis  |
| `flow.compact.md` | Section 9 from synthesis. For LLM context injection.        | Always — alongside full                   |
| `patterns.md`     | Reusable behavior appearing in 2+ flows.                    | Only when duplication is observed         |
| `impact.md`       | Mutation risks for this domain.                             | Only when risks are explicitly identified |

Rules:

- Flow files do not contain reusable patterns — extract those to `patterns.md` when the time comes.
- Mutation risks belong in `impact.md`, not scattered across flow files.
- A domain can have multiple named flow files if the flows are genuinely distinct (e.g. `flow.reward-calculation.full.md`).

---

## Index Conventions (`index.md`)

Start with an empty index and add entries as files are created. Each entry follows this format:

```markdown
### mempool/

- [mempool flow](mempool/flow.full.md) — transaction table, block-fill indicators, WebSocket data
- [mempool impact](mempool/impact.md) — mutation risks: WebSocket payload, coin type handling
```

Update the index every time a file is created, extended, or merged. The index is what the
LLM reads to understand what knowledge already exists — keep it accurate.

---

## When to Update vs. Create

| Situation                                    | Action                                                |
| -------------------------------------------- | ----------------------------------------------------- |
| Working on a feature in an existing domain   | Read existing flow files, then extend or update       |
| Working on a feature with no existing domain | Create new domain folder and flow files, add to index |
| New findings extend an existing flow         | Edit the existing `flow.full.md`                      |
| New findings contradict existing knowledge   | Flag the conflict explicitly, then update             |
| Same logic appears in 2+ flow files          | Extract to `patterns.md`, link from both flows        |
| Mutation risk identified during synthesis    | Create or update `impact.md` for that domain          |

Never create a parallel file for a flow that already exists. Merge instead.

---

## Cross-Linking Format

Links are optional at the start. Add them when a genuine dependency between domains becomes
apparent during synthesis or lint.

When adding links, place them in a `See also:` block at the bottom of the file:

```markdown
See also:

- /wiki/block-table/flow.full.md (shares-pattern-with: SKA aggregation logic)
- /wiki/voting-rewards/impact.md (depends-on: ticket price precision handling)
```

Link types: `depends-on`, `derived-from`, `shares-pattern-with`

If A links to B, check whether B should reference A.

---

## Lint Schedule

Run `Lint: <scope>` using the mutation-analyzer skill when:

- You are about to modify a domain you haven't touched in several sessions.
- A synthesis produces results that feel inconsistent with existing knowledge.
- The wiki has grown enough that cross-domain dependencies are plausible (typically after 4–6 domains exist).

Lint is not automated — the human decides when to run it. Early in the project, lint is rarely needed.

---

## What This File Is NOT

- It does not define how analysis works — that is the mutation-analyzer skill.
- It does not enforce rules during Explore or Interview mode.
- It is not read automatically by the LLM. Load it into context when doing wiki housekeeping
  or before a synthesis session where existing wiki files are relevant.
