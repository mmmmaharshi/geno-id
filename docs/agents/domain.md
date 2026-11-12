# Domain Docs

This file explains how engineering skills consume domain documentation.

## Before exploring, read these

- Read `GLOSSARY.md` at the repository root.
- Read relevant ADRs from `docs/adr/`.
- If these files do not exist, proceed silently.

## File structure

This repository uses a single-context layout:

```
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use domain terms defined in `GLOSSARY.md` in issues, proposals, hypotheses, and test names.

If a required concept is missing, reconsider the term or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an ADR, state the conflict explicitly.
