# DR suite

A personal set of skills that audits a project's interface (app code and Storybook), maps it, asks its owner to settle what it finds, and plans the rework. It is meant to be carried from one project to the next.

## Language

### What the audit sees

**Run**:
One pass of the audit over a project, at a given date and commit.
_Avoid_: Scan, session, execution

**Zone**:
A named part of a project that a **Finding** belongs to, such as product app or marketing. Each project defines its own.
_Avoid_: Area, scope, section

**Family**:
The components that serve the same kind of purpose for the person using the interface, such as all the modals.
_Avoid_: Group, category, type

**Duplicate**:
Two or more components of one **Family** that play the same role for the person using the interface, whether or not their code is alike. Each carries a confidence level.
_Avoid_: Clone, copy, redundancy

**Frame**:
The part of a component that stays the same whatever it holds: its outline, its surface, its spacing, how it opens and closes. Several components of a **Family** can draw the same Frame.
_Avoid_: Shell, base, wrapper, container

**Target**:
What a **Family** would become: its **Frames**, their variants, their pieces, and where each of today's members goes. A proposal until the owner settles it.
_Avoid_: Ideal, end state, refactor

**Expected states**:
The states a component of a given kind should show, such as rest, focus, disabled and loading. Each project can change the list.
_Avoid_: Variants, required states

**Outdated story**:
A story that no longer matches its component, or that shows values no screen uses.
_Avoid_: Stale story, broken story

**Missing story**:
A component, or a combination a screen really uses, that no story shows.
_Avoid_: Uncovered component, gap

**Scale suggestion**:
A proposed set of values for spacing, text size or another measure, drawn from how the project really uses them. It works both ways: a recurring value that is not yet a token, or a token nothing uses.
_Avoid_: Token proposal, normalisation

**Pattern**:
A piece of interface that recurs with nearly the same look in several places, without being a component and whatever it is called.
_Avoid_: Repeated block, snippet, look-alike

**Reference system**:
A well-known public design system the project is compared with, such as Material or Carbon. Each project names the one closest to it.
_Avoid_: Benchmark, standard, model

**Blueprint**:
A proposed overall structure for the project's design system (story tree, token levels, naming, component conventions, folders), drawn from the **Reference systems**.
_Avoid_: Target architecture, restructuring plan, roadmap

### What the owner settles

**Reach**:
How many screens and uses a **Finding** touches.
_Avoid_: Impact, severity, priority

**Effort**:
How much work settling a **Finding** in code would take, on four levels.
_Avoid_: Cost, size, complexity

**Finding**:
One thing a **Run** noticed, with its evidence and its **Zone**.
_Avoid_: Issue, problem, result

**Divergence**:
A **Finding** where two sources disagree, such as the app and Storybook. No source wins by default; the owner settles it with a **Decision**.
_Avoid_: Drift, mismatch, gap

**Decision**:
The owner's answer to a **Finding** that offers a choice. It is open, deferred (waiting on someone else's answer), settled or applied.
_Avoid_: Arbitration, verdict, resolution

**Decision ledger**:
The lasting record of every **Decision** in a project, so that a later **Run** does not ask again.
_Avoid_: Decision log, register, history

**Brief**:
The one page that ranks what every audit of a **Run** found, for the owner to read first. It can be limited to one **Zone**, **Family**, component or folder.
_Avoid_: Summary, dashboard, digest

**Lot**:
A set of settled **Decisions** that can be reworked, checked and understood on its own.
_Avoid_: Batch, task, step

**Project settings**:
What is true of one project only: its **Zones**, what must not be touched, its **Expected states**, its working rules.
_Avoid_: Config, preferences, profile
