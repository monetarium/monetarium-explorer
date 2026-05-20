# CI/CD Pipeline

This document describes the current state of the Monetarium Explorer CI/CD automation, quality gates, and distribution pipeline.

## 🤖 Board Automation

The `Board Automation` workflow (`.github/workflows/board-automation.yml`) streamlines issue management by synchronizing PR merges with issue status.

- **Triggers**: Occurs when a pull request is **closed** and **merged** into the `develop` or `main` branches.
- **Behavior**: It identifies all issues linked to the PR (via "closes #X" or similar keywords) and automatically transitions them to the `closed` state.

## 🏗️ Build & Quality Gates

The `Build` workflow (`.github/workflows/build.yml`) ensures codebase integrity across Go and Node.js environments.

### Backend (Go)
- **Matrix**: Builds and tests are run against multiple Go versions (e.g., `1.24`, `1.25`) to ensure compatibility.
- **Verification**: Runs standard Go tests and linting.

### Frontend (Node.js)
The frontend build process follows a strict sequential quality gate to prevent regressions:
1. **Install**: `npm clean-install` ensures a reproducible dependency tree.
2. **Check**: `npm run check` (Prettier, ESLint, Stylelint) validates formatting and static analysis.
3. **Test**: `npm run test` executes the Vitest suite in a jsdom environment.
4. **Build**: `npm run build` bundles assets via Webpack only if all previous steps pass.

## 🐳 Docker Distribution

Docker images are built and distributed via the `Docker Build and Push` workflow (`.github/workflows/docker.yml`).

### Registry
Images are tagged for the **GitHub Container Registry (GHCR)**: `ghcr.io/<owner>/monetarium-explorer`.

### Tagging Strategy
Images are tagged dynamically based on the git context:
- **Commit SHA**: Every successful build is tagged with the unique git commit SHA for traceability.
- **Latest**: The `main` branch is additionally tagged as `latest`.
- **Hotfix**: Branches matching the `hotfix/*` pattern are tagged with a sanitized version of the branch name (e.g., `hotfix/ios-fix` $\rightarrow$ `hotfix-ios-fix`).

### Push Policy
To maintain registry hygiene and stability, images are only pushed to GHCR when the build originates from:
- The `main` branch.
- Any `hotfix/*` branch.

Builds on other branches (e.g., `develop` or feature branches) are validated for buildability but are **not** pushed to the registry.
