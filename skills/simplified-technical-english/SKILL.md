---
name: simplified-technical-english
description: >-
  Rewrite interface text into ASD-STE100 Simplified Technical English — the controlled
  language used for aerospace and defence documentation. Use when asked to convert,
  rewrite, simplify, or audit UI copy, microcopy, labels, buttons, error messages,
  tooltips, empty states, confirmation dialogs, onboarding text, form help, settings
  descriptions, alerts, or documentation into STE / Simplified Technical English /
  "simplified english" / controlled language / plain technical english. Also triggers on
  "ASD-STE100", "AECMA Simplified English", "controlled natural language", "make this
  copy simpler/clearer/more consistent", and on requests to make text easier for
  non-native speakers or machine translation. Includes a mechanical validator that flags
  rule violations with line numbers.
---

# Simplified Technical English for interface text

ASD-STE100 is a **controlled language**: a restricted subset of English with a fixed
dictionary and a fixed grammar. It exists so that a maintenance technician whose first
language is not English can read a procedure once and do it correctly. Issue 9 (January
2025) has **53 writing rules** and a dictionary of **about 900 approved words**.

It was built for aircraft maintenance manuals. Interface text is not a maintenance
manual, so this skill applies STE's *machinery* — one word one meaning, short sentences,
active voice, no gerunds, no noun stacks — while resolving the places where STE's
assumptions and UI conventions genuinely conflict. Those conflicts are in
**"Where STE and UI conventions collide"** below. Read that section before converting
anything; applying STE naively to UI copy produces text that is technically conformant
and practically worse.

## The core rules

These are the rules that do the work on interface text. The fuller set is in
`references/rules.md`.

**Vocabulary**
- One word, one meaning. A word is used as **one part of speech only**. If `display` is
  approved as a verb, it is never the noun — use `screen`.
- One meaning, one word. If two words mean the same thing, pick one and use it
  everywhere. `delete` / `remove` / `clear` / `discard` must not drift across a UI.
- Prefer the short common word: `use` not `utilize`, `before` not `prior to`,
  `about` not `approximately`, `near` not `close to`, `enough` not `sufficient`.
- Substitution table: `references/dictionary.md`.

**Verbs**
- Only these forms: infinitive, imperative, simple present, simple past, simple future,
  and past participle **used only as an adjective**.
- No auxiliary stacks. Not `will have been saved` → `saved` or `will save`.
- **No `-ing` forms** except as a technical noun or inside one (`landing gear`,
  `Settings`). Not `Saving your changes…` → `The system saves your changes.` For a
  progress label, see the collisions section — this is the most common conflict.

**Voice and person**
- Active voice always in procedures. Passive only in descriptive text, and only when the
  agent is genuinely unknown.
- Address the reader as `you`. `Before you accept the unit`, not `Before acceptance of
  the unit`.

**Sentence and paragraph**
- Instructions: **20 words maximum**.
- Descriptive text: **25 words maximum**.
- **One instruction per sentence.** Two actions means two sentences.
- One topic per paragraph, **6 sentences maximum**.
- Do not delete articles, subjects, or verbs to shorten text. `Press the button`, not
  `Press button`.

**Structure**
- Noun clusters: **3 words maximum**. `main landing gear door` is the limit;
  `default user account setting page` must be broken up with prepositions.
- Use vertical lists for anything with more than two conditions or steps.
- Safety text starts with the command or the condition, then the reason.
  `Do not remove the cover. The capacitor holds a charge.`
- Warnings and cautions go **before** the step they apply to, never after.

## Where STE and UI conventions collide

STE assumes prose in a manual. Interface text is fragments in a layout. These five
conflicts come up in almost every conversion. Resolve them this way unless the user says
otherwise, and tell the user which ones you hit.

