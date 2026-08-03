# Substitution table

**This is not the ASD-STE100 dictionary.** The official list of ~900 approved words is
part of the licensed specification and is not reproduced here. This is a working table of
common technical and interface vocabulary, built from the standard's published rules and
examples. It is consistent with STE principles. A word's absence from this table does not
mean it is approved, and its presence does not certify it. For certification-grade work
the licensed spec is required.

Entries marked † appear in public documentation of the standard itself.

---

## Verbs — long word to short word

| Avoid | Use |
|---|---|
| utilize, employ (as verb) | use |
| accomplish, perform, execute, carry out | do |
| initiate, commence | start |
| terminate, cease, halt | stop, end |
| obtain, acquire, procure | get |
| provide, supply, furnish | give |
| require | need |
| permit, enable (a person) | let |
| assist, aid | help |
| attempt, endeavour | try |
| modify, alter, amend | change |
| eliminate, delete (physical) | remove |
| verify, ensure, confirm | make sure, check |
| indicate, denote | show |
| rotate † | turn † |
| activate, engage | start, switch on |
| deactivate, disengage | stop, switch off |
| install, mount | install (approved), put in |
| inspect, examine | examine |
| retain, preserve | keep |
| transmit, forward | send |
| receive | get |
| locate | find |
| identify | find, know |
| determine | find, calculate |
| ascertain | find out, make sure |
| implement | do, make |
| facilitate | help, make easier |
| demonstrate | show |
| construct | build, make |
| repair, rectify | repair |
| replace, substitute | replace |
| adjust, calibrate | adjust |
| monitor, observe | watch, look at |
| select | choose, select |
| specify | give, tell |
| commence operation of | start |

## Nouns and abstractions

| Avoid | Use |
|---|---|
| acceptance † | accept † (as a verb, restructure) |
| utilization | use |
| termination | end, stop (restructure to verb) |
| installation (the act) | install (restructure to verb) |
| requirement | what you need |
| capability | can (restructure to verb) |
| functionality | function, what it does |
| assistance | help |
| modification | change |
| verification | check |
| notification | message |
| authorization | permission |
| configuration | settings |
| specification | specification |
| documentation | documents, manual |
| information | data, information |
| display (n.) | screen |
| access (v.) | get access to † |
| approximately | about |
| a sufficient quantity of | enough |
| a number of | some, many |
| the majority of | most |
| in the event of | if |
| in the vicinity of, close to † | near † |
| at this point in time | now |
| in a timely manner | quickly, on time |

## Connectives and phrases

| Avoid | Use |
|---|---|
| prior to, in advance of | before |
| subsequent to, following | after |
| in order to, so as to | to |
| due to the fact that, owing to | because |
| in the event that, should it occur | if |
| with regard to, with respect to | about |
| in addition, furthermore, moreover | also |
| however, nevertheless | but |
| therefore, consequently, hence | so |
| in conjunction with | with |
| by means of, via | with, by |
| in accordance with | as in, follow |
| notwithstanding | but, although |
| in the absence of | without |
| a minimum of | at least |
| a maximum of | no more than |
| in excess of | more than |
| the aforementioned | this, that |

## Adjectives and adverbs

| Avoid | Use |
|---|---|
| additional | more |
| sufficient † | enough † |
| numerous | many |
| initial | first |
| final, ultimate | last |
| subsequent | next |
| previous, prior | before, last |
| current, present | now, this |
| optimal, optimum | best |
| approximately | about |
| essentially, basically, fundamentally | *(delete)* |
| very, quite, rather, fairly | *(delete — use a specific number)* |
| simply, just, easily | *(delete — it is not easy for everyone)* |
| appropriate, applicable | correct, right |
| adequate | enough |
| adjacent | next to |
| accessible † | *(restructure: `you can get access to`)* † |

## Interface-specific

| Avoid | Use |
|---|---|
| please | *(delete)* |
| sorry, oops, uh-oh, whoops | *(delete — state the fact)* |
| we're / you're / don't / can't / it's | we are / you are / do not / cannot / it is |
| hit, tap on, click on | select, press, click |
| log in / login (verb) | sign in |
| e-mail | email |
| info | information |
| config | settings |
| auth | sign-in, permission |
| repo | repository |
| dir | directory, folder |
| delete forever, nuke, blow away | delete permanently |
| something went wrong | *(name the failure)* |
| an error occurred | *(name the error and what to do)* |
| invalid | *(say what is wrong and what is valid)* |
| failed to X | *(`The system cannot X.` then what to do)* |
| unable to | cannot |
| are you sure? | *(state the consequence, then ask)* |

## Words to fix by restructuring, not substituting

These have no one-word replacement. Rewrite the sentence.

- **`should`** — decide whether it means a requirement (`must`) or advice
  (`we recommend that you…`) and write that.
- **`may`** — decide between permission (`you can`) and possibility
  (`it is possible that`).
- **`shall`** — contractual register. In UI, use `must`.
- **`would`** — usually a hedge. Delete it or use the simple present.
- **`could`** — `can`, or name the condition.
- **`it`, `this`, `that`** opening a sentence — repeat the noun instead. `This can fail`
  → `The upload can fail.`
- **`and/or`** — pick one, or write both cases.
- **`etc.`, `and so on`** — finish the list or say what the rule is.
- **`if applicable`, `as appropriate`, `where necessary`** — state the actual condition.

## Building the term map

Before rewriting a product's copy, list every concept with more than one word for it and
fix the choice. Typical drifts to check for:

| Concept | Choose one |
|---|---|
| remove / delete / clear / discard / trash / erase | |
| sign in / log in / login / authenticate | |
| settings / preferences / options / configuration | |
| folder / directory | |
| user / account / profile / member | |
| cancel / dismiss / close / discard | |
| save / apply / update / commit / confirm | |
| error / problem / issue / failure | |
| choose / select / pick | |
| edit / change / modify / update | |

Record the chosen term and apply it everywhere, including in code comments and docs, so
the next person does not reintroduce the drift.
