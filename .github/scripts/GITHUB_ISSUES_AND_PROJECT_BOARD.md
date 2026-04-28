## Rules for GitHub Issues & Project Board

To maintain a professional and transparent development process for the **Monetarium Explorer**, the team adheres to the following rules:

---

### 1. Single Source of Truth

- All feature discussions, bug reports, and technical decisions must take place within **GitHub Issues**, not in external messengers. This ensures a searchable history for the client and the team.

---

### 2. Milestone-Driven Progress

- Every issue must be attached to a specific **Milestone** (e.g., `v1`). This allows the Product Owner to track the overall completion percentage of the release.

---

### 3. Assignment Principle

- **One Responsible Person per Issue:** Each issue must have exactly **one assignee**.
- Assignment defines ownership and responsibility for delivery.
- Detailed assignment rules are defined in **Section 3**.

---

### 4. No Direct Pushes to Master

- All code changes must be submitted via **Pull Requests (PR)**.
- Every PR should reference its corresponding issue number in the description (e.g., `Closes #12`). This triggers GitHub automation to move the issue to the **Done** column and close it automatically upon merge.

---

### 5. Project Board Management (Board View)

- The **Board** view is our primary tool for daily operations.
- **Status Integrity:** Developers are responsible for keeping their cards updated:
  - Move to **In Progress** when work starts
  - Move toward **Review/Done** when a PR is opened

- **Group by Assignee:** The board should be viewed using this setting to clearly visualize workload distribution.

---

## 6. Flexible Issue Structure per Feature

To support scalable and realistic development workflows, we use a **two-level issue hierarchy**:

---

### 6.1. Feature (Parent Issue)

- A **Feature** represents a complete, user-visible functionality (e.g., “Blocks List Page”, “Homepage Latest Blocks”).
- Each Feature is created as a **parent issue** with `issue_type: Feature`.
- A Feature must have:
  - a clear description of scope
  - exactly **one assignee** (Feature Owner)

**Feature Owner responsibilities:**

- overall coordination
- ensuring all sub-issues are completed
- integration into a working result

---

### 6.2. Sub-issues (Implementation Tasks)

- A Feature can have **any number of sub-issues** (no fixed limit).

- Each sub-issue represents a **concrete, executable unit of work**:
  - should be completable in a single PR
  - should not require deep implicit knowledge from other issues

- Sub-issues are created with:
  - `type: sub-issue`
  - `issue_type: Task`

**Examples:**

- Data aggregation / business logic
- Database queries and optimization
- API / WebSocket layer
- UI rendering (templates, controllers)
- Client-side behavior

---

### 6.3. Structure Constraints

- Only **two levels are allowed**:
  - Feature → Sub-issues

- ❌ No nested sub-tasks or deeper hierarchies

- If a Feature is small:
  - it may consist of a **single issue without sub-issues**
  - internal steps can be described using checkboxes

---

### 6.4. Naming Convention (Prefixes)

To improve readability and board navigation, sub-issues must use prefixes:

- `[API]`
- `[DB]`
- `[UI]`
- `[WS]`
- `[DATA]`

**Example:**

```text
[API] Blocks list endpoint
[UI] Blocks table rendering
[DB] Optimize blocks query
```

---

### 6.5. Prefix Selection Rule (Single Responsibility)

Each sub-issue must use **exactly one prefix**.

Prefixes do **not** represent all affected parts of the system. They must reflect the **primary area of responsibility** — where the main work is performed.

**Rules:**

- Always choose **one dominant prefix**
- Do **not** combine prefixes (e.g., ❌ `[API][DB][UI]`)
- If a task spans multiple domains equally:
  - split it into multiple sub-issues

---

### 6.6. How to Choose the Prefix

Select the prefix based on the **initiator of the change**:

- `[API]` — endpoint or data contract
- `[DB]` — queries, indexing, performance
- `[UI]` — rendering, templates, interaction
- `[WS]` — WebSocket / real-time updates
- `[DATA]` — aggregation, transformation, internal logic

---

### 6.7. Splitting Rule

Instead of:

```text
[API][UI] Add sorting to blocks list
```

Do:

```text
[API] Add sorting support to blocks endpoint
[UI] Implement sorting in blocks table
```

---

## 7. Developers & Assignment Strategy

To reflect the evolving workflow, strict frontend/backend ownership is no longer enforced.

---

### 7.1. General Principle

- Any developer can work on any issue
- Assignment defines **responsibility**, not specialization
- Code review ensures cross-domain quality

---

### 7.2. Prefix-Based Assignment (Recommended)

Assignments should be guided by the **issue prefix**, but also balanced across the team.

**Preferred mapping:**

- `[DB]`, `[DATA]`, `[WS]`, `[API]` → preferably assign to **yanchenko-igor**
- `[UI]` → preferably assign to **edshav**

---

**Balancing rule:**

- Do not strictly follow the preferred mapping if it creates workload imbalance
- If one developer becomes a bottleneck:
  - issues should be reassigned to the other developer

- Load balancing has higher priority than specialization

---

**Goal:**

- Maintain steady delivery flow
- Avoid bottlenecks
- Encourage cross-domain contribution

