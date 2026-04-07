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

### 6. Automated Issue Creation

To speed up the creation of large milestones, we use a custom Bash script (`.github/scripts/create_issues.sh`) that reads a `tasks.json` file and handles parent/sub-issue linking natively via the GitHub API.

#### Prerequisites
- `brew install jq gh`
- `gh auth login`

#### JSON Structure & Rules

You can define three types of issues in your `tasks.json`:
- **`parent`**: High-level feature group. Defaults to the "Feature" org issue-type.
- **`sub-issue`**: Specific developer task. Linked natively to a parent using the zero-based array index of the parent. Defaults to "Task" org issue-type.
- **`issue`**: A standalone task with no parent. Defaults to "Task" org issue-type.

**Example `tasks.json`:**
```json
{
  "tasks": [
    {
      "type": "parent",
      "issue_type": "Feature",
      "title": "Feature group title",
      "description": "High-level description of the feature.",
      "assignee": "github-username",
      "labels": ["enhancement"]
    },
    {
      "type": "sub-issue",
      "issue_type": "Task",
      "title": "Implement specific part",
      "description": "Detailed task description.",
      "assignee": "github-username",
      "labels": ["enhancement"],
      "parent": 0
    }
  ]
}
```

#### Running the script

The tool features robust title-based idempotency, validation checks, and automatic rate-limit processing. All API activity and errors are permanently recorded to `create_issues.log`. If the script encounters a failure it preserves its internal state file and emits a non-zero exit code to fail any associated CI pipelines.

**Note on Resuming**: By default, standard live runs will reset the state file automatically to protect against stale data. Use the `--resume` flag if you are intentionally recovering a previously failed workflow.

```bash
cd .github/scripts

# Dry-run (validates and prints what WILL be created, no API calls):
bash create_issues.sh --dry-run
bash create_issues.sh --dry-run --file my_tasks.json

# Live run (uses defaults: tasks.json, repo and milestone from script config):
# Will pause to ask for interactive 'yes' confirmation.
bash create_issues.sh

# Skip the interactive confirmation prompt (useful for CI execution):
bash create_issues.sh -y

# Resume from a partial failure (skips titles already successfully created):
bash create_issues.sh --resume

# Override repo and/or milestone via environment variables:
REPO="monetarium/monetarium-explorer" MILESTONE="v2" bash create_issues.sh
```
