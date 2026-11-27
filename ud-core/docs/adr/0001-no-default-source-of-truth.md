---
status: accepted
---

# No source wins by default; the owner settles every Divergence

When the app and Storybook disagree (or a token file and the values really used), the suite never declares one of them right. It records a Divergence, offers the options with a recommendation, and waits for the owner's Decision, which goes into the Decision ledger so that a later Run does not ask again.

We chose this over "the app is the truth and Storybook catches up" because neither side is reliably right: a story can hold the intended design while the app drifted, and the reverse. A fixed rule would make the audit silently confirm whichever side happened to be wrong.

## Consequences

- No skill in the suite may change code or stories to resolve a Divergence without a settled Decision.
- The audit is only as fast as the owner's answers, so Decisions are asked in groups of the same subject.
