# ASD-STE100 writing rules — working reference

Issue 9 (January 2025): 53 writing rules, ~900 approved words. The standard has two
parts: the writing rules, and the dictionary of approved and unapproved words.

Rules below are grouped as the specification groups them. Rules marked **[verbatim]** are
quoted from public documentation of the standard. Rules marked **[derived]** are the
practical form of a documented principle — they are consistent with the standard but are
not quotations. This distinction matters: do not cite a [derived] line as spec text.

---

## Part 1 — Words

**1.1 One part of speech** — [verbatim] *Use the approved words only as the part of
speech and meaning given in the dictionary.*

A word approved as a verb is never used as a noun, and the reverse. This is the single
most characteristic rule of STE.

- `display` (v.) approved → the noun is `screen`
- `test` (n.) approved → the verb is `do a test` / `examine`
- `access` (n.) approved → the verb is `get access to`

**1.2 One meaning per word** — [derived] Where the language offers synonyms, the
dictionary approves one. Use it consistently; do not vary vocabulary for style.

**1.3 Technical names** — [derived] Technical names not in the dictionary are permitted.
Use the name the product itself uses, and use it identically everywhere.

**1.4 Technical verbs** — [derived] A manufacturing or technical process verb may be used
where no approved verb expresses it.

**1.5 / 1.12** — Rules governing technical nouns and technical verbs specifically.

**1.6 Noun clusters** — [verbatim] *Do not write multi-word nouns that have more than
three words.*

Break longer stacks with prepositions and articles:
- ✗ `default user account setting page`
- ✓ `the page for the default settings of a user account`

**1.7 No omission** — [verbatim] *Do not omit parts of the sentence (e.g. verb, subject,
article) to make the text shorter.*

Applies to sentences. UI control labels are fragments, not sentences — see the collisions
table in SKILL.md.

---

## Part 2 — Verbs

**2.1 Approved verb forms** — [verbatim] *Use the approved forms of the verb to make
only:*
- *the infinitive form*
- *the imperative form*
- *the simple present tense*
- *the simple past tense*
- *the simple future tense*
- *the past participle (only as an adjective)*

**2.2 No complex constructions** — [verbatim] *Do not use auxiliary verbs to make complex
verb constructions.*

- ✗ `The file will have been saved` → ✓ `The system saves the file.`
- ✗ `You should have configured the server` → ✓ `Configure the server first.`

**2.3 The `-ing` form** — [verbatim] *Use the "-ing" form of a verb only as a technical
noun or as a modifier in a technical noun.*

Permitted: `landing gear`, `Settings`, `bearing`. Not permitted as a progressive tense
(`is loading`) or as a gerund subject (`Saving files is slow`).

**2.4 Active voice** — [verbatim] *Use the active voice. In descriptive writing, one
should use the passive voice only when the agent is unknown.*

- ✗ `An error was encountered by the parser`
- ✓ `The parser found an error.`

**2.5 Address the reader** — [derived] Use `you` and the imperative rather than
nominalised abstractions.
- ✗ `Before acceptance of the unit, the specified test procedure is to be performed`
- ✓ `Before you accept the unit, do the specified test procedure.`

---

## Part 3 — Sentences

**3.1 Procedural sentence length** — [verbatim] no more than **20 words** in
instructions.

**3.2 Descriptive sentence length** — [verbatim] no more than **25 words** in descriptive
text.

**3.3 One instruction per sentence** — [verbatim] *Write one instruction per sentence.*

If a sentence contains two imperatives joined by `and`, split it. Exception: two actions
that must happen together as one motion.

**3.4 Clarity and specificity** — [verbatim] *Make instructions as clear and specific as
possible.*

**3.5 Vertical lists** — [verbatim] *Use vertical lists for complex text.*

Any instruction with more than two conditions, or any sequence of more than two steps,
becomes a list.

---

## Part 4 — Paragraphs

**4.1 One topic** — [verbatim] *Write only one topic per paragraph.*

**4.2 Paragraph length** — [verbatim] *Do not write more than six sentences in each
paragraph.*

**4.3 Given/new order** — [derived] Start the paragraph with its topic sentence. Put
known information before new information.

---

## Part 5 — Safety, warnings and cautions

**5.1 Command first** — [verbatim] *Start safety instructions with a clear command or
condition.*

The action or the condition leads; the reason follows.
- ✓ `Do not remove the cover. The capacitor holds a charge.`
- ✗ `Because the capacitor holds a charge, the cover should not be removed.`

**5.2 Position** — [derived] A warning or caution appears **before** the step it governs,
never after it. A reader who has already done the step cannot un-do it.

**5.3 Hierarchy** — [derived] Warning = risk of injury or death. Caution = risk of damage
to equipment. Note = neither, just information. Do not use them interchangeably.

---

## Modal verbs

STE constrains modals tightly. Practical mapping for interface and documentation text:

| Modal | Use |
|---|---|
| `must` | a requirement |
| `can` | a capability that exists |
| `do not` | a prohibition — preferred over `must not` in instructions |
| `shall` | avoid in UI; contractual register only |
| `should` | avoid — it is ambiguous between advice and requirement |
| `may` | avoid — ambiguous between permission and possibility |

Where `should` or `may` appears, decide which meaning was intended and write that:
`should` → `we recommend that you…` or `must`; `may` → `can` or `it is possible that`.

---

## Documented before/after examples

From public documentation of the standard:

| Non-STE | STE |
|---|---|
| Before acceptance of unit, do the specified test procedure | BEFORE YOU ACCEPT THE UNIT, DO THE SPECIFIED TEST PROCEDURE |
| do not go close to the landing gear | do not go near the landing gear |
| rotate the cover until the jacks marked + and − are accessible | TURN THE COVER UNTIL YOU CAN GET ACCESS TO THE JACKS THAT HAVE + AND − MARKS |

Note in the third example: `rotate`→`turn`, `accessible`(adj.)→`get access to`(verb
phrase), and the relative clause `marked +` → `that have + marks`, removing a past
participle used as a verb rather than an adjective.

Uppercase in these examples reflects the dictionary's typographic convention — approved
words are shown in uppercase, unapproved in lowercase. It is **not** an instruction to
set interface text in capitals.