| Conflict | Why it happens | Resolution |
|---|---|---|
| **Progress labels need `-ing`** (`Saving…`, `Loading…`) | STE bans gerunds; UI has no other idiom for in-progress state | Keep the `-ing` for **transient status only**. It is a state label, not an instruction. Do not use `-ing` in buttons, headings, errors, or help text. |
| **Buttons and labels have no verb or article** (`Settings`, `New file`) | STE forbids omitting sentence parts | The rule governs **sentences**. Labels are not sentences — leave them as noun phrases. Apply the rule to anything that is a full sentence. |
| **UI omits `the`** (`Save changes`) | Same rule | Keep articles in sentences; accept their absence in short controls. Never drop an article from body or error text. |
| **`Please`, `Sorry`, politeness** | STE has no register for courtesy | Delete it. `Please enter a valid email` → `Enter a valid email address.` Courtesy words add length and translate badly. |
| **Marketing voice in empty states / onboarding** | STE has no persuasive register | Convert to instruction. `Let's get you started!` → `To start, add a project.` Flag to the user that tone changes; do not silently rewrite brand voice without saying so. |

## What to never change

Converting interface text means converting **text shown to a human**. Do not touch:

- Code, identifiers, variable names, CSS classes, API fields.
- **i18n keys.** Change the value, never the key. `settings.save.label` stays.
- Placeholders and interpolation: `{count}`, `%s`, `${name}` must survive verbatim and
  keep their surrounding grammar valid for every plural form.
- Brand names, product names, trademarks, and legally reviewed text (licences, consent,
  privacy, medical, financial disclosures). Flag these for human review — rewording them
  can change legal meaning. Say so explicitly rather than editing them.
- Existing translations. Converting the source string invalidates every translation of
  it; tell the user how many locales are affected before you start.

## Workflow

1. **Find the text.** Locate the strings: i18n catalogues, constants, JSX/template
   literals, docs. Report what you found and what you are treating as out of scope.
2. **Classify each string** — instruction, description, label, error, status, legal.
   The rules differ by class. Legal is untouched.
3. **Build the term map first.** Before rewriting anything, list every concept that has
   more than one word for it across the product and choose the single approved word.
   This is where most of the value is, and doing it after rewriting means redoing the
   rewrite.
4. **Convert**, respecting the collisions table.
5. **Validate** with `scripts/ste_check.py` and fix what it flags.
6. **Report** — show a before/after table, the term map you chose, strings you refused to
   touch and why, and anything where STE conformance would have hurt usability.

Worked before/after examples for each UI text class are in `references/ui-patterns.md`.

## The validator

```bash
# any mix of files; --json for machine-readable, --procedural to force the 20-word limit
python3 <skill>/scripts/ste_check.py src/locales/en.json
python3 <skill>/scripts/ste_check.py --text "Saving your changes prior to termination of the session."
```

`<skill>` is wherever this skill lives — `~/.claude/skills/simplified-technical-english`
when installed for a user, or `skills/simplified-technical-english` when vendored into a
repository.

It flags: over-length sentences, `-ing` forms, passive voice, noun clusters over three,
unapproved vocabulary with substitutions, multi-instruction sentences, contractions,
politeness words, over-long paragraphs, and vague pronoun openers. It understands JSON
i18n catalogues and skips keys, placeholders, and code.

It is a **linter, not an oracle** — it detects mechanical violations. One word one
meaning, correct register, and whether a rewrite still means the same thing all need your
judgement. Never report "STE compliant" on the basis of a clean validator run; report
what the validator checked.

## Honest limits

The authoritative dictionary of ~900 approved words is part of the licensed ASD-STE100
specification and is **not reproduced here**. `references/dictionary.md` is a working
substitution table for common technical and interface vocabulary, built from the
publicly documented rules and examples. It is consistent with STE principles but is not
the official word list, and a word absent from it is not thereby approved. For
certification-grade conformance the user needs the real spec from asd-ste100.org.

Say this plainly if a user asks whether output is "STE compliant". The correct claim is
that the text follows STE's documented writing rules, not that it has been checked
against the official dictionary.
