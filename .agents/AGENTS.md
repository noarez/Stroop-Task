# Workspace Rules for AI Assistant (Antigravity)

## Project Overview
This repository contains a full-stack Stroop Task web application for psychological research.

- **Frontend:** Vanilla JS (`app.js`), HTML (`index.html`), CSS (`style.css`), served statically via AWS S3 + CloudFront CDN (`https://stroop-effect.com`).
- **Backend / API:** AWS Lambda function (`lambda/index.js`) + API Gateway (`/api/submit`, `/admin`, `/admin/download`, `/admin/download-psytoolkit`).
- **Data Storage:** Serverless JSON files in S3 bucket `stroop-task-data-462355913922`.
- **Local Dev:** Express server (`server.js`) running on `npm run dev`.

## Token & Cost Optimization Guidelines for AI Coding Agents
1. **Never read `node_modules` or `lambda/node_modules`**: Rely on package manifests (`package.json`) and specific source files.
2. **Concise file viewing**: Avoid fetching whole large files if line ranges suffice.
## Knowledge Catalog & Open Knowledge Format (OKF)
5. **Check OKF Specifications (`.agents/okf/`)**: Before planning major features, infrastructure changes, or data transformations, inspect the YAML-frontmatter Markdown specifications in `.agents/okf/`:
   - `.agents/okf/stroop_architecture.md`: Canonical AWS architecture and infrastructure map.
   - `.agents/okf/psytoolkit_export_spec.md`: Dataset schema and PsyToolkit export mapping rules.

## UI/UX & Code Quality Safeguards for AI Agents (Regression Prevention)
1. **Design Token Discipline:** All colors, background tints, fonts, borders, and shadows MUST consume existing CSS variables from `:root` / `@media (prefers-color-scheme: light)`. Do NOT introduce ad-hoc CSS variables or hardcoded hex colors unless explicitly adding to the design token list.
2. **Dual-Mode Compliance Requirement:** Every UI change MUST be evaluated for BOTH Light Mode AND Dark Mode. Never hardcode dark or light backgrounds/text-shadows that break contrast in the opposite theme.
3. **No Nested Containers ("Box-in-a-Box"):** Always inspect parent HTML containers (`.card`, `.wide-card`) before styling child elements. Do NOT add heavy card borders, background cards, or extra paddings inside an element that already resides in a `.card`.
4. **Preserve Developer Testing Hooks:** Never delete, omit, or disable developer testing hooks in `app.js` (e.g., `window.testInsight`).
5. **Automated Verification:** Run Playwright smoke tests (`npx playwright test`) after making UI/UX or app logic changes to verify zero regressions.


