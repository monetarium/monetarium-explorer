# Stage 6 — TypeScript (Optional)

**Effort**: Large · **Parallelizable**: No · **Depends on**: Stage 3 (structure settled)

**Not yet committed.** This doc scopes the options so the decision can be made after Stage 3.

---

## Options

### A: Full TypeScript migration

Retype every `.js` file as `.ts`, add `ts-loader` to webpack config, install `typescript`,
configure `tsconfig.json`, and fix all type errors.

**Pros**: Full IDE support, compile-time type checking, catches null refs and shape mismatches.
**Cons**: ~80+ files to convert, webpack config changes, CI type-check step, learning curve for
current developers.

### B: JSDoc-based typing (recommended first step)

Add JSDoc type annotations to existing `.js` files and run `tsc --noEmit` to catch errors, without
changing the build pipeline.

**Pros**: Zero build changes, incremental adoption, works with existing Babel/ESLint/Vitest config.
Type errors caught in CI and editor (via `// @ts-check` or `tsc --noEmit`).
**Cons**: No `.ts` syntax (generics, enums, etc.), verbosity of JSDoc for complex types.

### C: Hybrid (recommended)

JSDoc first for the largest, most error-prone files (`address_controller`, `charts_controller`,
`humanize_helper`). Then consider full `.ts` migration for new controllers.

---

## Decision criteria

- Complexity of type definitions for the backend API payload shapes (these are not typed anywhere)
- Team comfort with TypeScript vs JSDoc
- Whether the webpack/Babel pipeline change is worth the ongoing maintenance burden

Revisit this decision after Stage 3 is complete and the module structure is stable.
