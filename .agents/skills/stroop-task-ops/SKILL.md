---
name: stroop-task-ops
description: Operational, testing, deployment, and PsyToolkit data export workflows for the Stroop Task repository.
---

# Stroop Task Operational Workflows

This skill guides AI agents through development, verification, deployment, and data management for the Stroop Task application.

## Core Reference Documents
- **`AGENTS.md`**: Project architecture overview and agent efficiency guidelines.
- **`instructions.md`**: Behavioral/demographic specifications, UX copy, and API contract details.
- **`references/aws-architecture.md`**: In-depth AWS resource mapping, IAM roles, and endpoint configurations.

## Quick Workflow Instructions

### 1. Local Testing & Verification
- Run `npm run dev` to start the local Express server on `http://localhost:3000`.
- Verify admin dashboard access at `http://localhost:3000/admin?key=stroop_admin_2024`.
- Validate data submission via `POST /api/submit`.

### 2. AWS Serverless Deployment
- **Frontend (Static HTML/CSS/JS):** `./scripts/deploy.sh`
  - Uploads static files to S3 bucket `stroop-task-app-462355913922` and invalidates CloudFront distribution `E2CMN4DB120036`.
- **Backend (Lambda API):** `./scripts/deploy-lambda.sh`
  - Packages `./lambda` and updates AWS Lambda function `stroop-task-api`.

### 3. PsyToolkit Data Export Verification
- Download test dataset from `/admin/download-psytoolkit?key=stroop_admin_2024`.
- Ensure `data.csv` contains header + demographic rows.
- Verify per-participant `.txt` files under `stroop/` folder are 4 space-separated columns (`block_type`, `condition`, `STATUS`, `RT`).

