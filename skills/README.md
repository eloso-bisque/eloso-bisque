# skills

Claude Code skills kept with the repository, so they are versioned and shared rather
than living only in one person's `~/.claude`.

## simplified-technical-english

Rewrites interface text into ASD-STE100 Simplified Technical English — the controlled
language used for aerospace and defence documentation. 53 writing rules, a dictionary of
about 900 approved words, and one purpose: text that a reader whose first language is not
English can follow correctly on one pass.

| Path | What it is |
|---|---|
| `SKILL.md` | The core rules, the UI collisions table, the workflow |
| `references/rules.md` | The rules by part, marked `[verbatim]` or `[derived]` |
| `references/dictionary.md` | Substitution table and a term-map checklist |
| `references/ui-patterns.md` | Before and after, for 8 classes of interface text |
| `scripts/ste_check.py` | Mechanical linter. No dependencies |

### Install

```bash
ln -s "$PWD/skills/simplified-technical-english" ~/.claude/skills/
```

Or copy the directory. Claude Code loads it from `~/.claude/skills/`.

### Run the linter on its own

```bash
python3 skills/simplified-technical-english/scripts/ste_check.py path/to/en.json
python3 skills/simplified-technical-english/scripts/ste_check.py --text "Please try again later."
```

It reads i18n JSON catalogues, Markdown, HTML, and string literals in source files. It
skips i18n keys, placeholders such as `{count}`, and `<code>` blocks, because identifiers
are not English and must not be checked as English.

Exit status: `0` clean, `1` findings, `2` usage error. Use it in a pre-commit hook or CI.

### What it does not do

The linter finds mechanical faults: long sentences, `-ing` forms, passive voice, noun
stacks, banned words. It cannot tell you whether a rewrite still means the same thing,
whether one word is used for one thing across a product, or whether the tone suits the
page. A clean run is not a certificate.

The official dictionary of approved words is part of the licensed ASD-STE100
specification and is **not** in this repository. `references/dictionary.md` is a working
table built from the published rules. The correct claim about output from this skill is
that it follows the STE writing rules, not that it is "STE compliant".
