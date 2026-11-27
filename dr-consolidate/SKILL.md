---
name: dr-consolidate
description: Works out what a large family of components really needs — which members are a frame others build on, which only put content into a frame, which draw the same frame again, where the frames differ (what a variant could carry), which inner pieces recur, what nothing uses — and proposes a target for the family: a few frames, their variants, their pieces, and where each of today's components goes. "You have 50 modals; two frames and five variants would hold them, the rest is content." Read-only. Use when the owner types /dr-consolidate, or asks to simplify, reduce, regroup, prune, split up or rebuild a family of components, or how many components a family really needs.
argument-hint: "[family]"
---

# dr-consolidate

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. Needs a **Run** and the **Families** (`/dr-components`, which writes `work/families.json`). This skill writes `findings/consolidate.json`, `work/consolidate.json`, `work/targets/` and `reports/consolidate.md`.

`/dr-components` asks of two components "are these the same?". This skill asks of a whole **Family** "how few **Frames** would hold all of this, and what is left once they do?". The answer has six parts, and the report keeps them apart:

| | What it means for the Family |
|---|---|
| **Identify** | what each member is: a Frame, built on a Frame, a Frame drawn again, used nowhere |
| **Group** | members that draw the same Frame: one Frame, written several times |
| **Simplify** | members that only bring content: they stop being components of the design system |
| **Prune** | members nothing uses |
| **Split** | inner pieces that recur (a header, a footer, a row of actions): small components of the Family |
| **Rebuild** | the target: the Frames, their variants, their pieces, and where every member goes |

## Steps

1. **Count.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/consolidate-report.mjs [--family <name>]
   ```

   One `family-consolidation` **Finding** per **Family** of `thresholds.consolidateMinMembers` components or more (default 4). `work/consolidate.json` holds every member with its role, its group and the classes of its **Frame**, the axes and the pieces.

2. **Read the table before any file.** "Distinct Frames drawn" is the ceiling: the code draws that many today, so the Family needs no more. Say it to the owner as the script gives it ("Modal: 11 components, 3 distinct Frames drawn"), and say that the floor is an agent's proposal, not a count. Check the roles that look wrong: a member that only gathers the others (a registry, a provider) is not built on them; a member with "no Frame seen" draws it where the scan cannot look.

3. **Judge, one agent per Family**, largest **Reach** first (Cost guard). A Family of 15 members or fewer is read whole. Above that, the agent reads every Frame, two or three members of each look-alike group (the most used, the largest, the oddest), five content-only members, and the list of the rest. Its questions, in this order:

   - **Frames.** Which of the Frames drawn today are truly different things for the person using the interface (a centred dialog and a side sheet), and which are one Frame with a different size, padding or radius? A look-alike group whose Frame is close to an existing Frame joins it. Count behaviour too: closing, focus, scrolling. Two Frames that look alike and behave differently are two Frames, or one with an explicit prop: say which, and why.
   - **Variants.** From "Where the Frames differ": each property with a few values becomes a named variant (`size`: sm, md, lg) only if the values are meant to differ. Values that are near and not meant (`max-w-2xl` and `max-w-[640px]`, `p-6` and `p-8` on the same kind of dialog) are brought to one; say which one, from use counts and the project's scales (`findings/tokens.json`).
   - **Pieces.** For each recurring piece: is it one recognisable part (a header with a title and a close button) with a name and two or three props? A piece that recurs by coincidence of utility classes is left alone.
   - **Content.** For each content-only member: does it hold logic (a form, a request, state) or only text and buttons? Logic stays a component, built on the Frame, living with the feature that owns it rather than in the design system. Text and buttons become the call site's own content. Nothing is lost: say where each thing goes.
   - **Prune.** For members used nowhere: is it reached in a way the scan cannot see? Otherwise it goes.

4. **Write the target.** One file per Family, `work/targets/<Family>.json`, which `dr-plan` and `dr-rework` read:

   ```json
   {
     "family": "Modal", "run": "<run id>",
     "frames": [{ "name": "Modal", "from": "c:components/modals/modal.tsx#Modal", "role": "centred dialog", "props": ["title", "size", "onClose"] }],
     "variants": [{ "frame": "Modal", "prop": "size", "values": { "md": "max-w-md", "lg": "max-w-lg", "xl": "max-w-2xl" }, "absorbs": ["max-w-[640px] becomes xl"] }],
     "pieces": [{ "name": "ModalFooter", "from": "components/modals/billing-modal.tsx:9", "props": ["align"] }],
     "members": [
       { "id": "c:…#ExportModal", "becomes": "content", "of": "Modal", "variant": { "size": "md" }, "goesTo": "its one call site" },
       { "id": "c:…#BillingModal", "becomes": "feature component", "of": "Modal", "variant": { "size": "xl" }, "keeps": "the billing form and its request" },
       { "id": "c:…#LegacyModal", "becomes": "removed", "why": "no call site, no story, no dynamic use found" }
     ],
     "unread": ["ids of members placed from the script's group only, not read"]
   }
   ```

   Every member of the Family appears in `members`, once. `becomes` is one of `frame`, `content`, `feature component`, `piece`, `removed`, `kept as it is` (with `why`). A member placed without being read is listed in `unread`.

   Then set the agent fields on the finding: `recommendation` (`rebuild`, `rebuild-partly`, `keep`), **Effort**, confidence, and a `judgement` that states the result in one sentence the owner can repeat: "11 components become 1 Frame with a size variant (3 values), 2 pieces, 1 feature component; 8 become content at their call site; 1 is removed."

5. **Say what the rebuild costs and buys**, from the target: components before and after, call sites that change, stories to write (one per Frame, variant value and piece) and stories that go, lines that disappear (the sum of `loc` of members that become content or are removed, as a rough figure and said as such).

6. **Report**: per Family, the sentence of step 4, the Frames and variants as a short table, the pieces, what is unread, the path of `reports/consolidate.md` and of the target file. For anything that rests on two Frames looking alike, say that `/dr-render <family>` measures it. Next step: `/dr-decide <family>`.

## Never

- Give a number of Frames the Family "needs" from the script alone. The script gives what is drawn today; the target is read from the files.
- Fold two Frames into one because their classes match while their behaviour differs, without an explicit prop for the difference.
- Turn every difference into a variant. A variant is a difference someone meant; the rest is brought to one value.
- Drop logic with a member that "becomes content". The target says where it goes.
- Put a `readOnly` member anywhere but `kept as it is`.
- Change a file. The rebuild is `dr-rework`, lot by lot, on a settled **Decision**.

## Limits to state

- A **Frame** is read from the classes of a component's outer element. One drawn by a CSS file, an inline style, run-time classes or a library primitive is not seen; such members are grouped by the primitives they render, or not at all.
- Members that sit in no **Family**, or in a Family under the threshold, are not covered: `/dr-components` and `/dr-patterns` cover them.
- Whether two Frames really look alike on screen is measured by `/dr-render`, not here.
