# Project Goals & OKRs (Objectives and Key Results)

## Objective 1: High-Reliability Psychological Data Collection
- **KR 1.1:** 0% loss of participant trial data (supported by local browser `sessionStorage` fallback & S3 persistence).
- **KR 1.2:** Response reaction time (RT) accuracy measured at millisecond precision via `performance.now()`.
- **KR 1.3:** 100% data export compatibility with PsyToolkit `psytkReadData()` R analysis package.

## Objective 2: Ultra Low-Cost & Serverless Cloud Infrastructure
- **KR 2.1:** $0.00/month recurring infrastructure cost within AWS Free Tier.
- **KR 2.2:** Global static file delivery under 100ms latency to Israeli participants via CloudFront edge nodes.
- **KR 2.3:** Automated single-command deployment scripts for both frontend static assets and backend serverless API.

## Objective 3: Optimal AI Agent Pair-Programming Efficiency
- **KR 3.1:** Zero unnecessary context fetching during AI coding sessions (enforced via `.gitignore` and `.agents/AGENTS.md`).
- **KR 3.2:** Explicit modular skill instructions available in `.agents/skills/` for deployment, operational tasks, and data verification.
