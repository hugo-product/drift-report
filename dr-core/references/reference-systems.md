# Reference systems: how seven public design systems are organised (structure, tokens, naming, props, scales)
Written: 2026-11-27
Note: facts were read from each system's public docs or public source repository on that date; re-check with `/dr-blueprint refresh` before quoting them as current.

## How to read this file

- Each system has a stable key (`material-3`, `carbon`, `polaris`, `atlassian`, `primer`, `shadcn-radix`, `dtcg`) and the same five sections.
- Every bullet is one checkable fact followed by its source URL. A fact that could not be confirmed is absent, or listed under "Not confirmed" for that system.
- "raw GitHub" sources are the system's own public repository, used when the docs site could not be read.
- Short forms used in source URLs: `MW` = `https://raw.githubusercontent.com/material-components/material-web/main`, `PT` = `https://raw.githubusercontent.com/Shopify/polaris/main/polaris-tokens/src`, `PR` = `https://raw.githubusercontent.com/Shopify/polaris/main/polaris-react/src`.

| Key | System | Ships React components | Main sources read |
|---|---|---|---|
| `material-3` | Material Design 3 (Google) | No (web components, Compose, Flutter) | material-web repo docs, developer.android.com |
| `carbon` | IBM Carbon | Yes (`@carbon/react`) | carbondesignsystem.com, carbon repo |
| `polaris` | Shopify Polaris | Yes (Polaris React, legacy) and web components (current) | Shopify/polaris repo, shopify.dev |
| `atlassian` | Atlassian Design System | Yes (`@atlaskit/*`) | atlassian.design |
| `primer` | GitHub Primer | Yes (`@primer/react`) | primer.style, primer repos |
| `shadcn-radix` | Radix UI (Primitives, Themes) + shadcn/ui | Yes | radix-ui.com, ui.shadcn.com |
| `dtcg` | Design Tokens Community Group format | No (file format) | designtokens.org |

---

## `material-3` — Material Design 3

