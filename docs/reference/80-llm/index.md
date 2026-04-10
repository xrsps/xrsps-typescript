# 80 — LLM quick index

This section is written for machine consumption. Every page is a dense table rather than prose, designed to be pasted directly into an LLM context to give it a complete mental model of the codebase without loading the full narrative reference.

Humans can read these pages too — they're just denser than [10](../10-client/) through [70](../70-examples/).

## Pages

| Page | Purpose |
|---|---|
| [01 — Glossary](./01-glossary.md) | Terms that show up everywhere |
| [02 — File index](./02-file-index.md) | Every subsystem → the key files |
| [03 — Symbol table](./03-symbol-table.md) | Public classes / functions / types → the file that owns them |
| [04 — Quick lookup](./04-quick-lookup.md) | "I want to X" → the file to read |
| [05 — Conventions](./05-conventions.md) | Naming, layering, module boundaries |

## How to use these pages with an LLM

- **Before writing code**: paste [02 — File index](./02-file-index.md) and [03 — Symbol table](./03-symbol-table.md) into the system prompt. The LLM can then reference exact symbols and paths instead of guessing.
- **Before reading a new subsystem**: paste [04 — Quick lookup](./04-quick-lookup.md) to get a fast pointer to the right page.
- **For naming decisions**: [05 — Conventions](./05-conventions.md) is the style guide.
- **For domain terminology**: [01 — Glossary](./01-glossary.md) has the OSRS-flavored vocabulary (loc, obj, npc, varp, varbit, etc.).

All tables are markdown and round-trip cleanly through a paste buffer.
