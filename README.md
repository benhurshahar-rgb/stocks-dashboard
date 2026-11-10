# דשבורד השוואת השקעה

השוואה בין מניות, מדד ה-S&P 500, תיק שווה משקל ופיקדון, בהשקעה של 3.7 מיליון ₪ בכל אפיק.

- הדשבורד: https://benhurshahar-rgb.github.io/stocks-dashboard/
- המחירים מתעדכנים אוטומטית ב-GitHub Actions (`.github/workflows/update.yml`): כל חצי שעה בזמן המסחר בארה"ב ואחרי הסגירה. אין שימוש ב-Claude ואין עלות.
- רשימת הנכסים והסכום: `config.json` (אפשר לערוך מהדשבורד).
- הנתונים: `data.json`, נוצר על ידי `scripts/update.py` מ-Yahoo Finance.
