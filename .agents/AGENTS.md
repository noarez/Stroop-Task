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
3. **Documentation Sync**: Keep `instructions.md` updated whenever UI flow, architecture, or endpoints change.
4. **Deploy Scripts**:
   - Static frontend: `./scripts/deploy.sh`
   - Backend Lambda: `./scripts/deploy-lambda.sh`
