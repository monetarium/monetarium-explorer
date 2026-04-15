## Rules for GitHub Issues & Project Board

To maintain a professional and transparent development process for the **Monetarium Explorer**, the team adheres to the following rules:

### 1. Single Source of Truth

- All feature discussions, bug reports, and technical decisions must take place within **GitHub Issues**, not in external messengers. This ensures a searchable history for the client and the team.

### 2. Milestone-Driven Progress

- Every issue must be attached to a specific **Milestone** (e.g., `v1`). This allows the Product Owner to track the overall completion percentage of the release.

### 3. Clear Assignment Logic (Assignees)

- **One Responsible Person per Issue:** To avoid "shared bypass" where no one takes action, every issue must have exactly **one** assignee.
- **Sub-issues:** Assigned to the specific developer writing the code or performing the task (e.g., frontend or backend specialist).
- **Parent Issues:** Must also have an assignee. This person acts as the **"Feature Owner"** or **"Curator"**.
  - The Parent Issue assignee is responsible for the high-level integration and ensuring all sub-issues work together as a finished module.
  - Usually, this is the Lead developer or the person responsible for the most critical sub-task within that block.

### 4. No Direct Pushes to Master

- All code changes must be submitted via **Pull Requests (PR)**.
- Every PR should reference its corresponding issue number in the description (e.g., `Closes #12`). This triggers GitHub automation to move the issue to the **Done** column and close it automatically upon merge.

### 5. Project Board Management (Board View)

- The **Board** view is our primary tool for daily operations.
- **Status Integrity:** Developers are responsible for keeping their cards updated. When you start working on a task, move it to **In Progress**. When finished and a PR is opened, it moves toward **Review/Done**.
- **Group by Assignee:** The board should be viewed using the "Group by: Assignee" setting to clearly visualize the workload distribution between Team Members.

### 6. Issue Count per Feature

Every feature maps to either one or three issues — never two or four.

- **Multi-domain feature** (touches both backend and frontend): one parent issue + one backend sub-issue + one frontend sub-issue.
- **Single-domain feature** (touches only backend or only frontend): one parent issue only, no sub-issues. Internal breakdown goes into checkboxes within the parent.

### 7. Automated Issue Creation

To speed up the creation of large milestones, we use a custom Node.js script (`.github/scripts/create-issues.js`) that reads a `tasks.json` file and handles parent/sub-issue linking natively via the GitHub API.

#### Prerequisites

- `brew install gh`
- `gh auth login`
- Node.js installed

#### JSON Structure & Rules

Your `tasks.json` must declare an array of task objects. Each task requires a unique string `id` to safely resolve parent relationships transparently regardless of array order. 

You can define three types of issues in your `tasks.json`:

- **`parent`**: High-level feature group. Defaults to the "Feature" org issue-type.
- **`sub-issue`**: Specific developer task. Linked natively to a parent using the parent's string `id`. Defaults to "Task" org issue-type.
- **`issue`**: A standalone task with no parent. Defaults to "Task" org issue-type.

**Example `tasks.json`:**

```json
{
  "tasks": [
    {
      "id": "feature-auth",
      "type": "parent",
      "issue_type": "Feature",
      "title": "Auth Feature Group",
      "description": "High-level description of the feature.",
      "assignee": "yanchenko-igor",
      "labels": ["enhancement", "backend"]
    },
    {
      "id": "task-auth-front",
      "type": "sub-issue",
      "parent": "feature-auth",
      "issue_type": "Task",
      "title": "Implement Frontend Auth",
      "description": "Detailed task description.",
      "assignee": "edshav",
      "labels": ["enhancement", "frontend"]
    }
  ]
}
```

#### Running the script

The tool features robust ID-based idempotency, validation checks, legacy state auto-migration, and automatic rate-limit processing. All API activity and errors are permanently recorded to `create_issues.log`. If the script encounters a failure it isolates the error, gracefully processes the rest of the stack, and preserves its internal state file so you can retry flawlessly.

**Note on Resuming**: If a previous run failed or was interrupted, use the `--resume` flag to read the existing state file (`.create_issues_state.json`). This ensures the script will skip tasks that were already created and linked, preventing duplicates. The state file is automatically cleaned up upon a completely flawless execution run. Without `--resume`, the script will start fresh and ignore any existing state.

```bash
cd .github/scripts

# Dry-run (validates and prints what WILL be created using deterministic mock IDs, no API calls):
node create-issues.js --dry-run
node create-issues.js --dry-run --file my_tasks.json

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

### 8. Reference: Developers & Labels

**Developers (Assignees):**
- **yanchenko-igor**: Backend, DevOps
- **edshav**: Frontend

**Available Labels:**
- `infrastructure`
- `backend`
- `bug`
- `documentation`
- `duplicate`
- `enhancement`
- `frontend`
- `good first issue`
- `help wanted`
- `invalid`
- `question`
- `wontfix`
