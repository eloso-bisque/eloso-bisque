# Converting interface text, by class

Each class of interface text has its own rules. Classify before converting.

---

## Buttons and controls

Fragments, not sentences. The no-omission rule does not apply. Keep them short, start with
the verb, and use the same verb for the same action everywhere.

| Before | After | Why |
|---|---|---|
| `Submit` | `Send` | shorter, concrete; reserve `Submit` for forms that literally submit |
| `OK` | *(name the action)* — `Delete`, `Save`, `Continue` | `OK` tells the user nothing about what happens |
| `Yes` / `No` | `Delete` / `Cancel` | a verb pair survives translation and skim-reading |
| `Click here` | *(name the destination)* — `Open the report` | `here` is not a thing |
| `Learn more` | `Read about billing` | says what you get |
| `Get Started` | `Start` | one word, one meaning |
| `Saving...` | `Saving…` | keep the `-ing` — transient status, see SKILL.md collisions |

Rules: one verb per button. No terminal punctuation. Sentence case unless the design
system says otherwise — `SHOUTING` is a dictionary typographic convention, not a UI one.

---

## Error messages

The highest-value class. An error must say **what happened**, **why**, and **what to do**.
STE's sentence limits apply — 20 words per instruction.

| Before | After |
|---|---|
| `Oops! Something went wrong.` | `The server did not respond. Try again in a few minutes.` |
| `An error occurred while attempting to save your changes.` | `The system cannot save your changes. Check your connection, then save again.` |
| `Invalid input` | `Enter a date in the format YYYY-MM-DD.` |
| `Authentication failed` | `Your password is not correct. Enter it again, or reset it.` |
| `Failed to upload file. Please try again later.` | `The upload stopped. The file is larger than the limit of 25 MB. Upload a smaller file.` |
| `You do not have sufficient permissions to perform this action.` | `You cannot delete this project. Only an administrator can delete a project.` |

Rules: never `please`. Never blame the user (`you entered an invalid…` → `the date must
be…`). Never expose an exception class or stack frame as user text. If there is a
recovery action, it is the last sentence and it is an imperative.

---

## Confirmation dialogs

State the consequence before asking. Say whether it can be undone.

| Before | After |
|---|---|
| `Are you sure?` | `Delete 12 files? You cannot undo this.` |
| `This action cannot be undone. Are you sure you want to proceed?` | `You cannot undo this. Delete the project?` |
| `Do you really want to discard your unsaved changes?` | `Your changes are not saved. Discard them?` |

Rules: quantify (`12 files`, not `these items`). One question. Buttons name the action,
not `Yes`/`No`.

---

## Empty states and onboarding

Where marketing voice usually lives, so the biggest tone change. Convert to instruction
and **tell the user you changed the register.**

| Before | After |
|---|---|
| `Let's get you started! 🎉` | `To start, create a project.` |
| `Nothing to see here yet...` | `You have no reports. Select **New report** to make one.` |
| `Your dashboard is looking a little empty!` | `No data is available. Connect a data source to see your metrics.` |
| `We couldn't find anything matching your search.` | `No results match "{query}". Check the spelling, or search for a different term.` |

---

## Status and progress

The one place `-ing` survives. Transient state only.

| Before | After |
|---|---|
| `Please wait while we process your request...` | `Processing…` |
| `Your file is currently being uploaded` | `Uploading… 40%` |
| `Successfully saved!` | `Saved.` |
| `Sync completed successfully` | `Sync is complete.` |

Rules: no `please`, no exclamation marks, no `successfully` — success is implied by the
past tense. Give a number if you have one.

---

## Form labels and help text

Labels are fragments. Help text is sentences and takes the full rules.

| Before | After |
|---|---|
| `E-mail Address*` + `Please enter a valid email address` | `Email` + `We send your receipts to this address.` |
| `Password must contain at least 8 characters, including uppercase and lowercase letters, numbers, and special characters` (24 words) | `Your password must have at least 8 characters. Include a capital letter, a number, and a symbol.` (two sentences, 11 and 8 words) |
| `Optional` | `Optional` |
| `Enter your full legal name as it appears on your government-issued identification document` | `Enter your name as it appears on your passport or ID card.` |

Rules: help text says why the field exists or what format is required — not a restatement
of the label. Requirements come **before** the user types, not as an error after.

---

## Settings descriptions

Descriptive text: 25-word limit, active voice, say what the setting does when **on**.

| Before | After |
|---|---|
| `Notifications will be sent to your email when this option is enabled` | `We send an email when someone mentions you.` |
| `Enabling this setting will cause the application to automatically synchronize your data across all of your connected devices` (18 words, passive, `-ing`) | `The app copies your data to all your devices.` |
| `Disable to turn off telemetry collection` | `Send anonymous usage data to help us fix problems.` |

Rules: describe the **on** state. No double negatives (`Disable to turn off…`).

---

## Tooltips

One sentence. Says something the label does not already say.

| Before | After |
|---|---|
| `Save` *(tooltip on a Save button)* | *(delete it — it repeats the label)* |
| `Click this button to export your data to a CSV file` | `Export as CSV.` |
| `This will permanently delete the item` | `Deletes the item permanently.` |

---

## Notifications and alerts

Lead with the fact. Time and action follow.

| Before | After |
|---|---|
| `We wanted to let you know that your subscription is going to expire soon` | `Your subscription ends on 12 March. Renew it to keep access.` |
| `Warning: Disk space is running low` | `Disk space is low. 2 GB remain. Delete files to make space.` |

Safety-shaped alerts follow rule 5.1 — command or condition first, reason after:
`Do not close this window. The transfer is not complete.`

---

## Placeholders and plurals

Placeholders survive verbatim, and the surrounding grammar must stay valid for every
value.

- `Deleted {count} items` fails for `count = 1`. Use the framework's plural forms; do not
  write `item(s)` — it is unreadable and untranslatable.
- Do not build a sentence from concatenated fragments. Translators need the whole string.
- `No results match "{query}"` — keep the quotation marks; they mark where user input
  begins.
