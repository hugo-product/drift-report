---
name: ud-tokens
description: Audits design tokens and raw values — colours, spacing, text sizes, fonts, radii, shadows, breakpoints. Finds hard-coded values, unused and undeclared tokens, recurring values that were never written down as a token, and proposes scales from real usage, both ways. Read-only. Use when the owner types /ud-tokens or asks about tokens, colours, spacing, typography or hard-coded values.
argument-hint: "[zone or category]"
---

# ud-tokens

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it. Needs a **Run** (`/ud-scan`).

## Steps

1. **Count.**

   ```bash
   node ~/.claude/skills/ud-core/scripts/tokens-report.mjs
   ```

   Writes `findings/tokens.json` and `reports/tokens.md` in the run folder.

2. **Read the report and the finding summary.** Pick what deserves judgement:
   - each `scale-*` finding (text size, spacing, radius, shadow);
   - `raw-color` findings with no exact token match, starting with the highest **Reach**;
   - `recurring-value` findings;
   - `font-alias` findings.
   `token-unused`, `token-undeclared`, `breakpoint-oneoff` and `inline-style` usually need no agent: the options are clear from the counts.

3. **Judge** (see "Judging with sub-agents" and the Cost guard in the conventions). Suggested groups, one agent each:
   - **Scales**: given the histograms and the script's proposal, is the proposed **Scale suggestion** sensible? Would merging two close values be visible (13px and 14px text is; 10px and 12px gap often is)? Recommend `adopt-proposed`, `adjust` (say how, in `judgement`) or `keep`. The agent reads a handful of the files where the rare values appear, to see whether they are deliberate.
   - **Colours**: for raw colours with a near but not exact token, read the surrounding code: is this the same intent as the token (then `use-token`), a distinct colour that recurs (then `create-token`), or a one-off such as a brand logo or an illustration (then `keep`)?
   - **Fonts**: do the spellings really reach the same family?

4. **Both directions.** Make sure the report shows both sides of "written down versus used": values that recur without a token, and tokens nothing uses. If one side is empty, say so rather than leaving it out.

5. **Report** to the owner: the five most useful facts (for example "24 text sizes are in use; 9 of them carry 90% of the uses"), what the proposal would change, the path of `reports/tokens.md`, and that nothing has been created or changed. Next step: `/ud-decide tokens`.

## Never

- Create, rename or delete a token. Proposals only.
- Call a hard-coded value an error. It is a value with no token; the owner decides whether it should have one.
