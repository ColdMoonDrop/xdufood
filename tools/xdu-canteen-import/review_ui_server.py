from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sys
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import xdu_canteen_importer as importer

REPO_ROOT = importer.REPO_ROOT
REVIEW_JSON = importer.REVIEW_ROOT / "review.json"
OCR_JSON = importer.OCR_ROOT / "ocr-results.json"
MANIFEST_JSON = importer.RAW_ROOT / "articles.manifest.json"
IMAGE_ROOT = importer.IMAGE_ROOT.resolve()

ALLOWED_UPDATE_FIELDS = {
    "reviewStatus",
    "dishName",
    "price",
    "windowNo",
    "windowName",
    "area",
    "floor",
    "sourceText",
    "types",
    "available",
    "heat",
    "notes",
    "imageKind",
    "parseWarnings",
}


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    temp.replace(path)


def load_state() -> dict[str, Any]:
    records = load_json(REVIEW_JSON, [])
    changed = False
    for index, record in enumerate(records):
        if "reviewId" not in record:
            record["reviewId"] = importer.review_id(record)
            changed = True
        record["_index"] = index
    if changed:
        records_to_write = [{key: value for key, value in record.items() if key != "_index"} for record in records]
        write_json(REVIEW_JSON, records_to_write)

    ocr_results = load_json(OCR_JSON, [])
    image_map = {}
    for image in ocr_results:
        image_path = image.get("imagePath")
        if not image_path:
            continue
        image_map[image_path] = {
            "articleId": image.get("articleId"),
            "imageIndex": image.get("imageIndex"),
            "imagePath": image_path,
            "imageUrl": image.get("imageUrl"),
            "imageKind": importer.classify_image(image),
            "lines": image.get("lines", []),
        }

    manifest = load_json(MANIFEST_JSON, [])
    return {
        "records": records,
        "images": image_map,
        "articles": [
            {
                "id": article.get("id"),
                "area": article.get("area"),
                "campus": article.get("campus"),
                "sourceTitle": article.get("sourceTitle"),
                "updatedAt": article.get("updatedAt"),
            }
            for article in manifest
        ],
        "summary": build_summary(records, image_map, manifest),
    }


def build_summary(records: list[dict[str, Any]], image_map: dict[str, Any], manifest: list[dict[str, Any]]) -> dict[str, Any]:
    by_status: dict[str, int] = {"pending": 0, "approved": 0, "rejected": 0}
    by_record_kind: dict[str, int] = {"menu": 0, "map": 0, "slogan": 0, "other": 0}
    by_image_kind: dict[str, int] = {"menu": 0, "map": 0, "slogan": 0, "other": 0}
    for record in records:
        by_status[record.get("reviewStatus", "pending")] = by_status.get(record.get("reviewStatus", "pending"), 0) + 1
        image_kind = record.get("imageKind", "other")
        by_record_kind[image_kind] = by_record_kind.get(image_kind, 0) + 1
    for image in image_map.values():
        image_kind = image.get("imageKind", "other")
        by_image_kind[image_kind] = by_image_kind.get(image_kind, 0) + 1
    return {
        "records": len(records),
        "withPrice": sum(1 for record in records if record.get("price")),
        "ocrRecords": sum(1 for record in records if record.get("sourceMethod") == "ocr"),
        "duplicateMerged": sum(1 for record in records if int(record.get("duplicateCount") or 1) > 1),
        "images": len(image_map),
        "articles": len(manifest),
        "status": by_status,
        "imageKind": by_image_kind,
        "recordImageKind": by_record_kind,
    }


