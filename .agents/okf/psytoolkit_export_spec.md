---
title: PsyToolkit Export Format Specification
description: Technical OKF specification detailing data mapping, ZIP structure, and R package integration for PsyToolkit.
version: 1.0.0
last_updated: 2026-07-25
tags:
  - psytoolkit
  - r-integration
  - data-export
  - specification
---

# PsyToolkit Export Format Specification

## Overview
This specification details how trial data collected by the Stroop Task web app is converted into the exact data structure expected by PsyToolkit's R analysis package (`psytkReadData`).

## ZIP Package Layout
```
psytoolkit_stroop_YYYY-MM-DD.zip
├── data.csv                        ← Demographics table (1 row per participant)
└── stroop/
    ├── <participant_id>.txt         ← Trial-level data (1 row per trial)
    └── ...
```

## Data Schema & Mapping Rules

### 1. `data.csv` (Demographics & Metadata)
Header:
`participant,start_time,end_time,age,gender,gender_other,education_years,mother_tongue,has_add_lang,additional_languages_data,stroop`

### 2. `stroop/<participant_id>.txt` (Trial Data)
Format: Plain space-separated ASCII text file.
Columns: `V1 V2 V3 V4`

| Column | Internal Field | Encoded Value Mapping | Meaning |
|---|---|---|---|
| **V1** | `is_task` | `1` = Practice trial<br>`2` = Real trial | Block Type |
| **V2** | `condition` | `1` = Congruent<br>`2` = Incongruent | Task Condition |
| **V3** | `accuracy` / `user_input` | `1` = Correct response<br>`2` = Wrong response<br>`3` = Timeout | Response Status |
| **V4** | `rt_ms` | Rounded integer (e.g. `450`), or `0` on timeout | Reaction Time (ms) |

## R Package Usage Example
```r
library(PsyToolkit)
d <- psytkReadData("data") # Point to unzipped folder containing data.csv and stroop/
```