---

### 7.3. Important Constraints

- This mapping is a **guideline, not a restriction**
- Do **not** split or reassign issues purely based on specialization
- Do **not** create additional sub-issues just to match assignment preferences

---

### 7.4. Assignment Responsibility

- Each issue must have **exactly one assignee**
- The assignee is responsible for:
  - implementation
  - opening the PR
  - driving the issue to completion

---

### 7.5. Flexibility in Practice

- Developers may take issues outside their “preferred” area
- Cross-domain work is encouraged
- Reviews should be performed by the most experienced developer in the relevant area

---

### 7.6. Labels

We use a **strict and predefined set of labels**.

Only labels that already exist in the repository are allowed.
If a label does not exist, the issue creation script will fail.

---

#### Allowed labels

**Core labels:**

- `enhancement`
- `bug`
- `infrastructure`
- `documentation`
- `refactoring` (should be used only when behavior does not change)

---

#### Rules

- Only use labels from the approved list above
- Do **not** introduce new labels without updating the repository first
- Do **not** use generic or low-value labels such as:
  - `duplicate`
  - `invalid`
  - `wontfix`
  - `question`
  - `good first issue`
  - `help wanted`

---

#### Notes

- Labels are **optional** and should be used only when they add value
- Over-labeling should be avoided
- Issue classification should rely primarily on:
  - structure (Feature / sub-issue)
  - prefixes (`[API]`, `[DB]`, etc.)

---

## 8. Automated Issue Creation

To speed up the creation of large milestones, we use a custom Node.js script (`.github/scripts/create-issues.js`) that reads a `tasks.json` file and handles parent/sub-issue linking via the GitHub API.

---

### 8.1. Prerequisites

- `brew install gh`
- `gh auth login`
- Node.js installed

---

### 8.2. JSON Structure & Rules

Your `tasks.json` must declare an array of task objects. Each task requires a unique string `id`.

**Types:**

- `parent` → Feature
- `sub-issue` → Task linked to parent
- `issue` → standalone task

---

### 8.3. Important Rules

- Sub-issues must follow the **prefix naming convention**
- Issue structure must follow the **two-level hierarchy**
- Do **not** split tasks based on developer specialization
- Sub-issues should reflect **system boundaries** (API, DB, UI, etc.), not roles
- Assignment should follow the **Prefix-Based Assignment rule**, but may be adjusted for balance

---

### 8.4. Example `tasks.json`

```json
{
  "tasks": [
    {
      "id": "feature-blocks-list",
      "type": "parent",
      "issue_type": "Feature",
      "title": "Blocks List Page",
      "description": "Display a paginated list of blocks with VAR and SKA{n} metrics.",
      "assignee": "yanchenko-igor",
      "labels": ["enhancement"]
    },
    {
      "id": "blocks-data-aggregation",
      "type": "sub-issue",
      "parent": "feature-blocks-list",
      "issue_type": "Task",
      "title": "[DATA] Aggregate block data for list page",
      "description": "Prepare structured block data including VAR and SKA{n} values.",
      "assignee": "yanchenko-igor",
      "labels": ["enhancement"]
    },
    {
      "id": "blocks-db-query",
      "type": "sub-issue",
      "parent": "feature-blocks-list",
      "issue_type": "Task",
      "title": "[DB] Optimize blocks query for list page",
      "description": "Ensure efficient retrieval of block data from PostgreSQL.",
      "assignee": "yanchenko-igor",
      "labels": ["enhancement"]
    },
    {
      "id": "blocks-api-endpoint",
      "type": "sub-issue",
      "parent": "feature-blocks-list",
      "issue_type": "Task",
      "title": "[API] Blocks list endpoint",
      "description": "Expose aggregated block data via API endpoint.",
      "assignee": "yanchenko-igor",
      "labels": ["enhancement"]
    },
    {
      "id": "blocks-ui-table",
      "type": "sub-issue",
      "parent": "feature-blocks-list",
      "issue_type": "Task",
      "title": "[UI] Blocks table rendering",
      "description": "Render blocks table using templates and Stimulus controllers.",
      "assignee": "edshav",
      "labels": ["enhancement"]
    },
    {
      "id": "blocks-ui-pagination",
      "type": "sub-issue",
      "parent": "feature-blocks-list",
      "issue_type": "Task",
      "title": "[UI] Implement pagination for blocks table",
      "description": "Add pagination controls and behavior to the blocks list page.",
      "assignee": "edshav",
      "labels": ["enhancement"]
    }
  ]
}
```

---

### 8.5. Running the script

```bash
cd .github/scripts

# Dry-run (validates and prints what WILL be created using deterministic mock IDs, no API calls):
node create-issues.js --dry-run

# Live run (uses defaults: tasks.json, repo and milestone from script config):
# Will pause to ask for interactive 'yes' confirmation.
node create-issues.js

# Resume a previous failed or interrupted run to prevent duplicate issues:
node create-issues.js --resume

# Skip the interactive confirmation prompt (useful for CI execution):
node create-issues.js -y

# Override repo and/or milestone via environment variables:
REPO="monetarium/monetarium-explorer" MILESTONE="v2" node create-issues.js
```
