# Design notes — Kazi (working name for the marketplace)

Subject: a marketplace where African freelancers (starting with web dev, design,
video editing, writing) get hired for real project work. The page's job: make
posting a job or submitting a proposal feel fast, trustworthy, and unglamorous —
this is a working tool, not a landing page selling a dream.

## Palette
- `--ink: #16211B`        — near-black with a green undertone, primary text
- `--paper: #F4F2EC`      — warm off-white background, not the AI-cliché cream
- `--indigo: #2C3E6B`     — deep indigo, primary actions & links (adire/indigo-dye reference)
- `--ochre: #C98A2C`      — warm ochre/ampesi gold, used sparingly for emphasis/status
- `--clay: #A63D2F`       — muted terracotta-red, reserved for warnings/destructive actions only
- `--line: #D8D3C4`       — hairline borders, dividers

## Type
- Display/headings: 'Fraunces' (serif with warmth and some character, restrained weights)
- Body/UI: 'Inter' (clean, legible at small sizes for form-heavy screens)
- Mono/data (bid amounts, ids): 'IBM Plex Mono'

## Layout concept
Left-aligned, document-like forms rather than centered marketing cards — this is
a tool people will use daily, not a one-time signup moment. Job listings render
as a dense, scannable list (like a job board / classifieds page), not big glossy
cards. Status uses text + a small colored dot, not badges with rounded pills
everywhere (avoids the generic SaaS-dashboard look).

## Signature element
A single hairline-rule "ledger" style used across job listings and proposal
comparisons — thin horizontal rules separating rows, right-aligned numbers
(budget, bid amount) in mono type, evoking a real ledger/invoice rather than a
card grid. This is the one consistent, memorable device tying pages together.

## Restraint check
- No numbered 01/02/03 markers (no real sequence here).
- No gradient hero, no big centered stat callout.
- Motion: minimal — a subtle fade-in on list rows on load, focus rings always visible, no scroll-triggered flourishes.
