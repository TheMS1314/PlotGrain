---
version: alpha
name: Plotgrain
description: Early-site feasibility for development and architecture teams in Bangkok.
colors:
  ink: "#222820"
  muted: "#515e53"
  deep: "#172820"
  primary: "#244736"
  primary-hover: "#1a3629"
  paper: "#f6f5ee"
  surface: "#fdfdf8"
  wash: "#ebeee5"
  accent: "#dce9c4"
  line: "#d8ddd0"
  control-line: "#748779"
  focus: "#426849"
typography:
  editorial:
    fontFamily: Instrument Serif
    fontSize: 88px
    fontWeight: 400
    lineHeight: 0.92
    letterSpacing: -0.038em
  body:
    fontFamily: Instrument Sans Variable
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: Instrument Sans Variable
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.2
  measurement:
    fontFamily: IBM Plex Mono
    fontSize: 14px
    fontWeight: 500
rounded:
  control: 8px
  surface: 12px
spacing:
  control-gap: 8px
  panel-gap: 10px
  page-gutter-minimum: 18px
  section-gap: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: 46px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    height: 46px
  workspace-tool-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
  secondary-control-outline:
    backgroundColor: "{colors.control-line}"
    size: 1px
  focus-ring:
    backgroundColor: "{colors.focus}"
    size: 2px
  panel-divider:
    backgroundColor: "{colors.line}"
    size: 1px
  preview-selector-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    height: 42px
  workspace-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
  workspace-canvas-surround:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  media-caption:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
  closing-callout:
    backgroundColor: "{colors.deep}"
    textColor: "{colors.paper}"
---

# Plotgrain design system

## Overview

Plotgrain presents early site feasibility with the restraint of an architectural practice. The Bangkok illustration fills the opening cover, with an editorial headline and two actions in its lower left. The working Bang Son example follows in a dark panel with the map beside its measurements. The workspace uses the same deep green for the masthead and comparison header, with light surfaces for site work.

## Colors

Use warm paper for the landing page, pale sage for supporting sections, and off-white for workspace panels. Deep green carries the main action and the selected preview view. Soft green indicates a selected workspace tool. Give map layers and review warnings their own contrast so the brand palette leaves room for data.

## Typography

Instrument Serif gives the landing page its editorial scale. Use its italic face for the second line of the hero. Instrument Sans carries the navigation, instructions, and controls. Use tabular figures or IBM Plex Mono where a reader compares measurements across rows.

## Layout

Keep the architectural subject visible at each crop. Shade the lower left of the cover to keep the headline and actions legible, and stack the image and measurements in the case study at phone widths. Give same-site concept comparisons matched diagram dimensions, scale, and camera angle. Offer side-by-side and overlay layouts with the same measurements and rule checks in both. The workspace uses a central map and compact side panels on wide screens. Narrow layouts put the map first, group canvas controls, and expose labeled jumps to inputs and results.

## Elevation & Depth

Use hairline dividers and low-contrast shadows at panel edges. Give architectural imagery and the map room to establish most of the visual depth.

## Shapes

Use eight-pixel control corners and twelve-pixel corners for larger surfaces. The Plotgrain mark pairs a rotated parcel outline with a lower plan edge on a green tile.

## Motion & Micro-interaction

Give hover, focus, and press states immediate feedback. Short control transitions take 150 milliseconds. The reduced-motion setting disables transitions and the small landing-page press movement.

## Voice & Content Strategy

Use concrete labels such as “Site plan,” “Open this view,” and “Export study.” Tie example outputs to the Bang Son parcel. Call out illustrative images, estimated context heights, and assumptions where a reader encounters them.

## Components

Use filled green buttons for the next action, visible outlines for secondary actions, and a filled selected state within the preview control. Show a two-pixel focus ring on interactive elements. In the workspace, reserve color in the results for states that need a reader’s attention.

## Do's and Don'ts

- Keep the navigation, product mark, and control vocabulary consistent between routes.
- Let the real study preview demonstrate the product and give it a direct link.
- Reserve decorative treatments for the architectural image and mark. Keep the controls and measurement panels quiet.