### 1. Documentation structure
- The guideline site's URL paths group pages under `/foundations`, `/styles` and `/components` (seen in links such as `m3.material.io/styles/color/overview`, `/foundations/customization`, `/components/all-buttons`). (https://developer.android.com/develop/ui/compose/designsystems/material3)
- Components are grouped by purpose in six categories: Actions, Communication, Containment, Navigation, Selection, Text inputs. (https://docs.flutter.dev/ui/widgets/material)
- An M3 theme has three subsystems: color scheme, typography, shapes. (https://developer.android.com/develop/ui/compose/designsystems/material3)

### 2. Token levels
- Three tiers: reference, system, component. Each component token maps to a system token, which maps to a reference value. (MW/docs/theming/README.md)
- Reference tokens hold concrete values. Examples: `--md-ref-typeface-brand`, `--md-ref-typeface-plain`. (MW/docs/theming/README.md)
- System tokens hold decisions and roles (color, typography, shape, motion). Examples: `--md-sys-color-primary`, `--md-sys-shape-corner-small`. (MW/docs/theming/README.md)
- Component tokens. Example: `--md-filled-button-container-color`. (MW/docs/theming/README.md)
- The reference palette has six families (primary, secondary, tertiary, neutral, neutral-variant, error), keyed family + tone, e.g. `primary40`, `neutral-variant90`; tones run 0, 10, 20 … 90, 95, 99, 100. (MW/tokens/versions/v0_192/_md-ref-palette.scss)

### 3. Naming rules
- Reference and system tokens are prefixed `--md-ref-` and `--md-sys-`, then category, then role. Component tokens are `--md-<component>-<part>-<property>` and are not prefixed with `comp`. (MW/docs/theming/README.md)
- Typescale tokens: `--md-sys-typescale-<role>-<size>-<property>`, e.g. `--md-sys-typescale-body-medium-size`. (MW/docs/theming/typography.md)
- Color roles pair a color with an "on" color: `primary` / `onPrimary`, `primaryContainer` / `onPrimaryContainer`. (https://developer.android.com/develop/ui/compose/designsystems/material3)
- A variant is a separate component, not a prop: `md-elevated-button`, `md-filled-button`, `md-filled-tonal-button`, `md-outlined-button`, `md-text-button`. (MW/docs/components/button.md)
- States appear as a prefix on the property in Compose: `pressedElevation`, `focusedElevation`, `disabledContainerColor`. (https://developer.android.com/develop/ui/compose/designsystems/material3)

### 4. Component prop conventions
- No React package. Web component buttons take `disabled`, `soft-disabled` (disabled but focusable), `href`, `trailing-icon`, `has-icon`, `type`; there is no size property. (MW/docs/components/button.md)
- Emphasis is expressed by choosing a component (extended FAB → filled button → text button), not by a `variant` prop. (https://developer.android.com/develop/ui/compose/designsystems/material3)

### 5. Scales
- Type: 15 styles = 5 roles (display, headline, title, body, label) × 3 sizes (large, medium, small). Sizes in sp: display 57/45/36, headline 32/28/24, title 22/16/14, body 16/14/12, label 14/12/11. (https://developer.android.com/develop/ui/compose/designsystems/material3)
- Radius ("shape corner"): none 0, extra-small 4px, small 8px, medium 12px, large 16px, extra-large 28px, full 9999px. (MW/tokens/versions/v0_192/_md-sys-shape.scss)
- Elevation: 6 levels, `level0`–`level5` = 0, 1, 3, 6, 8, 12. (MW/tokens/versions/v0_192/_md-sys-elevation.scss)
- Elevation is shown mainly with tonal color overlays, in addition to shadows. (https://developer.android.com/develop/ui/compose/designsystems/material3)
- Breakpoints ("window size classes", width): compact < 600dp, medium 600–839dp, expanded 840–1199dp, large 1200–1599dp, extra-large ≥ 1600dp. (https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)

### Not confirmed (left out)
- The site's exact top-level navigation labels, the dotted token form (`md.sys.color.primary`), and a spacing scale: m3.material.io pages returned only their title.

---

## `carbon` — IBM Carbon

### 1. Documentation structure
- Sidebar top level: Getting started, Building blocks, Building experiences, Support. (https://carbondesignsystem.com/components/overview/components/)
- "Building blocks" holds Foundations, Components, Patterns, Data visualization. "Getting started" holds Designing, Developing, Contributing, Migrating. (https://carbondesignsystem.com/components/overview/components/)
- Foundations pages: 2x Grid, Accessibility, Carbon for AI, Color, Content, Icons, Pictograms, Motion, Spacing, Themes, Typography. (https://carbondesignsystem.com/elements/color/overview/)
- Components are one flat alphabetical list, no categories. (https://carbondesignsystem.com/components/overview/components/)
- Each component page has tabs; the button page has Usage and Style tabs at `/usage/` and `/style/`. (https://carbondesignsystem.com/components/button/usage/)

### 2. Token levels
- Two documented color token groups: core tokens (shared across components) and component tokens (one component only). Their values point to palette steps such as Gray 10 or Blue 60. (https://carbondesignsystem.com/elements/color/tokens/)
- Core examples: `$background`, `$layer-01`, `$text-primary`, `$border-subtle-01`. (https://carbondesignsystem.com/elements/color/tokens/)
- Component examples: `$button-primary-hover`, `$tag-background-gray`. (https://carbondesignsystem.com/elements/color/tokens/)
- Four themes, each named after its background: White, Gray 10 (light), Gray 90, Gray 100 (dark). The token name stays; only its value changes per theme. (https://carbondesignsystem.com/elements/color/overview/)

### 3. Naming rules
- Token name = element (`background`, `text`, `border`) + role (`$text-primary`, `$border-subtle`) + optional state at the end (`$background-hover`). (https://carbondesignsystem.com/elements/color/overview/)
- State suffixes: `-hover`, `-active`, `-selected`, `-selected-hover`, `-disabled`; focus uses a single `$focus` token. (https://carbondesignsystem.com/elements/color/overview/)
- Numeric suffixes `-01`, `-02`, `-03` give the layer level a token pairs with (`$field-02` sits on `$layer-01`). (https://carbondesignsystem.com/elements/color/tokens/)
- Scale tokens are zero-padded ordinals: `$spacing-01` … `$spacing-13`. (https://carbondesignsystem.com/elements/spacing/overview/)
- Type tokens are `<style>-<number>`: `-01` is the productive set, `-02` the expressive set (`$body-01`, `$body-02`). (https://carbondesignsystem.com/elements/typography/type-sets/)

### 4. Component prop conventions (React)
- Button `kind`: `primary`, `secondary`, `tertiary`, `ghost`, `danger`, `danger--primary`, `danger--tertiary`, `danger--ghost`. (https://raw.githubusercontent.com/carbon-design-system/carbon/main/packages/react/src/components/Button/Button.tsx)
- Button `size`: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`. Other props: `disabled`, `isSelected`, `isExpressive`, `hasIconOnly`, `renderIcon`. (same URL)
- TextInput `size`: `xs`, `sm`, `md`, `lg`. States: `disabled`, `invalid` + `invalidText`, `warn` + `warnText`, `readOnly`. Labels: `labelText` (required), `helperText`, `hideLabel`. (https://raw.githubusercontent.com/carbon-design-system/carbon/main/packages/react/src/components/TextInput/TextInput.tsx)

### 5. Scales
- Spacing: 13 steps, `$spacing-01`–`$spacing-13` = 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 px. (https://carbondesignsystem.com/elements/spacing/overview/)
- Grid geometry is built on an 8px "mini unit". (https://carbondesignsystem.com/elements/2x-grid/overview/)
- Type: 29 type tokens in two sets, productive (base 14px) and expressive (base 16px); headings `heading-01`–`heading-07` = 14, 16, 20, 28, 32, 42, 54 px. (https://carbondesignsystem.com/elements/typography/type-sets/)
- Breakpoints: sm 320px (4 columns), md 672px (8), lg 1056px (16), xlg 1312px (16), max 1584px (16). (https://carbondesignsystem.com/elements/2x-grid/overview/)
- Button heights: xs 24, sm 32, md 40, lg 48, xl 64, 2xl 80 px. (https://carbondesignsystem.com/components/button/style/)
- Depth uses layering: light themes alternate White and Gray 10 per layer; dark themes get one step lighter per layer. (https://carbondesignsystem.com/elements/color/overview/)

### Not confirmed (left out)
- A radius scale, a shadow scale, and the React Storybook tree.

---

## `polaris` — Shopify Polaris

### 1. Documentation structure
- Polaris is now documented as a framework built on web components; the old React docs URLs redirect (301) to `shopify.dev/docs/api/polaris`. (https://shopify.dev/docs/api/polaris)
- Web component categories: Actions, Feedback and status indicators, Forms, Layout and structure, Media and visuals, Overlays, Typography and content. (https://shopify.dev/docs/api/app-home/polaris-web-components)
- Polaris React docs content folders: getting-started, foundations, design, content, patterns, components, tokens, icons, tools, contributing. (https://api.github.com/repos/Shopify/polaris/contents/polaris.shopify.com/content)
- Polaris React component categories: actions, layout-and-structure, selection-and-input, images-and-icons, feedback-indicators, typography, tables, lists, navigation, overlays, utilities, deprecated. (https://api.github.com/repos/Shopify/polaris/contents/polaris.shopify.com/content/components)

### 2. Token levels (Polaris React tokens)
- Primitive layer: a shared `size` scale and color palettes, not used directly in token names; e.g. size key `400` = 16px. (PT/size.ts)
- Semantic layer: tokens grouped by category whose values point to the primitives, e.g. `color-bg-surface` → `colors.gray[...]`, `space-400` → `size[400]`. (PT/themes/base/color.ts)
- A small component-alias layer: `space-card-padding` → `space-400`, `space-button-group-gap` → `space-200`, `shadow-button`. (PT/themes/base/space.ts)

### 3. Naming rules
- Color tokens: `color-<category>[-<variant>][-<tone>][-<state>]`; categories `bg`, `bg-surface`, `bg-fill`, `text`, `icon`, `border`. Example: `color-bg-surface-success-hover`. (PT/themes/base/color.ts)
- Tones: `info`, `success`, `caution`, `warning`, `critical`, `emphasis`, `magic`. States: `hover`, `active`, `selected`, `disabled`. (PT/themes/base/color.ts)
- Scale tokens use a number that is a multiple of a 4px step: `space-100` = 4px, `space-400` = 16px, `border-radius-200` = 8px. (PT/size.ts)
- Web component scale keywords are centred on `base`: `small-500` … `small-100`, `small`, `base`, `large`, `large-100` … `large-500`. (https://shopify.dev/docs/api/app-home/polaris-web-components/layout-and-structure/stack)
- Text variants are role + size in camelCase: `headingLg`, `bodyMd`. (PR/components/Text/Text.tsx)

### 4. Component prop conventions
- React Button `variant`: `plain`, `primary`, `secondary`, `tertiary`, `monochromePlain`. `tone`: `critical`, `success`. `size`: `micro`, `slim`, `medium`, `large`. (PR/components/Button/Button.tsx)
- React Button states: `disabled`, `loading`, `pressed`; also `fullWidth`, `accessibilityLabel`. (PR/types.ts)
- React Text `variant`: `headingXs`–`heading2xl`, `bodyXs`–`bodyLg`; `tone`: `base`, `subdued`, `success`, `critical`, `caution`, `magic`, `disabled`, `inherit`. (PR/components/Text/Text.tsx)
- Web component `s-button`: `variant` = `auto`, `primary`, `secondary`, `tertiary`; `tone` = `auto`, `neutral`, `critical`; `disabled`, `loading`; no size property. (https://shopify.dev/docs/api/app-home/polaris-web-components/actions/button)
- Web component responsive values are container queries written in the prop: `gap="@container (inline-size > 500px) base, small-300"`. (https://shopify.dev/docs/api/app-home/polaris-web-components/layout-and-structure/stack)

### 5. Scales (Polaris React tokens)
- Spacing: 18 steps, `space-0` to `space-3200` = 0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 112, 128 px. (PT/themes/base/space.ts)
- Type: 13 font sizes, `font-size-275` to `font-size-1000` = 11, 12, 13, 14, 16, 18, 20, 22, 24, 30, 32, 36, 40 px; weights regular 450, medium 550, semibold 650, bold 700. (PT/themes/base/font.ts)
- Radius: `border-radius-0`, `-050`, `-100`, `-150`, `-200`, `-300`, `-400`, `-500`, `-750`, `-full` = 0, 2, 4, 6, 8, 12, 16, 20, 30, 9999 px. (PT/themes/base/border.ts)
- Shadow: `shadow-0` to `shadow-600` (7 steps), plus `shadow-bevel-100`, `shadow-inset-100`, `shadow-inset-200`. (PT/themes/base/shadow.ts)
- Breakpoints: xs 0, sm 490px, md 768px, lg 1040px, xl 1440px. (PT/themes/base/breakpoints.ts)

### Not confirmed (left out)
- Public token values for the web components; the base unit is not stated in the source (the 4px step is read from the key/value table).

---

## `atlassian` — Atlassian Design System

### 1. Documentation structure
- Sidebar top level: Get started, Foundations, Components, Tools (plus product-specific groups). (https://atlassian.design/foundations/spacing)
- Component categories: Forms and input, Images and icons, Labels, Layout and structure, Loading, Messaging, Navigation, Overlays and layering, Primitives, Status indicators, Text and data display; then Libraries, Tooling, Deprecated. (https://atlassian.design/components)
- Component docs have a separate code page per component (`/components/button/code`). (https://atlassian.design/components/button/code)

### 2. Token levels
- The docs present one public layer of semantic tokens, named by purpose; no public primitive tier is described on the pages read. (https://atlassian.design/foundations/tokens/design-tokens)
- Examples: `color.text`, `color.icon.success`, `space.100`, `radius.small`, `font.heading.large`, `elevation.surface.raised`. (https://atlassian.design/foundations/tokens/design-tokens, https://atlassian.design/foundations/radius)

### 3. Naming rules
- Token name = foundation (`color`, `elevation`, `space`) . property (`background`, `border`, `shadow`) . optional modifier (role, emphasis, state), separated by dots. (https://atlassian.design/foundations/tokens/design-tokens)
- A token without a modifier is the default: `color.text`, `font.body`, `elevation.surface`. (https://atlassian.design/foundations/tokens/design-tokens)
- Emphasis words: `subtlest`, `subtler`, `subtle`, `bolder`. State words come last, in past tense: `hovered`, `pressed`. Example: `color.background.accent.lime.subtlest.hovered`. (https://atlassian.design/components/tokens/all-tokens)
- Space tokens use a number that is a percentage of the 8px base: `space.100` = 8px, `space.050` = 4px. (https://atlassian.design/foundations/spacing)
- Size words are spelled out: `xsmall`, `small`, `medium`, `large`, `xlarge`, `xxlarge`. (https://atlassian.design/foundations/radius)

### 4. Component prop conventions (React)
- Boolean props carry an `is` or `should` prefix: `isDisabled`, `isLoading`, `isSelected`, `shouldFitContainer`. (https://atlassian.design/components/button/code)
- Button `appearance`: `default`, `primary`, `subtle`, `warning`, `danger`, `discovery`, `rovo`. `spacing`: `default`, `compact` (no `size` prop). (https://atlassian.design/components/button/code)
- Textfield `appearance`: `standard`, `subtle`, `none`; `isCompact`, `isDisabled`, `isInvalid`, `isReadOnly`, `isRequired`. (https://atlassian.design/components/textfield/code)
- Slots are named by position: `iconBefore`, `iconAfter`. (https://atlassian.design/components/button/code)

### 5. Scales
- Spacing: base 8px; 14 steps `space.0`, `.025`, `.050`, `.075`, `.100`, `.150`, `.200`, `.250`, `.300`, `.400`, `.500`, `.600`, `.800`, `.1000` = 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80 px; negative tokens `space.negative.025` to `.400`. (https://atlassian.design/foundations/spacing)
- Type: 7 headings `font.heading.xxlarge` … `xxsmall` = 32, 28, 24, 20, 16, 14, 12 px; 3 body sizes `font.body.large`, `font.body`, `font.body.small` = 16, 14, 12 px; plus `font.metric.*` and `font.code`. (https://atlassian.design/foundations/typography)
- Radius: `radius.xsmall` 2, `small` 4, `medium` 6, `large` 8, `xlarge` 12, `xxlarge` 16 px, `radius.full`, `radius.tile`. (https://atlassian.design/foundations/radius)
- Elevation: 4 levels named sunken, default, raised, overlay; surface tokens `elevation.surface.*`, shadow tokens `elevation.shadow.raised`, `.overlay`, `.overflow`. (https://atlassian.design/foundations/elevation)
- Breakpoints (min width): xxs 320, xs 480, s 768, m 1024, l 1440, xl 1768 px; columns 2, 6, 6, 12, 12, 12. (https://atlassian.design/foundations/grid)

### Not confirmed (left out)
- The CSS custom property form of tokens, and the full list of state and emphasis words (the all-tokens page was only partly readable).

---

## `primer` — GitHub Primer

### 1. Documentation structure
- Site header: Product UI, Brand UI, Octicons, Accessibility, Brand Toolkit. (https://primer.style/product/components/)
- Product UI sidebar: Getting Started, Primitives, UI Patterns, Scenario Patterns, Components, Internal Components, React Hooks, CSS Utilities, Contribute. (https://primer.style/product/primitives/)
- Foundations sit under Getting Started: Color usage, Content, Icons, Layout, Responsive, Typography. (https://primer.style/product/primitives/)
- Components are one flat alphabetical list, no categories. (https://primer.style/product/components/)
- Primitives are split into Color, Size, Typography. (https://primer.style/product/primitives/)

### 2. Token levels
- Three tiers: base, functional, component/pattern. (https://primer.style/product/primitives/token-names/)
- Base (raw values): `base-size-4`, `base-color-green-5`. (same URL)
- Functional (global UI patterns): `bgColor-inset`, `borderColor-default`. (same URL)
- Component/pattern (component CSS only): `button-primary-bgColor-hover`, `control-danger-borderColor-rest`. (same URL)

### 3. Naming rules
- Segment order: `prefix-namespace-pattern-variant-property-variant-scale`; only `property` is required; one variant per token. (https://primer.style/product/primitives/token-names/)
- Dashes separate segments in CSS, dots in JavaScript; a multi-word segment is camelCase (`bgColor`, `borderColor`, `fgColor`). (https://primer.style/product/primitives/token-names/)
- States are the last segment: `rest`, `hover`, `active`, `disabled`, `selected` (`--button-primary-bgColor-rest`). (https://primer.style/product/primitives/color/)
- Roles: `accent`, `success`, `attention`, `severe`, `danger`, `open`, `closed`, `done`, `sponsors`; emphasis is `muted` or `emphasis` (`--bgColor-accent-muted`). (https://primer.style/product/primitives/color/)
- Density words for layout tokens: `condensed`, `normal`, `spacious`. (https://primer.style/product/primitives/size/)
- Token source files use `$value`, `$type` and `$extensions` keys. (https://raw.githubusercontent.com/primer/primitives/main/src/tokens/base/size/size.json5)

### 4. Component prop conventions (React)
- Button `variant`: `default`, `primary`, `invisible`, `danger`, `link`. `size`: `small`, `medium`, `large`. (https://raw.githubusercontent.com/primer/react/main/packages/react/src/Button/types.ts)
- Button states and layout: `disabled`, `loading`, `inactive`, `block`; slots `leadingVisual`, `trailingVisual`, `trailingAction`, `count`. (same URL)
- TextInput: `loading` with `loaderPosition` = `auto`, `leading`, `trailing`; validity is passed as `validationStatus`. (https://raw.githubusercontent.com/primer/react/main/packages/react/src/TextInput/TextInput.tsx)

### 5. Scales
- Base size: 19 steps named by pixel value, `--base-size-2` … `--base-size-128` = 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 64, 80, 96, 112, 128 px (output in rem). (https://primer.style/product/primitives/size/)
- Stack gap and padding: condensed 8, normal 16, spacious 24 px. (https://primer.style/product/primitives/size/)
- Control heights: xsmall 24, small 28, medium 32, large 40, xlarge 48 px. (https://primer.style/product/primitives/size/)
- Type: 11 text styles: display, title-large/medium/small, subtitle, body-large/medium/small, caption, codeBlock, codeInline; sizes display 40, title 32/20/16, body 16/14/12 px. (https://primer.style/product/primitives/typography/)
- Radius: `--borderRadius-small` 3, `-medium` 6 (default), `-large` 12, `-full` 9999 px. (https://primer.style/product/primitives/size/)
- Shadow: `shadow.resting.xsmall`, `.small`, `.medium`; `shadow.floating.small`, `.medium`, `.large`, `.xlarge`; `shadow.inset`. (https://raw.githubusercontent.com/primer/primitives/main/src/tokens/functional/shadow/shadow.json5)
- Breakpoints: xsmall 320, small 544, medium 768, large 1012, xlarge 1280, xxlarge 1400 px; viewport ranges narrow < 768, regular ≥ 768, wide ≥ 1400. (https://primer.style/product/getting-started/foundations/layout/)

### Not confirmed (left out)
- The values accepted by TextInput `size` and `validationStatus` (typed in a file not read).

---

## `shadcn-radix` — Radix UI (Primitives, Themes) + shadcn/ui

Three layers: Radix Primitives (unstyled behaviour), Radix Themes (styled components with tokens), shadcn/ui (component source code copied into the project).

### 1. Documentation structure
- Radix docs URL groups: Primitives under `/primitives/docs/guides` and `/primitives/docs/components`; Themes under `/themes/docs/overview`, `/themes/docs/theme`, `/themes/docs/components`. (https://www.radix-ui.com/themes/docs/theme/spacing, https://www.radix-ui.com/primitives/docs/components/dialog)
- shadcn/ui describes itself as open code distributed by a CLI, not a component library installed as a package. (https://ui.shadcn.com/docs)
- shadcn/ui docs sidebar groups include Get Started, Components, Forms, Registry. (https://ui.shadcn.com/docs/components/button)

### 2. Token levels
- Radix Themes: numbered scales (`--space-1`, `--radius-3`, `--shadow-4`, color steps 1–12) plus functional aliases that follow the theme (`--accent-9`, `--color-background`, `--color-panel-solid`, `--accent-contrast`). (https://www.radix-ui.com/themes/docs/theme/color)
- Radix color steps have fixed roles: 1–2 backgrounds, 3–5 interactive components, 6–8 borders, 9–10 solid colors, 11–12 text. (https://www.radix-ui.com/themes/docs/theme/color)
- shadcn/ui: one semantic layer of CSS variables under `:root` and `.dark`: `--background`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`. (https://ui.shadcn.com/docs/theming)

### 3. Naming rules
- shadcn/ui colors come in surface / `-foreground` pairs; the surface name has no "background" suffix: `--primary` + `--primary-foreground`, `--card` + `--card-foreground`. (https://ui.shadcn.com/docs/theming)
- Radix Themes tokens are `--<scale>-<step>`; alpha colors add `a` (`--red-a1`); focus uses `--focus-1` … `--focus-12`. (https://www.radix-ui.com/themes/docs/theme/color)
- Radix Primitives are compound parts under one namespace: `Dialog.Root`, `Dialog.Trigger`, `Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content`, `Dialog.Title`, `Dialog.Description`, `Dialog.Close`. (https://www.radix-ui.com/primitives/docs/components/dialog)
- States are data attributes, not class names: `[data-state]` = `open` | `closed`, or `checked` | `unchecked` | `indeterminate`; `[data-disabled]`. (https://www.radix-ui.com/primitives/docs/components/checkbox)
- Controlled state follows one pattern: `open` / `defaultOpen` / `onOpenChange`, `checked` / `defaultChecked` / `onCheckedChange`. (https://www.radix-ui.com/primitives/docs/components/dialog)

### 4. Component prop conventions
- Radix Themes Button: `size` = `"1"`–`"4"` (default `"2"`); `variant` = `classic`, `solid`, `soft`, `surface`, `outline`, `ghost` (default `solid`); `color`, `highContrast`, `radius`, `loading`. (https://www.radix-ui.com/themes/docs/components/button)
- Radix Themes TextField: `size` = `"1"`–`"3"`; `variant` = `classic`, `surface`, `soft`. (https://www.radix-ui.com/themes/docs/components/text-field)
- Radix Themes props accept a responsive object keyed by breakpoint: `size={{ initial: "3", md: "5" }}`. (https://www.radix-ui.com/themes/docs/theme/breakpoints)
- shadcn/ui Button: `variant` = `default`, `outline`, `ghost`, `destructive`, `secondary`, `link`; `size` = `default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`. (https://ui.shadcn.com/docs/components/button)
- shadcn/ui uses native attributes for state: `disabled` and `aria-invalid` on the input, `data-disabled` and `data-invalid` on the wrapping Field. No loading prop: a Spinner is placed inside the button. (https://ui.shadcn.com/docs/components/input, https://ui.shadcn.com/docs/components/button)

### 5. Scales
- Radix Themes spacing: 9 steps, `--space-1` … `--space-9` = 4, 8, 12, 16, 24, 32, 40, 48, 64 px, multiplied by a theme `scaling` of 90–110%. (https://www.radix-ui.com/themes/docs/theme/spacing)
- Radix Themes type: 9 numbered sizes = 12, 14, 16, 18, 20, 24, 28, 35, 60 px; weights light 300, regular 400, medium 500, bold 700. (https://www.radix-ui.com/themes/docs/theme/typography)
- Radix Themes radius: 6 steps, `--radius-1` … `--radius-6` = 3, 4, 6, 8, 12, 16 px × a theme factor (`none` 0, `small` 0.75, `medium` 1, `large` 1.5, `full` 1.5). (https://raw.githubusercontent.com/radix-ui/themes/main/packages/radix-ui-themes/src/styles/tokens/radius.css)
- Radix Themes shadow: 6 steps; 1 inset, 2–3 classic panels, 4–5 small overlays, 6 large overlays. (https://www.radix-ui.com/themes/docs/theme/shadows)
- Radix Themes breakpoints: initial 0, xs 520, sm 768, md 1024, lg 1280, xl 1640 px. (https://www.radix-ui.com/themes/docs/theme/breakpoints)
- shadcn/ui radius: one base `--radius` (0.625rem by default); `--radius-sm`, `-md`, `-lg`, `-xl`, `-2xl`, `-3xl`, `-4xl` = base × 0.6, 0.8, 1, 1.4, 1.8, 2.2, 2.6. (https://ui.shadcn.com/docs/theming)
- shadcn/ui colors are written in `oklch()`; base color options are Neutral, Stone, Zinc, Mauve, Olive, Mist, Taupe. (https://ui.shadcn.com/docs/theming)

### Not confirmed (left out)
- Radix docs sidebar labels (only URL groups were read), Radix Themes font-size token names, shadcn/ui `asChild` and `data-slot` conventions, and shadcn/ui spacing, type and breakpoint scales (not defined on the pages read).

---

## `dtcg` — Design Tokens Format Module (naming and format reference)

### 1. Documentation structure
- Version 2025.10 is a Final Community Group Report dated 28 October 2025, described as stable; it is not a W3C Standard. (https://www.designtokens.org/tr/2025.10/format/)
- The 2025.10 specification has three modules: Format, Color, Resolver. (https://www.designtokens.org/tr/2025.10/)
- Token files are JSON; recommended extensions `.tokens` and `.tokens.json`; media type `application/design-tokens+json`. (https://www.designtokens.org/tr/2025.10/format/)

### 2. Token levels
- The format does not prescribe tiers. Groups are arbitrary and tools should not infer type or purpose from them. (https://www.designtokens.org/tr/2025.10/format/)
- Tiers are built with aliases: a token's `$value` can reference another token with `{group.token}`; `$ref` with a JSON Pointer reaches a single property. (same URL)
- Example: token `color.brand.primary` with `$value` `{color.blue.500}` (names illustrate the syntax; the spec does not fix them). (same URL)

### 3. Naming rules
- A token is an object with `$value`; a group is an object without it. The object key is the name. (https://www.designtokens.org/tr/2025.10/format/)
- Names are case-sensitive, must not start with `$`, and must not contain `{`, `}` or `.`. (same URL)
- Reserved properties start with `$`: `$value`, `$type`, `$description`, `$extensions`, `$deprecated`; groups also take `$extends`; `$root` names a token at group level. (same URL)
- `$type` is inherited from the nearest parent group; tools must not guess a type from the value. (same URL)
- `$extensions` keys should use reverse domain notation (as in Primer's `org.primer.figma`). (same URL, https://raw.githubusercontent.com/primer/primitives/main/src/tokens/base/size/size.json5)

### 4. Component prop conventions
- Not applicable: the format describes tokens only, not components.

### 5. Scales (value types)
- Simple types: `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`. (https://www.designtokens.org/tr/2025.10/format/)
- Composite types: `strokeStyle`, `border`, `transition`, `shadow`, `gradient`, `typography`. (same URL)
- `dimension` is an object with a numeric `value` and a `unit` of `px` or `rem`; `duration` uses `ms` or `s`. (same URL)
- `typography` has `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight` (a multiplier of font size). `shadow` has `color`, `offsetX`, `offsetY`, `blur`, `spread`, optional `inset`. (same URL)
- The format defines no scale values: steps and their names are left to each system. (same URL)

---

## Comparison tables

### Token tiers

| System | Tier 1 (raw) | Tier 2 (meaning) | Tier 3 (component) |
|---|---|---|---|
| `material-3` | reference: `--md-ref-typeface-brand` | system: `--md-sys-color-primary` | component: `--md-filled-button-container-color` |
| `carbon` | palette steps (Blue 60) | core: `$layer-01` | component: `$button-primary-hover` |
| `polaris` | `size[400]`, `colors.gray[n]` | `color-bg-surface`, `space-400` | alias: `space-card-padding` |
| `atlassian` | not described publicly | `color.icon.success` | not described |
| `primer` | base: `base-size-4` | functional: `bgColor-inset` | component/pattern: `button-primary-bgColor-hover` |
| `shadcn-radix` | Radix scales: `--gray-3`, `--space-4` | `--accent-9`, shadcn `--primary` | none |
| `dtcg` | not prescribed (aliases allow any depth) | — | — |

### Variant, size and state vocabulary (button)

| System | Variant prop and values | Size prop and values | State props |
|---|---|---|---|
| `material-3` | none: one element per variant (`md-filled-button`…) | none | `disabled`, `soft-disabled` |
| `carbon` | `kind`: primary, secondary, tertiary, ghost, danger… | `size`: xs, sm, md, lg, xl, 2xl | `disabled`, `isSelected` |
| `polaris` (React) | `variant`: plain, primary, secondary, tertiary + `tone`: critical, success | `size`: micro, slim, medium, large | `disabled`, `loading`, `pressed` |
| `atlassian` | `appearance`: default, primary, subtle, warning, danger, discovery | `spacing`: default, compact | `isDisabled`, `isLoading`, `isSelected` |
| `primer` | `variant`: default, primary, invisible, danger, link | `size`: small, medium, large | `disabled`, `loading`, `inactive` |
| Radix Themes | `variant`: classic, solid, soft, surface, outline, ghost + `color` | `size`: "1"–"4" | `disabled`, `loading` |
| shadcn/ui | `variant`: default, outline, ghost, destructive, secondary, link | `size`: default, xs, sm, lg, icon… | native `disabled`, `aria-invalid` |

### Scales

| System | Spacing (px) | Type styles | Radius steps (px) | Elevation steps | Breakpoints (px or dp) |
|---|---|---|---|---|---|
| `material-3` | not confirmed | 15 (5 roles × 3 sizes) | 0, 4, 8, 12, 16, 28, full | 6 levels (0–5) | 600, 840, 1200, 1600 |
| `carbon` | 13 steps, 2–160 | 29 tokens, 2 sets | not confirmed | layering model | 320, 672, 1056, 1312, 1584 |
| `polaris` | 18 steps, 0–128 | 13 font sizes | 0, 2, 4, 6, 8, 12, 16, 20, 30, full | 7 steps (0–600) | 0, 490, 768, 1040, 1440 |
| `atlassian` | 14 steps, 0–80 | 7 headings + 3 body | 2, 4, 6, 8, 12, 16, full | 4 named levels | 320, 480, 768, 1024, 1440, 1768 |
| `primer` | 19 steps, 2–128 | 11 styles | 3, 6, 12, full | 3 resting + 4 floating | 320, 544, 768, 1012, 1280, 1400 |
| Radix Themes | 9 steps, 4–64 | 9 sizes | 3, 4, 6, 8, 12, 16 × factor | 6 steps | 520, 768, 1024, 1280, 1640 |

---

## Cross-system patterns

### What most systems agree on
1. Docs separate foundations (color, type, spacing, layout) from components, and keep patterns as a third group: `carbon` (Foundations / Components / Patterns), `polaris` (foundations / components / patterns), `atlassian` (Foundations / Components), `primer` (Foundations / Components / UI Patterns), `material-3` (foundations / styles / components).
2. Tokens are layered so that a named meaning points to a raw value: `material-3` (reference → system → component), `primer` (base → functional → component/pattern), `polaris` (size and palette → category tokens → aliases), `carbon` (palette → core → component); `dtcg` supports this through aliases.
3. Component-level tokens exist but are meant for that component only: `material-3`, `carbon`, `primer`, `polaris` (aliases such as `space-card-padding`).
4. Semantic color names start with the element they paint (background, text or foreground, border, icon), then the role: `carbon`, `polaris`, `atlassian`, `primer`.
5. The interaction state is the last segment of a token name: `carbon` (`-hover`), `polaris` (`-hover`), `atlassian` (`.hovered`), `primer` (`-hover`, `-rest`).
6. Themes (light, dark) keep the same token names and change only the values: `carbon`, `material-3`, `shadcn-radix`, `primer`.
7. A surface color is paired with a named content color to put on it: `material-3` (`primary` / `onPrimary`), `shadcn-radix` (`--primary` / `--primary-foreground`), `carbon` (`$text-on-color`), `primer` (`--fgColor-onEmphasis`), `polaris` (`on-bg-fill`).
8. Spacing scales share the values 4, 8, 12, 16, 24, 32, 40, 48, 64 px, and the gap between steps grows toward the top: `carbon`, `polaris`, `atlassian`, `primer`, Radix Themes. All but Radix Themes also have a 2px step.
9. A "full" radius step exists next to the numeric steps: `material-3`, `polaris`, `atlassian`, `primer`, Radix Themes (as a theme setting).
10. Text styles are named by role plus a size word or ordinal rather than by pixel value: `material-3` (`body-medium`), `atlassian` (`font.heading.large`), `primer` (`title-large`), `polaris` (`headingLg`), `carbon` (`heading-03`).
11. A 768px breakpoint appears in `polaris`, `atlassian`, `primer` and Radix Themes; 1024px in `atlassian` and Radix Themes; 1440px in `polaris` and `atlassian`.
12. React buttons expose a visual-style prop with a short closed list, and `primary` is one of its values in `carbon`, `polaris`, `atlassian` and `primer`; `disabled` and `loading` are the common state props (`polaris`, `atlassian`, `primer`, Radix Themes).

### Where they clearly differ
1. Name of the visual-style prop: `kind` (`carbon`), `variant` (`polaris`, `primer`, Radix Themes, shadcn/ui), `appearance` (`atlassian`); `material-3` uses a separate component per variant.
2. Size vocabulary: abbreviations `xs`/`sm`/`md`/`lg` (`carbon`, shadcn/ui), full words `small`/`medium`/`large` (`primer`, `atlassian` tokens), numbers `"1"`–`"4"` (Radix Themes), own words `micro`/`slim` (`polaris` React), `default`/`compact` spacing (`atlassian` Button).
3. Scale step naming: ordinals `01`–`13` (`carbon`), pixel value in the name (`primer` `base-size-16`), multiple of a base (`polaris` `space-400` = 16px, `atlassian` `space.200` = 16px), plain index (Radix `--space-4` = 16px), T-shirt words (`material-3` radius, `atlassian` radius).
4. Boolean prop style: `is`/`should` prefix (`atlassian`: `isDisabled`, `isInvalid`), bare adjective (`carbon`, `polaris`, `primer`: `disabled`, `invalid`, `loading`), native and ARIA attributes (shadcn/ui: `disabled`, `aria-invalid`), data attributes for styling (Radix Primitives: `data-state`, `data-disabled`).
5. Component catalogue: grouped by purpose (`material-3`, `polaris`, `atlassian`) versus one flat alphabetical list (`carbon`, `primer`).
6. Separators and case in token names: dots (`atlassian`, `dtcg` references), dashes with camelCase segments (`primer`), dashes all lower case (`carbon`, `polaris`, `material-3`, `shadcn-radix`).
