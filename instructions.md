# מטלת סטרופ - הוראות (Stroop Task Instructions)

## מסך 0: הסכמה מדעת (Consent Screen)
**טקסט המחקר:**
* "משתתף/ת יקר/ה! שלום לכולם, אנחנו אלה גולדברג ונועה רזניק סטודנטיות לפסיכולוגיה, שאלון זה מועבר במסגרת עבודה סמינריונית לתואר ראשון (BA) בפסיכולוגיה."
* "המחקר עוסק בקשר בין רקע אישי ומאפיינים דמוגרפיים לבין תפקודים ניהוליים."
* "נודה לך אם תסכים/י להשתתף במחקר שלנו ותסייע/י בהשיבך על השאלות השונות. לתשומת לבך ההשתתפות במחקר הינה **אנונימית**, המידע שיימסר ישמש לצורכי מחקר ולא יועבר לגורם אחר. כמו כן, חשוב לענות על כל השאלות. השאלות מבטאות את דעתך האישית."
* "נציין, כי אם הינך מרגיש/ה אי נוחות, אינך חייב/ת לסיים את המחקר ויכול/ה לפרוש בכל עת."

**פרטי יצירת קשר (מוסתר ונפתח בלחיצה):**
* אלה גולדברג — ellagold283@gmail.com · 054-7805806
* נועה רזניק — noa.rez@gmail.com · 054-9989598

---

## אשף דמוגרפי (Demographics Wizard)

### שאלה 1: גיל
* **שאלה:** מה גילך?
* **סוג:** סליידר (טווח 18 - 120, ערך התחלתי: 25)

### שאלה 2: מגדר
* **שאלה:** מה המגדר שלך?
* **סוג:** כפתורי בחירה (זכר 👨 / נקבה 👩 / אחר ⚧️)

### שאלה 3: השכלה
* **שאלה:** שנות לימוד?
* **סוג:** סליידר (טווח 0 - 30, ערך התחלתי: 12)

### שאלה 4: שפת אם
* **שאלה:** מהי שפת האם שלך?
* **סוג:** כפתורי בחירה בסגנון מודרני (מסגרת גרדיאנט בבחירה + סימן מים עדין של קוד השפה במקום דגלים: עברית HE / ערבית AR / רוסית RU / אנגלית EN / אמהרית AM / צרפתית FR / ספרדית ES / אחר ++)

### שאלה 5: שפות נוספות
* **שאלה:** האם אתה דובר שפות נוספות?
* **סוג:** כן / לא
* **במידה ונבחר "כן", מופיעות השאלות הבאות עבור כל שפה:**
  * מהי השפה? (רשת כפתורי בחירה בסגנון החדש במקום טקסט חופשי)
  * באיזה גיל התחלת לדבר בשפה? (כפתורי רדיו בשורה אחת: 0–6 / 6–12 / 12–18 / 18–30 / 30+)
  * רמת שליטה (סליידר 1–10)
  * תדירות שימוש יומיומי (כפתורי רדיו בשורה אחת: בכלל לא / לעתים רחוקות / מדי כמה ימים / כל יום)

---

## הוראות לנבדק לפני האימון:
ברוכים הבאים **לאימון** במטלת הצבעים
במטלה יופיעו שמות של צבעים
יש ללחוץ על **הצבע** שבו צבועה המילה
יש להתעלם ממשמעות המילה
כל צעד מוגבל בזמן
גע כאן כדי להתחיל אימון

## הוראות לנבדק לפני המטלה האמיתית (אחרי משוב האימון):
!סוף האימון
תשובות נכונות: X מתוך 6
זכרו! יש ללחוץ על **הצבע** שבו צבועה המילה
יש להתעלם ממשמעות המילה
געו כאן להמשיך לביצוע המטלה
המטלה אורכת 2.5 דקות
*הערת מפתח: פס הזמן הויזואלי (countdown bar) יוסתר במהלך המטלה האמיתית כדי לא להסיח את דעת הנבדק, אך מגבלת הזמן לכל תגובה עדיין פועלת ברקע.*

---

## Server Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Serves the Stroop task app (`index.html`) |
| `POST /api/submit` | Saves trial data to `data/results.csv` |
| `GET /admin?key=...` | Admin dashboard (row count, last submissions) |
| `GET /admin/download?key=...` | Downloads full `results.csv` (researcher format) |
| `GET /admin/download-psytoolkit?key=...` | Downloads PsyToolkit-compatible ZIP for teacher handoff |

**Admin key:** `stroop_admin_2024` (set via `ADMIN_KEY` env var in production)

---

## PsyToolkit Export Format

The `/admin/download-psytoolkit` endpoint generates a ZIP that mirrors PsyToolkit's standard survey+experiment export, compatible with `psytkReadData()` in R.

### ZIP Structure
```
psytoolkit_stroop_YYYY-MM-DD.zip
├── data.csv                        ← demographics, one row per participant
└── stroop/
    ├── SP-ABC123-XXXXX.txt         ← trial data per participant
    └── ...
```

### `data.csv` Columns
`participant, start_time, end_time, age, gender, gender_other, education_years, mother_tongue, has_add_lang, additional_languages_data, stroop`

### Per-Participant `.txt` Format
Space-separated, 4 columns per trial row:

| Col | Values | Meaning |
|---|---|---|
| 1 | `1`=practice, `2`=real | Block type |
| 2 | `1`=congruent, `2`=incongruent | Condition |
| 3 | `1`=correct, `2`=wrong, `3`=timeout | STATUS |
| 4 | integer ms (0 on timeout) | RT |

### R Analysis Usage
```r
library(PsyToolkit)
d <- psytkReadData("data")   # point to unzipped folder
# Filter: V1==2 (real), V3==1 (correct), V2==1/2 (congruent/incongruent), V4=RT
```


