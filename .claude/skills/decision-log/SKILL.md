---
name: decision-log
description: Record a design decision in docs/decisions.md using this project's D-number convention, or supersede an earlier one. Use when a design choice has just been made and should be written down, when a previous decision turns out to be wrong, or when cross-linking a decision from another document. Covers the entry format, the next-number lookup, and GitHub's anchor slug rules.
---

# Recording a decision

`docs/decisions.md` is an append-only log. Entries are numbered `D1`, `D2`, … and referenced
by anchor from the roadmap, the specs, and the READMEs.

## Find the next number

```bash
grep -n '^### D' docs/decisions.md | tail -1
```

The next entry is that number plus one. Never reuse a number, and never renumber.

## The entry format

Append to the end of the file, after a `---` separator:

```markdown
---

### D<n> — <Title in sentence case>

*Added <YYYY-MM-DD> during the <what> session.*

<One or two paragraphs: what was decided, stated as a fact about the system rather than as a
proposal. Say what it means in practice.>

*Rejected:* <the alternative>. <Why it lost — the specific cost, not a general preference.>

*Rejected:* <another alternative, if there was one>. <Why.>
```

Every entry needs at least one `*Rejected:*` paragraph. A decision with no rejected alternative
was not a decision; it was a default, and it does not need an entry.

Optional closing paragraphs, when they apply:

- `*What this accepts:*` — the known downside you are choosing to live with.
- `*Consequence to watch:*` — something that will need attention later.

## Superseding

**Never edit an existing entry.** When a decision turns out to be wrong, write a new one that
says what it supersedes and why the old reasoning failed. D49 supersedes D2 this way: it
names the part of D2 that still stands, and the part it replaces.

## Cross-linking

GitHub derives the anchor from the heading: lowercase it, delete punctuation — apostrophes and
colons included — and replace spaces with hyphens. The em dash becomes a double hyphen because
the spaces on either side each become one.

`### D49 — ESPN's public JSON is the odds and score source, superseding D2`
→ `#d49--espns-public-json-is-the-odds-and-score-source-superseding-d2`

Link from other docs as `[D49](decisions.md#d49--espns-...)`, adjusting the relative path.

## Verify before finishing

```bash
grep -c '^### D' docs/decisions.md
```

The count should have gone up by exactly the number of entries you added. Then check that every
anchor you wrote resolves — a broken decision link is invisible until someone follows it.
```
