# CODING_STANDARDS

> **Before you claim done**: name the rules this diff touches and say how it satisfies each. A rule you did not check is not satisfied.

- **YAGNI** : Build only what the current requirement needs, and let every abstraction pay for itself now.
- **KISS** : Choose the simplest implementation that fully meets the requirement, and keep it readable while it stays short.
- **No Backward Compatibility** : Delete an obsolete code path in the change that retires it. One shape per behaviour, with compatibility layers, fallbacks, and migrations appearing only when the requirement names them.
- **Dependency Management** : Use the libraries already in the tree, and read their types and docs before reaching past them. Add a package when its benefit outstrips the maintenance, security, and complexity it brings.
- **Incremental Development** : Land small, verified steps, and keep the system working at every one.
- **Separation of Concerns (SRP)** : Give each module, function, and component one clear responsibility, and keep unrelated concerns in separate places.
- **Rationale Comments** : Comment the why the code cannot show: a non-obvious decision, a constraint, a trade-off, a workaround. The code carries the what.
- **Atomic Commits** : One logical change per commit, with no unrelated refactoring or formatting.
- **Conventional Commits** : Use a consistent commit message format that follows the Conventional Commits specification.
- **Behavioral Testing** : Test what a caller can observe, and give each test a failure reason of its own that no sibling test shares.
- **No Change Detector Tests** : A test fails when behaviour breaks, not when the code moves. Assert what a caller sees, never the calls made inside, their order, or a snapshot of internals.
- **Acceptance Criteria** : Cover the cases the specification names, and keep existing tests green unless the change requires updating them.
- **Evidence-Based Verification** : Reproduce the bug before fixing it, then confirm the fix through a real workflow, screenshot, or measurement. Claim success with the evidence in hand.
- **DRY (Don't Repeat Yourself)** : Keep each piece of business knowledge in one place, and extract shared logic where it improves clarity and maintainability.
- **Explicit over Implicit** : Make behaviour, dependencies, and defaults visible at the call site.
- **Fail Fast** : Validate inputs at the boundary and detect invalid states early, reporting the error where it originated.
- **Least Surprise** : Follow established conventions, so behaviour matches what the reader already expects.
- **Minimal Surface Area** : Expose only the APIs, configuration, and interfaces that callers need.
- **Stable Function Signatures** : Keep signatures stable so a change does not churn every caller. Prefer a named option over a boolean flag, and break a signature deliberately when the requirement demands it.
- **Command-Query Separation** : A function either changes state and returns nothing, or answers a question and changes nothing.
- **Type Safety** : Let the type system carry the contract, and keep casts, assertions, and untyped values out of the code.
- **Error Handling** : Handle an error at the boundary that can act on it, and report success only for an operation that succeeded and was verified.
- **Security by Default** : Validate untrusted input, enforce access controls, and keep secrets and sensitive data out of logs and client code.
- **Observability** : Log, measure, or trace where it diagnoses a real operational problem, and keep the signal free of redundant noise.
- **Deterministic Testing** : Make tests repeatable: no dependence on execution order, live external services, or arbitrary delays.
- **Regression Testing** : Fix a bug with a focused test that fails before the fix and guards the same failure afterwards.
- **Documentation Accuracy** : Update documentation in the same change that makes it wrong.
- **Principle Precedence** : Correctness, security, and explicit requirements outrank simplicity. When principles conflict, choose the solution that meets the requirement with the least unnecessary complexity.
- **Evidence-Based Performance Optimization** : Measure real user journeys, identify the highest-impact bottleneck, form a hypothesis, and make the smallest safe change. Benchmark before and after, retain only measurable improvements, add a guardrail for each, and repeat until the target is met.
- **Defer Concurrency Until Measured** : Parallelise independent I/O when measurement shows it is the bottleneck, preserving error and ordering semantics.
- **Make Illegal States Unrepresentable** : Model lifecycle and status as explicit states with no illegal combination and a clear transition table, in place of scattered booleans, strings, or phase checks.

# Codebase Slop Indicators / Anti-patterns

- implicit coupling
- layer-first folders
- duplication
- representable illegal states
- god files
- shotgun surgery
- layering violations
- pass-through wrappers
- errors / validation not at the boundary
- change detector tests
