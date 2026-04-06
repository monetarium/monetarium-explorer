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
