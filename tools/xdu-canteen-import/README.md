# XDU canteen importer

This folder keeps the official XDU logistics menu import separate from the React app.

Typical workflow:

```powershell
npm run data:xdu:setup
npm run data:xdu:fetch
npm run data:xdu:ocr
npm run data:xdu:generate
```

Generated review files are written to `data/xdu-canteen/review/`.
Only rows marked `approved` with a positive price are emitted into
`src/data/xduOfficialCanteens.generated.ts`.

Useful review steps:

- Run `npm run data:xdu:review-ui`.
- Open `http://127.0.0.1:8765/`.
- Compare each OCR row with the source image and bounding box.
- Edit dish/window/price directly in the page, then mark rows as approved or rejected.
- If `OPENAI_API_KEY` is set, click "AI 识图" on a difficult OCR row, or run
  `npm run data:xdu:ai-review -- --limit 10` to get vision-based corrections.
  AI suggestions can modify pending rows or reject side dishes, but never mark rows
  as approved.
- Click "生成正式推荐数据" or run `npm run data:xdu:generate`.

Side dishes/add-ons such as rice, fried eggs, extra noodles, bacon, fish tofu,
and similar low-price toppings are filtered out before review data is generated.
