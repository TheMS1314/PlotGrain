---
name: product-interface
description: Design, refine, and verify a web product interface. Use for landing pages, app workspaces, responsive layouts, accessibility, performance budgets, or interface polish.
---

# Product interface

Use this workflow from the first design decision through the browser review.

## Choose the experience

1. Identify the audience, primary task, and the most concrete thing you can show to explain the product. Turn those into screen-level acceptance checks.
2. Read the project's design system and existing components. Preserve the parts of the interaction that people already rely on. Reuse shared tokens, actions, and content patterns.
3. Choose one visual direction that suits the work. Specify the hierarchy at wide and compact sizes. Give the main action an obvious place and show the product or its output early.
4. Use product data, real screens, or relevant imagery. Give illustrative content an accurate caption. Give each later section a distinct purpose.

## Build the workflow

- Design controls for keyboard, pointer, and touch. Use visible focus and keep focus with the user when dialogs, disclosures, and modes close.
- Define selected, disabled, loading, empty, failure, and success states where they apply. Reserve space for important changing content.
- Preserve semantic headings, names, links, native controls, and zoom. Keep text readable at the narrowest supported width.
- Use short, local transitions as feedback. Honor reduced motion.
- Keep the initial route lean. Set media dimensions, serve a suitable image size, and defer below-fold media.

## Verify before release

1. Build the production artifact and exercise the critical flows in a real browser with representative data.
2. Capture desktop and compact viewport images. Open them and check reading order, clear space around controls, legibility, and overlap. Fix observed issues and recapture.
3. Automate key navigation, keyboard focus, interaction states, accessibility checks, and a route-appropriate asset budget. Treat screenshots as design evidence and report what was visually reviewed.
4. Keep product design rules in `DESIGN.md` and run the project-specific checks. For Plotgrain, run `npm run lint:design` and `npm run test:design`. Reports and images are written to `artifacts/design/`.
5. State the browsers and sizes used, and any limitation that affects the result.

Calibrate your review with [Vercel’s Web Interface Guidelines](https://vercel.com/design/guidelines), [Lovable’s design systems guidance](https://docs.lovable.dev/features/design-systems), and [WCAG](https://www.w3.org/WAI/standards-guidelines/wcag/).