def update_record(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    records = load_json(REVIEW_JSON, [])
    for record in records:
        record.setdefault("reviewId", importer.review_id(record))
        if record["reviewId"] != record_id:
            continue
        for field, value in payload.items():
            if field not in ALLOWED_UPDATE_FIELDS:
                continue
            if field == "price":
                record[field] = normalize_price(value)
            elif field in {"types", "available"}:
                record[field] = [str(item) for item in value] if isinstance(value, list) else record.get(field, [])
            elif field == "parseWarnings":
                record[field] = [str(item) for item in value] if isinstance(value, list) else record.get(field, [])
            elif field == "imageKind":
                record[field] = value if value in importer.IMAGE_KINDS else record.get(field, "other")
            elif field == "reviewStatus":
                record[field] = value if value in {"pending", "approved", "rejected"} else "pending"
            else:
                record[field] = value
        if payload.get("autoInfer", True) and payload.get("dishName"):
            record["types"] = importer.infer_types(record["dishName"])
            record["available"] = importer.infer_available(record["dishName"])
            record["heat"] = importer.infer_heat(record["dishName"])
        record["locationHint"] = importer.format_location_hint(
            record.get("area", ""),
            record.get("floor", ""),
            record.get("windowNo", ""),
            record.get("windowName", ""),
        )
        write_json(REVIEW_JSON, records)
        return record
    raise KeyError(record_id)


def normalize_price(value: Any) -> float | int | None:
    if value in {"", None}:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return int(number) if number.is_integer() else round(number, 2)


def ai_suggest_record(record_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    records = load_json(REVIEW_JSON, [])
    image_map = importer.load_ocr_image_map()
    for record in records:
        record.setdefault("reviewId", importer.review_id(record))
        if record["reviewId"] != record_id:
            continue
        suggestion = importer.suggest_record_with_openai(
            record,
            image_map,
            model=importer.OPENAI_VISION_MODEL,
            timeout=60,
        )
        suggestion["model"] = importer.OPENAI_VISION_MODEL
        suggestion["reviewedAt"] = importer.dt.datetime.now(importer.dt.timezone.utc).isoformat(timespec="seconds")
        importer.apply_ai_suggestion_to_record(record, suggestion)
        write_json(REVIEW_JSON, records)
        return record, suggestion
    raise KeyError(record_id)


def safe_image_path(raw_path: str) -> Path:
    relative = unquote(raw_path).replace("\\", "/").lstrip("/")
    path = (REPO_ROOT / relative).resolve()
    if IMAGE_ROOT not in path.parents and path != IMAGE_ROOT:
        raise ValueError("Image path is outside the canteen image cache.")
    if not path.exists():
        raise FileNotFoundError(path)
    return path


class ReviewHandler(BaseHTTPRequestHandler):
    server_version = "XduReviewUI/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_text(INDEX_HTML, "text/html; charset=utf-8")
            return
        if parsed.path == "/api/state":
            self.send_json(load_state())
            return
        if parsed.path == "/api/summary":
            state = load_state()
            self.send_json(state["summary"])
            return
        if parsed.path == "/image":
            query = parse_qs(parsed.query)
            try:
                image_path = safe_image_path(query.get("path", [""])[0])
                content_type = mimetypes.guess_type(str(image_path))[0] or "application/octet-stream"
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(image_path.read_bytes())
            except Exception as error:
                self.send_error(HTTPStatus.NOT_FOUND, str(error))
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        match = re.fullmatch(r"/api/records/([0-9a-fA-F]+)", parsed.path)
        if not match:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        try:
            payload = self.read_json_body()
            record = update_record(match.group(1), payload)
            self.send_json({"ok": True, "record": record, "summary": load_state()["summary"]})
        except KeyError:
            self.send_error(HTTPStatus.NOT_FOUND, "Record not found")
        except Exception as error:
            self.send_error(HTTPStatus.BAD_REQUEST, str(error))

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        ai_match = re.fullmatch(r"/api/records/([0-9a-fA-F]+)/ai-suggest", parsed.path)
        if ai_match:
            try:
                record, suggestion = ai_suggest_record(ai_match.group(1))
                self.send_json({"ok": True, "record": record, "suggestion": suggestion, "summary": load_state()["summary"]})
            except KeyError:
                self.send_error(HTTPStatus.NOT_FOUND, "Record not found")
            except Exception as error:
                self.send_error(HTTPStatus.BAD_REQUEST, str(error))
            return
        if parsed.path == "/api/generate":
            try:
                importer.command_generate(argparse.Namespace())
                self.send_json({"ok": True, "message": "已生成正式前端数据。", "summary": load_state()["summary"]})
            except Exception as error:
                self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, value: Any) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, value: str, content_type: str) -> None:
        body = value.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[review-ui] {self.address_string()} {format % args}")


