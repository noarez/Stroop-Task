---
title: Stroop Task System Architecture
description: Comprehensive OKF knowledge entry covering frontend, serverless backend, and PsyToolkit data export pipelines.
version: 1.0.0
last_updated: 2026-07-25
tags:
  - architecture
  - serverless
  - aws
  - psytoolkit
---

# Stroop Task System Architecture

## Overview
The Stroop Task application is a full-stack psychological research web app built using vanilla HTML/CSS/JS for the frontend and AWS Serverless infrastructure for data collection and administrative management.

## Component Breakdown

### 1. Frontend Client
- **Files:** `index.html`, `app.js`, `style.css`
- **Hosting:** Amazon S3 (`stroop-task-app-462355913922`) served globally via Amazon CloudFront (`https://stroop-effect.com`).
- **Timing:** All reaction-time (RT) data collection uses `performance.now()` client-side for millisecond-level precision.
- **Fail-safe:** If network calls fail, raw trial records are cached in `sessionStorage`.

### 2. Backend Serverless API
- **Function:** AWS Lambda (`stroop-task-api` Node.js 20.x).
- **Gateway:** AWS API Gateway HTTP API (`stroop-http-api`).
- **Endpoints:**
  - `POST /api/submit`: Writes per-participant trial JSON files to S3.
  - `GET /analytics`: Research Analytics Dashboard with dataset mode tabs:
    - `?key=organic` (Default): Real participant submissions.
    - `?key=acme`: Pre-seeded realistic Stroop Effect literature simulation ($N=48$).
    - `?key=testing`: Developer test runs.
  - `GET /analytics/download`: Downloads aggregated CSV for selected dataset mode.
  - `GET /analytics/download-psytoolkit`: Exports PsyToolkit-compatible ZIP package for selected mode.

### 3. Data Storage Pipeline
- **Bucket:** `stroop-task-data-462355913922`
- **Pattern:** Write-many, read-combined. Each session writes `results/{pid}_{timestamp}.json`.