INDEX_HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>西电食堂菜单复核台</title>
  <style>
    :root {
      --ink: #16211c;
      --muted: #66736c;
      --page: #f2f5f1;
      --surface: #ffffff;
      --line: #dce5de;
      --green: #1f8a64;
      --green-dark: #146b50;
      --orange: #e79a2e;
      --red: #c94a3c;
      --blue: #2b6d8f;
      --shadow: 0 14px 36px rgba(25, 44, 36, 0.10);
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      color: var(--ink);
      background: var(--page);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 1100px; }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    .shell { display: grid; grid-template-rows: auto 1fr; min-height: 100vh; }
    header {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) auto;
      gap: 18px;
      align-items: center;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(255,255,255,.96);
      box-shadow: 0 6px 24px rgba(25, 44, 36, .05);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    h1 { margin: 0 0 4px; font-size: 23px; letter-spacing: 0; }
    .sub { margin: 0; color: var(--muted); font-size: 13px; }
    .stats { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .stat { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #f8fbf8; font-size: 13px; font-weight: 800; }
    .workspace { display: grid; grid-template-columns: 360px minmax(520px, 1fr) 380px; gap: 14px; padding: 14px; min-height: 0; }
    .panel { min-height: calc(100vh - 96px); border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow); overflow: hidden; }
    .filters { padding: 14px; border-bottom: 1px solid var(--line); background: #fbfdfb; }
    .filterGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .filters input, .filters select, .editor input, .editor select, .editor textarea {
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 7px 9px;
      background: #fff;
      color: var(--ink);
    }
    .filters label { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 13px; font-weight: 800; }
    .recordList { height: calc(100vh - 252px); overflow: auto; padding: 8px; }
    .record { width: 100%; text-align: left; border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fff; transition: border-color .14s ease, transform .14s ease; }
    .record:hover { transform: translateY(-1px); border-color: rgba(31,138,100,.35); }
    .record.active { border-color: var(--green); box-shadow: inset 4px 0 0 var(--green); }
    .record strong { display: block; font-size: 15px; line-height: 1.32; }
    .record small { display: block; margin-top: 5px; color: var(--muted); line-height: 1.35; }
    .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .badge { padding: 3px 7px; border-radius: 999px; background: #edf5f1; color: var(--green-dark); font-size: 12px; font-weight: 800; }
    .badge.price { background: #fff1cf; color: #6b4b0f; }
    .badge.reject { background: #fae9e7; color: var(--red); }
    .badge.kind { background: #e8f2f6; color: var(--blue); }
    .badge.duplicate { background: #f4ecff; color: #5f3c90; }
    .badge.warn { background: #fff4df; color: #805719; }
    .badge.aiBadge { background: #fff0df; color: #8a4e0e; }
    .imagePanel { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto auto; }
    .imageHeader, .editorHeader { padding: 13px 14px; border-bottom: 1px solid var(--line); background: #fbfdfb; }
    .imageHeader strong, .editorHeader strong { display: block; font-size: 16px; }
    .imageHeader span, .editorHeader span { color: var(--muted); font-size: 13px; }
    .imageTools {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border-bottom: 1px solid var(--line);
      background: #ffffff;
    }
    .imageTools button {
      min-width: 38px;
      min-height: 32px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fbf8;
      color: var(--ink);
      font-weight: 900;
    }
    .imageTools button:hover { border-color: rgba(31,138,100,.38); color: var(--green-dark); }
    .zoomValue {
      min-width: 64px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 850;
      text-align: center;
    }
    .imageStage { overflow: auto; padding: 16px; background: #edf2ef; }
    .imageWrap { position: relative; width: fit-content; max-width: 100%; margin: 0 auto; background: #fff; border: 1px solid var(--line); box-shadow: var(--shadow); }
    .imageWrap img { display: block; max-width: none; height: auto; user-select: none; }
    .box { position: absolute; border: 2px solid rgba(43,109,143,.58); background: rgba(43,109,143,.12); pointer-events: none; }
    .box.current { border-color: var(--red); background: rgba(201,74,60,.18); box-shadow: 0 0 0 2px rgba(201,74,60,.18); }
    .focusPanel {
      display: grid;
      grid-template-columns: 132px 1fr;
      gap: 10px;
      align-items: center;
      min-height: 136px;
      padding: 10px 12px;
      border-top: 1px solid var(--line);
      background: #fbfdfb;
    }
    .focusPanel.hidden { display: none; }
    .focusText strong { display: block; margin-bottom: 5px; font-size: 14px; }
    .focusText span { display: block; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .focusCanvasWrap { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    #focusCanvas { display: block; width: 100%; height: 118px; image-rendering: auto; }
    .lineDock { max-height: 170px; overflow: auto; border-top: 1px solid var(--line); background: #fff; padding: 10px 12px; }
    .lineDock button { border: 1px solid var(--line); border-radius: 999px; padding: 5px 8px; margin: 0 6px 6px 0; background: #fff; color: var(--muted); font-size: 12px; }
    .lineDock button.current { color: #fff; background: var(--red); border-color: var(--red); }
    .editor { padding: 14px; overflow: auto; height: calc(100vh - 149px); }
    .formRow { margin-bottom: 12px; }
    .formRow label { display: block; margin-bottom: 6px; color: var(--muted); font-size: 13px; font-weight: 800; }
    .statusButtons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
    .statusButtons button, .actionBar button, .generateButton {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font-weight: 850;
    }
    .statusButtons button.active.pending { color: #67470c; background: #fff3d6; border-color: #f0c36c; }
    .statusButtons button.active.approved { color: #fff; background: var(--green); border-color: var(--green); }
    .statusButtons button.active.rejected { color: #fff; background: var(--red); border-color: var(--red); }
    .actionBar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
    .actionBar .save { color: #fff; border-color: var(--green); background: var(--green); }
    .actionBar .next { color: #fff; border-color: var(--blue); background: var(--blue); }
    .actionBar .ai { color: #fff; border-color: var(--orange); background: var(--orange); }
    .generateButton { width: 100%; margin-top: 10px; color: #fff; border-color: var(--ink); background: var(--ink); }
    .hint { padding: 10px; border-radius: 8px; background: #f5f8f6; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .empty { padding: 22px; color: var(--muted); text-align: center; }
    .toast { position: fixed; right: 18px; bottom: 18px; padding: 10px 13px; border-radius: 8px; background: var(--ink); color: #fff; box-shadow: var(--shadow); opacity: 0; transform: translateY(10px); transition: .18s ease; z-index: 40; }
    .toast.show { opacity: 1; transform: translateY(0); }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>西电食堂菜单复核台</h1>
        <p class="sub">左侧选择 OCR 候选，中央对照原图与文字框，右侧直接修改并保存。</p>
      </div>
      <div class="stats" id="stats"></div>
    </header>
    <section class="workspace">
      <aside class="panel">
        <div class="filters">
          <div class="filterGrid">
            <select id="statusFilter">
              <option value="pending">待复核</option>
              <option value="approved">已通过</option>
              <option value="rejected">已拒绝</option>
              <option value="all">全部</option>
            </select>
            <select id="sourceFilter">
              <option value="ocr">OCR 图片</option>
              <option value="html-text">正文文本</option>
              <option value="all">全部来源</option>
            </select>
          </div>
          <div class="filterGrid">
            <select id="articleFilter"><option value="all">全部食堂</option></select>
            <input id="queryInput" placeholder="搜索菜名 / 窗口 / OCR 原文">
          </div>
          <div class="filterGrid">
            <select id="imageKindFilter">
              <option value="menu">菜单图</option>
              <option value="map">导视图</option>
              <option value="slogan">标语图</option>
              <option value="other">其他图</option>
              <option value="all">全部类型</option>
            </select>
            <select id="duplicateFilter">
              <option value="hide">隐藏重复合并项</option>
              <option value="only">只看重复合并项</option>
              <option value="all">全部重复状态</option>
            </select>
          </div>
          <label><input type="checkbox" id="priceOnly" checked> 只看带价格候选</label>
          <label><input type="checkbox" id="problemOnly" checked> 优先显示疑似问题项</label>
        </div>
        <div class="recordList" id="recordList"></div>
      </aside>
      <section class="panel imagePanel">
        <div class="imageHeader">
          <strong id="imageTitle">未选择记录</strong>
          <span id="imageSub">选择左侧候选后显示图片与 OCR 框。</span>
        </div>
        <div class="imageTools">
          <button id="zoomOut" title="缩小图片">−</button>
          <button id="zoomIn" title="放大图片">＋</button>
          <button id="zoomFit" title="适配当前面板宽度">适配</button>
          <button id="zoomReset" title="按原始尺寸显示">1:1</button>
          <span class="zoomValue" id="zoomValue">100%</span>
        </div>
        <div class="imageStage">
          <div class="imageWrap" id="imageWrap">
            <img id="sourceImage" alt="">
          </div>
        </div>
        <div class="focusPanel hidden" id="focusPanel">
          <div class="focusText">
            <strong>红框特写</strong>
            <span id="focusMeta">自动截取当前 OCR 框周围区域。</span>
          </div>
          <div class="focusCanvasWrap">
            <canvas id="focusCanvas" width="720" height="180"></canvas>
          </div>
        </div>
        <div class="lineDock" id="lineDock"></div>
      </section>
      <aside class="panel">
        <div class="editorHeader">
          <strong>编辑复核结果</strong>
          <span id="saveState">未保存更改会留在表单中。</span>
        </div>
        <div class="editor" id="editor">
          <div class="empty">请选择一条候选。</div>
        </div>
      </aside>
    </section>
  </main>
  <div class="toast" id="toast"></div>
  <script>
    const state = { records: [], images: {}, articles: [], selectedId: null };
    const view = { zoom: 1, userZoom: false, minZoom: 0.25, maxZoom: 4 };
    const $ = (id) => document.getElementById(id);

    async function loadState() {
      const response = await fetch('/api/state');
      const data = await response.json();
      state.records = data.records;
      state.images = data.images;
      state.articles = data.articles;
      renderStats(data.summary);
      renderArticleOptions();
      renderList();
    }

    function renderStats(summary) {
      $('stats').innerHTML = [
        `文章 ${summary.articles}`,
        `图片 ${summary.images}`,
        `候选 ${summary.records}`,
        `带价格 ${summary.withPrice}`,
        `合并重复 ${summary.duplicateMerged || 0}`,
        `导视图 ${summary.imageKind?.map || 0}`,
        `待复核 ${summary.status.pending || 0}`,
        `已通过 ${summary.status.approved || 0}`,
        `已拒绝 ${summary.status.rejected || 0}`,
      ].map((text) => `<span class="stat">${text}</span>`).join('');
    }

    function renderArticleOptions() {
      const selected = $('articleFilter').value || 'all';
      $('articleFilter').innerHTML = '<option value="all">全部食堂</option>' + state.articles
        .map((article) => `<option value="${escapeHtml(article.id)}">${escapeHtml(article.area || article.id)}</option>`)
        .join('');
      $('articleFilter').value = selected;
    }

    function filteredRecords() {
      const status = $('statusFilter').value;
      const source = $('sourceFilter').value;
      const article = $('articleFilter').value;
      const query = $('queryInput').value.trim().toLowerCase();
      const priceOnly = $('priceOnly').checked;
      const problemOnly = $('problemOnly').checked;
      const imageKind = $('imageKindFilter').value;
      const duplicate = $('duplicateFilter').value;
      return state.records.filter((record) => {
        if (status !== 'all' && record.reviewStatus !== status) return false;
        if (source !== 'all' && record.sourceMethod !== source) return false;
        if (article !== 'all' && record.articleId !== article) return false;
        if (imageKind !== 'all' && (record.imageKind || 'other') !== imageKind) return false;
        if (duplicate === 'hide' && Number(record.duplicateCount || 1) > 1) return false;
        if (duplicate === 'only' && Number(record.duplicateCount || 1) <= 1) return false;
        if (priceOnly && !record.price) return false;
        if (problemOnly && !isProblem(record)) return false;
        if (query) {
          const text = `${record.dishName || ''} ${record.windowName || ''} ${record.locationHint || ''} ${record.area || ''} ${record.sourceText || ''}`.toLowerCase();
          if (!text.includes(query)) return false;
        }
        return true;
      }).sort((a, b) => problemScore(b) - problemScore(a)).slice(0, 600);
    }

    function problemScore(record) {
      let score = 0;
      if (record.sourceMethod === 'ocr') score += 4;
      if (record.price) score += 3;
      if ((record.ocrConfidence ?? 1) < 0.86) score += 6;
      if (!record.sourceImagePath) score -= 3;
      if (looksBadName(record.dishName || '')) score += 8;
      if ((record.parseWarnings || []).length) score += 3;
      if ((record.sourceText || '').length > 22) score += 2;
      return score;
    }

    function isProblem(record) {
      if (record.reviewStatus !== 'pending') return false;
      if (!record.price && record.sourceMethod === 'html-text') return false;
      return problemScore(record) >= 7 || record.price;
    }

    function looksBadName(name) {
      const value = name.trim();
      return value.length < 2 ||
        /^[A-Za-z0-9()[\]【】.,，。·…/\-_\s]+$/.test(value) ||
        /办公室|电话|微信|NBC|^\W+$|^[份碗个杯/／]+$/.test(value);
    }

    function renderList() {
      const records = filteredRecords();
      if (!records.length) {
        $('recordList').innerHTML = '<div class="empty">没有符合条件的候选。</div>';
        return;
      }
      $('recordList').innerHTML = records.map((record) => `
        <button class="record ${record.reviewId === state.selectedId ? 'active' : ''}" data-id="${record.reviewId}">
          <div class="badges">
            <span class="badge ${record.reviewStatus === 'rejected' ? 'reject' : ''}">${statusLabel(record.reviewStatus)}</span>
            <span class="badge kind">${imageKindLabel(record.imageKind)}</span>
            ${record.price ? `<span class="badge price">¥${record.price}</span>` : ''}
            ${record.ocrConfidence ? `<span class="badge">${Math.round(record.ocrConfidence * 100)}%</span>` : ''}
            ${Number(record.duplicateCount || 1) > 1 ? `<span class="badge duplicate">重复×${record.duplicateCount}</span>` : ''}
            ${record.parseWarnings?.length ? `<span class="badge warn">${record.parseWarnings.length}个提示</span>` : ''}
            ${record.aiSuggestion ? `<span class="badge aiBadge">AI ${record.aiSuggestion.action}</span>` : ''}
          </div>
          <strong>${escapeHtml(record.dishName || '未识别菜名')}</strong>
          <small>${escapeHtml(record.locationHint || `${record.area || ''} · ${record.windowNo || ''}# ${record.windowName || ''}`)}</small>
          <small>${escapeHtml(record.sourceText || record.sourceMethod || '')}</small>
        </button>
      `).join('');
      document.querySelectorAll('.record').forEach((button) => {
        button.addEventListener('click', () => selectRecord(button.dataset.id));
      });
      if (!state.selectedId && records[0]) selectRecord(records[0].reviewId);
    }

    function selectRecord(id) {
      state.selectedId = id;
      document.querySelectorAll('.record').forEach((button) => button.classList.toggle('active', button.dataset.id === id));
      const record = state.records.find((item) => item.reviewId === id);
      renderImage(record);
      renderEditor(record);
    }

    function renderImage(record) {
      const image = record && record.sourceImagePath ? state.images[record.sourceImagePath] : null;
      const img = $('sourceImage');
      const wrap = $('imageWrap');
      wrap.querySelectorAll('.box').forEach((box) => box.remove());
      $('lineDock').innerHTML = '';
      $('focusPanel').classList.add('hidden');
      view.zoom = 1;
      view.userZoom = false;
      updateZoomLabel();
      if (!image) {
        $('imageTitle').textContent = record ? `${record.area} · 正文文本候选` : '未选择记录';
        $('imageSub').textContent = '这条记录没有对应图片，通常来自公众号正文文本。';
        img.removeAttribute('src');
        img.style.width = '';
        return;
      }
      $('imageTitle').textContent = `${record.area} · 第 ${image.imageIndex} 张图`;
      $('imageSub').textContent = `${record.windowNo || ''}# ${record.windowName || ''}`;
      img.onload = () => {
        fitImage(false);
        drawBoxes(record, image);
        renderFocus(record, image);
      };
      img.src = `/image?path=${encodeURIComponent(image.imagePath)}`;
      if (img.complete) {
        fitImage(false);
        drawBoxes(record, image);
        renderFocus(record, image);
      }
      $('lineDock').innerHTML = image.lines.map((line) => `
        <button class="${line.text === record.sourceText ? 'current' : ''}" title="${escapeHtml(String(line.confidence || ''))}">
          ${escapeHtml(line.text)}
        </button>
      `).join('');
    }

    function drawBoxes(record, image) {
      const img = $('sourceImage');
      const wrap = $('imageWrap');
      wrap.querySelectorAll('.box').forEach((box) => box.remove());
      const scaleX = img.clientWidth / img.naturalWidth;
      const scaleY = img.clientHeight / img.naturalHeight;
      image.lines.forEach((line) => {
        if (!Array.isArray(line.box) || line.box.length < 4) return;
        const box = document.createElement('div');
        box.className = 'box' + (line.text === record.sourceText ? ' current' : '');
        box.style.left = `${line.box[0] * scaleX}px`;
        box.style.top = `${line.box[1] * scaleY}px`;
        box.style.width = `${Math.max(4, (line.box[2] - line.box[0]) * scaleX)}px`;
        box.style.height = `${Math.max(4, (line.box[3] - line.box[1]) * scaleY)}px`;
        wrap.appendChild(box);
      });
    }

    function setZoom(nextZoom, userZoom = true) {
      const img = $('sourceImage');
      if (!img.naturalWidth) return;
      view.zoom = Math.min(view.maxZoom, Math.max(view.minZoom, nextZoom));
      view.userZoom = userZoom;
      applyZoom();
      const record = state.records.find((item) => item.reviewId === state.selectedId);
      const image = record && record.sourceImagePath ? state.images[record.sourceImagePath] : null;
      if (record && image) {
        drawBoxes(record, image);
        renderFocus(record, image);
      }
    }

    function applyZoom() {
      const img = $('sourceImage');
      if (!img.naturalWidth) return;
      img.style.width = `${Math.round(img.naturalWidth * view.zoom)}px`;
      updateZoomLabel();
    }

    function updateZoomLabel() {
      $('zoomValue').textContent = `${Math.round(view.zoom * 100)}%`;
    }

    function fitImage(userZoom = true) {
      const img = $('sourceImage');
      const stage = document.querySelector('.imageStage');
      if (!img.naturalWidth || !stage) return;
      const available = Math.max(280, stage.clientWidth - 36);
      setZoom(Math.min(1.6, available / img.naturalWidth), userZoom);
    }

    function resetZoom() {
      setZoom(1, true);
    }

    function renderFocus(record, image) {
      const img = $('sourceImage');
      const canvas = $('focusCanvas');
      const panel = $('focusPanel');
      const ctx = canvas.getContext('2d');
      if (!ctx || !img.complete || !img.naturalWidth || !Array.isArray(record.sourceBox) || record.sourceBox.length < 4) {
        panel.classList.add('hidden');
        return;
      }
      panel.classList.remove('hidden');
      const [x1, y1, x2, y2] = record.sourceBox.map(Number);
      const boxWidth = Math.max(8, x2 - x1);
      const boxHeight = Math.max(8, y2 - y1);
      const padX = Math.max(80, boxWidth * 2.4);
      const padY = Math.max(46, boxHeight * 3.0);
      const sx = Math.max(0, x1 - padX);
      const sy = Math.max(0, y1 - padY);
      const sw = Math.min(img.naturalWidth - sx, boxWidth + padX * 2);
      const sh = Math.min(img.naturalHeight - sy, boxHeight + padY * 2);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const scaleX = canvas.width / sw;
      const scaleY = canvas.height / sh;
      ctx.strokeStyle = '#c94a3c';
      ctx.lineWidth = 4;
      ctx.fillStyle = 'rgba(201,74,60,.12)';
      const rx = (x1 - sx) * scaleX;
      const ry = (y1 - sy) * scaleY;
      const rw = boxWidth * scaleX;
      const rh = boxHeight * scaleY;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      $('focusMeta').textContent = `OCR：${record.sourceText || record.dishName || ''}`;
    }

    function renderEditor(record) {
      if (!record) {
        $('editor').innerHTML = '<div class="empty">请选择一条候选。</div>';
        return;
      }
      $('editor').innerHTML = `
        <div class="statusButtons">
          ${['pending', 'approved', 'rejected'].map((status) => `
            <button class="${record.reviewStatus === status ? `active ${status}` : ''}" data-status="${status}">${statusLabel(status)}</button>
          `).join('')}
        </div>
        <div class="formRow"><label>菜名</label><input id="dishName" value="${escapeAttr(record.dishName || '')}"></div>
        <div class="formRow"><label>价格</label><input id="price" type="number" min="0" step="0.5" value="${record.price ?? ''}"></div>
        <div class="formRow"><label>窗口号</label><input id="windowNo" value="${escapeAttr(record.windowNo || '')}"></div>
        <div class="formRow"><label>窗口名</label><input id="windowName" value="${escapeAttr(record.windowName || '')}"></div>
        <div class="formRow"><label>图片类型</label><select id="imageKind">
          ${['menu', 'map', 'slogan', 'other'].map((kind) => `<option value="${kind}" ${kind === (record.imageKind || 'other') ? 'selected' : ''}>${imageKindLabel(kind)}</option>`).join('')}
        </select></div>
        <div class="formRow"><label>OCR 原文</label><textarea id="sourceText" rows="3">${escapeHtml(record.sourceText || '')}</textarea></div>
        <div class="hint">
          位置：${escapeHtml(record.locationHint || '待补充')}<br>
          ${Number(record.duplicateCount || 1) > 1 ? `已合并 ${record.duplicateCount} 条重复来源。<br>` : ''}
          ${record.aiSuggestion ? `AI 建议：${escapeHtml(record.aiSuggestion.action)} · ${escapeHtml(record.aiSuggestion.reason || '')}<br>` : ''}
          ${(record.parseWarnings || []).length ? `解析提示：${escapeHtml(record.parseWarnings.join('、'))}` : '解析提示：无'}
        </div>
        <div class="hint">
          通过标准：菜名、价格、窗口和图片能互相对应。明显是电话、编号、装饰字、单独单位或一行混多个价格的，建议拒绝或修正后再通过。
        </div>
        <div class="actionBar">
          <button class="ai" id="aiSuggestButton">AI 识图</button>
          <button class="save" id="saveButton">保存</button>
          <button class="next" id="saveNextButton">保存并下一条</button>
        </div>
        <button class="generateButton" id="generateButton">生成正式推荐数据</button>
      `;
      document.querySelectorAll('[data-status]').forEach((button) => {
        button.addEventListener('click', () => {
          record.reviewStatus = button.dataset.status;
          renderEditor(record);
        });
      });
      $('aiSuggestButton').addEventListener('click', aiSuggestCurrent);
      $('saveButton').addEventListener('click', () => saveCurrent(false));
      $('saveNextButton').addEventListener('click', () => saveCurrent(true));
      $('generateButton').addEventListener('click', generateDataset);
    }

    async function aiSuggestCurrent() {
      const record = state.records.find((item) => item.reviewId === state.selectedId);
      if (!record) return;
      $('aiSuggestButton').disabled = true;
      $('aiSuggestButton').textContent = '识别中';
      const response = await fetch(`/api/records/${record.reviewId}/ai-suggest`, { method: 'POST' });
      if (!response.ok) {
        toast(`AI 识图失败：${await response.text()}`);
        renderEditor(record);
        return;
      }
      const data = await response.json();
      const index = state.records.findIndex((item) => item.reviewId === record.reviewId);
      state.records[index] = { ...data.record, _index: state.records[index]._index };
      renderStats(data.summary);
      renderList();
      selectRecord(record.reviewId);
      toast(`AI 建议：${data.suggestion.action}`);
    }

    async function saveCurrent(moveNext) {
      const record = state.records.find((item) => item.reviewId === state.selectedId);
      if (!record) return;
      const payload = {
        reviewStatus: document.querySelector('[data-status].active')?.dataset.status || record.reviewStatus,
        dishName: $('dishName').value.trim(),
        price: $('price').value,
        windowNo: $('windowNo').value.trim(),
        windowName: $('windowName').value.trim(),
        imageKind: $('imageKind').value,
        sourceText: $('sourceText').value.trim(),
        autoInfer: true,
      };
      const response = await fetch(`/api/records/${record.reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        toast(`保存失败：${await response.text()}`);
        return;
      }
      const data = await response.json();
      const index = state.records.findIndex((item) => item.reviewId === record.reviewId);
      state.records[index] = { ...data.record, _index: state.records[index]._index };
      renderStats(data.summary);
      toast('已保存');
      const list = filteredRecords();
      renderList();
      if (moveNext) {
        const next = list.find((item) => item.reviewId !== record.reviewId);
        if (next) selectRecord(next.reviewId);
      } else {
        selectRecord(record.reviewId);
      }
    }

    async function generateDataset() {
      const response = await fetch('/api/generate', { method: 'POST' });
      if (!response.ok) {
        toast(`生成失败：${await response.text()}`);
        return;
      }
      toast('已生成正式推荐数据');
      await loadState();
    }

    function statusLabel(status) {
      return { pending: '待复核', approved: '通过', rejected: '拒绝' }[status] || status;
    }

    function imageKindLabel(kind) {
      return { menu: '菜单图', map: '导视图', slogan: '标语图', other: '其他图' }[kind || 'other'] || kind;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function escapeAttr(value) { return escapeHtml(value).replace(/"/g, '&quot;'); }
    function toast(message) {
      $('toast').textContent = message;
      $('toast').classList.add('show');
      setTimeout(() => $('toast').classList.remove('show'), 2200);
    }

    ['statusFilter', 'sourceFilter', 'articleFilter', 'imageKindFilter', 'duplicateFilter', 'queryInput', 'priceOnly', 'problemOnly'].forEach((id) => {
      $(id).addEventListener('input', () => {
        state.selectedId = null;
        renderList();
      });
    });
    $('zoomOut').addEventListener('click', () => setZoom(view.zoom / 1.25, true));
    $('zoomIn').addEventListener('click', () => setZoom(view.zoom * 1.25, true));
    $('zoomFit').addEventListener('click', () => fitImage(true));
    $('zoomReset').addEventListener('click', resetZoom);
    window.addEventListener('resize', () => {
      const record = state.records.find((item) => item.reviewId === state.selectedId);
      if (!record) return;
      const image = record.sourceImagePath ? state.images[record.sourceImagePath] : null;
      if (!view.userZoom && image) fitImage(false);
      if (image) {
        drawBoxes(record, image);
        renderFocus(record, image);
      }
    });
    loadState().catch((error) => toast(`加载失败：${error.message}`));
  </script>
</body>
</html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the visual XDU menu review UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the review UI in the default browser.")
    args = parser.parse_args()

    if not REVIEW_JSON.exists():
        print("review.json does not exist. Run npm run data:xdu:review first.", file=sys.stderr)
        raise SystemExit(1)

    server = ThreadingHTTPServer((args.host, args.port), ReviewHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Review UI: {url}")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping review UI.")


if __name__ == "__main__":
    main()
