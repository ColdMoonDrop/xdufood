from __future__ import annotations

import argparse
import base64
import csv
import datetime as dt
import hashlib
import html
import io
import json
import os
import re
import sys
import time
from http.client import IncompleteRead
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - optional until setup runs
    BeautifulSoup = None

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DATA_ROOT = REPO_ROOT / "data" / "xdu-canteen"
RAW_ROOT = DATA_ROOT / "raw"
HTML_ROOT = RAW_ROOT / "html"
IMAGE_ROOT = RAW_ROOT / "images"
OCR_ROOT = DATA_ROOT / "ocr"
REVIEW_ROOT = DATA_ROOT / "review"
ARTICLES_FILE = SCRIPT_DIR / "articles.json"
SEED_REVIEWED_FILE = SCRIPT_DIR / "seed-reviewed.json"
GENERATED_TS = REPO_ROOT / "src" / "data" / "xduOfficialCanteens.generated.ts"

WECHAT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 "
        "MicroMessenger/8.0.47 NetType/WIFI Language/zh_CN"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
}

PRICE_RE = re.compile(
    r"(?:[¥￥]\s*(?P<currency>\d{1,3}(?:\.\d{1,2})?))"
    r"|(?P<number>\d{1,3}(?:\.\d{1,2})?)\s*(?P<unit>元|块|/份|/碗|/个|/杯|份|碗|个|杯)"
    r"|(?P<chinese>[一二两三四五六七八九十])元"
)
WINDOW_RANGE_HASH_RE = re.compile(r"(?P<start>\d+)\s*#\s*[-~—]\s*(?P<end>\d+)\s*#\s*(?P<name>.*)")
WINDOW_RE = re.compile(r"(?P<no>\d+(?:\s*[-~—]\s*\d+)?)\s*(?:#|号窗口?)\s*(?P<name>.*)")
SOURCE_METHODS = {"html-text", "ocr", "manual-review"}
IMAGE_KINDS = {"menu", "map", "slogan", "other"}
SLOGAN_RE = re.compile(r"光盘|杜绝浪费|拒绝浪费|浪费可耻|节约|勤俭|文明用餐|珍惜粮食|行动")
MAP_RE = re.compile(r"导视|出入口|入口|出口|楼梯|电梯|扶梯|卫生间|北|南|东|西")
NOISE_LINE_RE = re.compile(r"办公室|电话|微信|扫码|关注|投诉|监督|许可证|食品安全|导视图|出入口|楼梯|电梯|扶梯")
SPEC_FRAGMENT_RE = re.compile(r"^[（(【\[]?(小|中|大|小份|中份|大份|半份|整份|单份|双份|加馍|加面|加料|份|碗|杯|个)[）)】\]]?$")
SIDE_DISH_RE = re.compile(
    r"^(白?米饭|米饭|蒸米|馒头|花卷|煎蛋|荷包蛋|鸡蛋|卤蛋|茶叶蛋|加蛋|加饭|加米饭|加面|加馍|加饼|加菜|加料|"
    r"培根|火腿|鱼豆腐|鱼丸|肉丸|丸子|蟹棒|豆皮|海带|豆腐|年糕|土豆片|粉丝|宽粉|青菜|生菜|油麦菜|"
    r"肉|鸡肉|牛肉|羊肉|肥肠|小酥肉|里脊|午餐肉)$"
)
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini")


def load_articles() -> list[dict[str, Any]]:
    return json.loads(ARTICLES_FILE.read_text(encoding="utf-8"))


def ensure_dirs() -> None:
    for path in [HTML_ROOT, IMAGE_ROOT, OCR_ROOT, REVIEW_ROOT, GENERATED_TS.parent]:
        path.mkdir(parents=True, exist_ok=True)


def request_bytes(url: str, referer: str | None = None) -> tuple[bytes, str]:
    headers = dict(WECHAT_HEADERS)
    if referer:
        headers["Referer"] = referer
    req = Request(url, headers=headers)
    with urlopen(req, timeout=45) as response:
        return response.read(), response.headers.get("Content-Type", "")


def fetch_with_retry(url: str, referer: str | None = None, retries: int = 3) -> tuple[bytes, str]:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            return request_bytes(url, referer)
        except (HTTPError, URLError, TimeoutError, IncompleteRead) as error:
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def parse_article_html(article: dict[str, Any], text: str) -> dict[str, Any]:
    title = first_match(text, r"var\s+msg_title\s*=\s*'([^']*)'")
    title = html.unescape(title).strip() or first_match(text, r'<meta property="og:title" content="([^"]+)"')
    timestamp = first_match(text, r'var\s+ct\s*=\s*"?(\d+)"?')
    updated_at = ""
    if timestamp:
        updated_at = time.strftime("%Y-%m-%d", time.localtime(int(timestamp)))

    image_urls = unique(re.findall(r'data-src="(https?://mmbiz\.qpic\.cn/[^"]+)"', text))
    body_text = extract_body_text(text)
    return {
        **article,
        "sourceTitle": title.strip() or article["area"],
        "updatedAt": updated_at,
        "imageUrls": image_urls,
        "windowBlocks": extract_window_blocks(body_text),
        "textLineCount": len(body_text),
    }


def extract_body_text(text: str) -> list[str]:
    if BeautifulSoup:
        soup = BeautifulSoup(text, "lxml")
        content = soup.select_one("#js_content") or soup
        raw_lines = content.get_text("\n").splitlines()
    else:
        raw_lines = re.sub(r"<[^>]+>", "\n", html.unescape(text)).splitlines()
    return [line.strip() for line in raw_lines if clean_text(line)]


def extract_window_blocks(lines: list[str]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        if re.search(r"\d+\s*[-~—]\s*\d+\s*号窗口菜单$", line):
            continue
        match = WINDOW_RANGE_HASH_RE.search(line)
        if match:
            window_no = f"{match.group('start')}-{match.group('end')}"
            window_name = clean_text(match.group("name")) or f"{window_no}号窗口"
        else:
            match = WINDOW_RE.search(line)
            if not match:
                continue
            window_no = re.sub(r"\s+", "", match.group("no").replace("~", "-").replace("—", "-"))
            window_name = clean_text(match.group("name")) or f"{window_no}号窗口"
        if clean_text(window_name) in {"菜单", "窗口菜单"}:
            continue
        nearby = [clean_text(value) for value in lines[index + 1 : index + 4]]
        menu_text = "、".join(value for value in nearby if value and not WINDOW_RE.search(value))
        blocks.append(
            {
                "windowNo": window_no,
                "windowName": window_name,
                "menuText": menu_text,
                "lineIndex": index,
            }
        )
    return blocks


def command_fetch(_: argparse.Namespace) -> None:
    ensure_dirs()
    manifest: list[dict[str, Any]] = []
    for article in load_articles():
        print(f"Fetching {article['id']} {article['url']}")
        html_path = HTML_ROOT / f"{article['id']}.html"
        if html_path.exists() and html_path.stat().st_size > 100_000:
            body = html_path.read_bytes()
        else:
            body, _ = fetch_with_retry(article["url"])
            html_path.write_bytes(body)
        parsed = parse_article_html(article, body.decode("utf-8", "ignore"))
        parsed_images = []
        article_image_dir = IMAGE_ROOT / article["id"]
        article_image_dir.mkdir(parents=True, exist_ok=True)
        for index, image_url in enumerate(parsed["imageUrls"], start=1):
            ext = image_ext(image_url)
            image_path = article_image_dir / f"{index:03d}{ext}"
            if not image_path.exists():
                try:
                    image_body, content_type = fetch_with_retry(image_url, article["url"])
                    image_path.write_bytes(image_body)
                except Exception as error:
                    content_type = ""
                    print(f"  image {index} failed: {error}", file=sys.stderr)
            else:
                content_type = ""
            parsed_images.append(
                {
                    "index": index,
                    "url": image_url,
                    "path": rel(image_path),
                    "contentType": content_type,
                }
            )
        parsed["images"] = parsed_images
        parsed.pop("imageUrls", None)
        manifest.append(parsed)
        write_json(RAW_ROOT / "articles.manifest.json", manifest)
    write_json(RAW_ROOT / "articles.manifest.json", manifest)
    print(f"Wrote {rel(RAW_ROOT / 'articles.manifest.json')}")


def command_ocr(args: argparse.Namespace) -> None:
    ensure_dirs()
    manifest_path = RAW_ROOT / "articles.manifest.json"
    if not manifest_path.exists():
        raise SystemExit("Run npm run data:xdu:fetch before OCR.")
    engine = make_paddle_ocr()
    manifest = read_json(manifest_path)
    ocr_path = OCR_ROOT / "ocr-results.json"
    results: list[dict[str, Any]] = [] if args.force else read_json(ocr_path) if ocr_path.exists() else []
    processed_keys = {
        f"{result.get('articleId')}:{result.get('imageIndex')}"
        for result in results
    }
    processed = 0
    for article in manifest:
        if args.article and article["id"] != args.article:
            continue
        for image in article.get("images", []):
            if args.limit and processed >= args.limit:
                break
            result_key = f"{article['id']}:{image['index']}"
            if result_key in processed_keys:
                continue
            image_path = REPO_ROOT / image["path"]
            if not image_path.exists():
                continue
            print(f"OCR {article['id']} image {image['index']:03d}")
            raw = run_paddle_ocr(engine, image_path)
            lines = normalize_ocr_result(raw)
            processed += 1
            results.append(
                {
                    "articleId": article["id"],
                    "imageIndex": image["index"],
                    "imagePath": image["path"],
                    "imageUrl": image["url"],
                    "lines": lines,
                }
            )
            processed_keys.add(result_key)
            write_json(ocr_path, results)
        if args.limit and processed >= args.limit:
            break
    write_json(ocr_path, results)
    build_review()
    print(f"Wrote {rel(OCR_ROOT / 'ocr-results.json')}")
    print(f"Wrote {rel(REVIEW_ROOT / 'review.html')}")


def make_paddle_ocr() -> Any:
    try:
        from paddleocr import PaddleOCR
    except Exception as error:
        raise SystemExit(
            "PaddleOCR is not installed. Run npm run data:xdu:setup first."
        ) from error

    try:
        return PaddleOCR(
            lang="ch",
            text_detection_model_name=os.getenv("XDU_OCR_DET_MODEL", "PP-OCRv5_mobile_det"),
            text_recognition_model_name=os.getenv("XDU_OCR_REC_MODEL", "PP-OCRv5_mobile_rec"),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )
    except TypeError:
        return PaddleOCR(lang="ch", use_angle_cls=True, show_log=False)


def run_paddle_ocr(engine: Any, image_path: Path) -> Any:
    if hasattr(engine, "predict"):
        return engine.predict(input=str(image_path))
    return engine.ocr(str(image_path), cls=True)


def normalize_ocr_result(raw: Any) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []

    def add(text: Any, score: Any = None, box: Any = None) -> None:
        value = clean_text(str(text))
        if value:
            try:
                confidence = float(score) if score is not None else None
            except (TypeError, ValueError):
                confidence = None
            lines.append({"text": value, "confidence": confidence, "box": box})

    for page in raw if isinstance(raw, list) else [raw]:
        data = page
        if hasattr(page, "json"):
            data = page.json
        if isinstance(data, dict) and "res" in data:
            data = data["res"]
        if isinstance(data, dict) and "rec_texts" in data:
            scores = data.get("rec_scores") or [None] * len(data["rec_texts"])
            boxes = data.get("rec_boxes") or data.get("dt_polys") or [None] * len(data["rec_texts"])
            for text, score, box in zip(data["rec_texts"], scores, boxes):
                add(text, score, box)
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, list) and len(item) >= 2:
                    if isinstance(item[1], (list, tuple)) and item[1]:
                        add(item[1][0], item[1][1] if len(item[1]) > 1 else None, item[0])
                    elif len(item) >= 3:
                        add(item[0], item[1], item[2])
    return lines


def command_review(_: argparse.Namespace) -> None:
    ensure_dirs()
    build_review()
    print(f"Wrote {rel(REVIEW_ROOT / 'review.json')}")
    print(f"Wrote {rel(REVIEW_ROOT / 'review.html')}")


def build_review() -> list[dict[str, Any]]:
    manifest_path = RAW_ROOT / "articles.manifest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else []
    ocr_path = OCR_ROOT / "ocr-results.json"
    ocr_results = read_json(ocr_path) if ocr_path.exists() else []
    articles_by_id = {article["id"]: article for article in manifest}
    existing_records = read_json(REVIEW_ROOT / "review.json") if (REVIEW_ROOT / "review.json").exists() else []
    existing_by_key = {review_identity_key(record): record for record in existing_records}
    ocr_by_article: dict[str, list[dict[str, Any]]] = {}
    for image in ocr_results:
        ocr_by_article.setdefault(image.get("articleId", ""), []).append(image)
    window_indexes = {
        article["id"]: build_window_index(article, ocr_by_article.get(article["id"], []))
        for article in manifest
    }
    records: list[dict[str, Any]] = []

    for article in manifest:
        for block in article.get("windowBlocks", []):
            for dish in dishes_from_text(block.get("menuText", "")):
                records.append(record_from_parts(article, block, dish, None, "html-text", parse_warnings=dish.get("parseWarnings", [])))

    for image in ocr_results:
        article = articles_by_id.get(image["articleId"])
        if not article:
            continue
        image_kind = classify_image(image)
        if image_kind != "menu":
            continue
        window_hint = infer_window_hint(article, image, window_indexes.get(article["id"], []))
        for line in image.get("lines", []):
            if is_noise_line(line["text"]):
                continue
            parsed_dishes = dishes_from_ocr_line(line["text"])
            if not parsed_dishes:
                continue
            parse_group_id = parse_group_key(article["id"], image, line)
            for parse_index, parsed in enumerate(parsed_dishes):
                warnings = list(parsed.get("parseWarnings", []))
                if len(parsed_dishes) > 1:
                    warnings.append("multi-price-line")
                records.append(
                    record_from_parts(
                        article,
                        window_hint,
                        parsed,
                        image,
                        "ocr",
                        line.get("confidence"),
                        line["text"],
                        line.get("box"),
                        image_kind=image_kind,
                        parse_group_id=parse_group_id,
                        parse_index=parse_index,
                        parse_warnings=unique(warnings),
                    )
                )

    deduped = dedupe_records(records, existing_by_key)
    write_json(REVIEW_ROOT / "review.json", deduped)
    write_review_csv(deduped)
    write_review_html(deduped)
    return deduped


def build_window_index(article: dict[str, Any], images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    windows: list[dict[str, Any]] = []
    for block in article.get("windowBlocks") or []:
        windows.append(
            {
                "windowNo": normalize_window_no(block.get("windowNo", "")),
                "windowName": clean_text(block.get("windowName", "")),
                "menuText": block.get("menuText", ""),
                "lineIndex": block.get("lineIndex", 0),
                "source": "article-text",
            }
        )
    for image in images:
        if classify_image(image) != "map":
            continue
        windows.extend(extract_windows_from_map_image(article, image))

    by_no: dict[str, dict[str, Any]] = {}
    unnamed: list[dict[str, Any]] = []
    for window in windows:
        window_no = normalize_window_no(window.get("windowNo", ""))
        window_name = clean_text(window.get("windowName", ""))
        if not window_no:
            unnamed.append(window)
            continue
        current = by_no.get(window_no)
        if not current or (not clean_text(current.get("windowName", "")) and window_name):
            by_no[window_no] = {**window, "windowNo": window_no, "windowName": window_name or current.get("windowName", "") if current else window_name}
    return list(by_no.values()) + unnamed


def extract_windows_from_map_image(article: dict[str, Any], image: dict[str, Any]) -> list[dict[str, Any]]:
    lines = image.get("lines", [])
    windows: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        text = clean_text(str(line.get("text", "")))
        direct = re.search(r"(?P<name>[\u4e00-\u9fa5A-Za-z0-9·（）()]+)[\s:：-]*(?P<no>\d{1,2}(?:\s*[-~—]\s*\d{1,2})?)$", text)
        if direct and re.search(r"[\u4e00-\u9fa5]", direct.group("name")) and not MAP_RE.search(direct.group("name")):
            windows.append(map_window_record(article, direct.group("no"), direct.group("name"), image))
            continue
        if not re.fullmatch(r"\d{1,2}(?:\s*[-~—]\s*\d{1,2})?", text):
            continue
        name = nearest_window_name(lines, index)
        if name:
            windows.append(map_window_record(article, text, name, image))
    return dedupe_windows(windows)


def nearest_window_name(lines: list[dict[str, Any]], index: int) -> str:
    for offset in [1, -1, 2, -2, 3, -3]:
        nearby_index = index + offset
        if nearby_index < 0 or nearby_index >= len(lines):
            continue
        candidate = clean_text(str(lines[nearby_index].get("text", "")))
        if is_window_name_candidate(candidate):
            return candidate
    return ""


def is_window_name_candidate(value: str) -> bool:
    if not value or len(value) < 2:
        return False
    if PRICE_RE.search(value) or SLOGAN_RE.search(value) or MAP_RE.fullmatch(value):
        return False
    if re.fullmatch(r"[\d\s#\-~—]+", value):
        return False
    if re.search(r"早餐|中餐|午餐|晚餐|全天|暂无|上下楼|出入口", value):
        return False
    return bool(re.search(r"[\u4e00-\u9fa5]", value))


def map_window_record(article: dict[str, Any], window_no: str, window_name: str, image: dict[str, Any]) -> dict[str, Any]:
    return {
        "windowNo": normalize_window_no(window_no),
        "windowName": clean_text(window_name),
        "menuText": "",
        "lineIndex": int(image.get("imageIndex") or 0),
        "source": "map",
    }


def dedupe_windows(windows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for window in windows:
        key = f"{window.get('windowNo')}|{normalize_menu_name(window.get('windowName', ''))}"
        if key in seen:
            continue
        seen.add(key)
        result.append(window)
    return result


def infer_window_hint(article: dict[str, Any], image: dict[str, Any], window_index: list[dict[str, Any]] | None = None) -> dict[str, str]:
    blocks = window_index or article.get("windowBlocks") or []
    if not blocks:
        return {"windowNo": "", "windowName": article["area"], "menuText": ""}
    # Article images alternate between decoration, window image, and menu content.
    # This approximate mapping is only for review grouping; humans approve final rows.
    index = max(0, min(len(blocks) - 1, (int(image["imageIndex"]) - 3) // 2))
    return blocks[index]


def record_from_parts(
    article: dict[str, Any],
    block: dict[str, Any],
    dish: dict[str, Any],
    image: dict[str, Any] | None,
    source_method: str,
    confidence: float | None = None,
    source_text: str = "",
    source_box: Any = None,
    image_kind: str = "other",
    parse_group_id: str = "",
    parse_index: int | None = None,
    parse_warnings: list[str] | None = None,
) -> dict[str, Any]:
    review_status = "pending"
    price = dish.get("price")
    if source_method not in SOURCE_METHODS:
        source_method = "html-text"
    if image_kind not in IMAGE_KINDS:
        image_kind = "other"
    window_no = normalize_window_no(block.get("windowNo", ""))
    window_name = clean_text(block.get("windowName", "")) or article["area"]
    location_hint = format_location_hint(article.get("area", ""), article.get("floor", ""), window_no, window_name)
    warnings = unique((parse_warnings or []) + dish.get("parseWarnings", []))
    record = {
        "reviewStatus": review_status,
        "articleId": article["id"],
        "campus": article["campus"],
        "area": article["area"],
        "floor": article.get("floor"),
        "distanceMinutes": article.get("distanceMinutes", 6),
        "windowNo": window_no,
        "windowName": window_name,
        "locationHint": location_hint,
        "dishName": clean_text(dish["dishName"]),
        "price": price,
        "types": infer_types(dish["dishName"]),
        "available": infer_available(dish["dishName"]),
        "heat": infer_heat(dish["dishName"]),
        "sourceMethod": source_method,
        "sourceTitle": article.get("sourceTitle") or article["area"],
        "sourceUrl": article["url"],
        "updatedAt": article.get("updatedAt") or "",
        "sourceImageUrl": image.get("imageUrl") if image else None,
        "sourceImagePath": image.get("imagePath") if image else None,
        "sourceText": source_text,
        "sourceBox": source_box,
        "ocrConfidence": confidence,
        "imageKind": image_kind if image else "other",
        "parseGroupId": parse_group_id,
        "parseIndex": parse_index,
        "parseWarnings": warnings,
        "duplicateCount": 1,
        "duplicateSources": [],
    }
    record["reviewId"] = review_id(record)
    return record


def dishes_from_text(text: str) -> list[dict[str, Any]]:
    dishes: list[dict[str, Any]] = []
    for part in re.split(r"[、，,;/；\n]+", text):
        value = clean_text(part)
        if len(value) < 2:
            continue
        price = extract_price(value)
        name = strip_price(value)
        if name and not is_side_dish(name, price):
            dishes.append({"dishName": name, "price": price})
    return dishes


def dish_from_ocr_line(text: str) -> dict[str, Any] | None:
    dishes = dishes_from_ocr_line(text)
    return dishes[0] if dishes else None


def dishes_from_ocr_line(text: str) -> list[dict[str, Any]]:
    value = clean_text(text)
    if len(value) < 3 or is_noise_line(value):
        return []
    matches = [match for match in PRICE_RE.finditer(value) if price_from_match(match) is not None]
    if not matches:
        return []

    dishes: list[dict[str, Any]] = []
    cursor = 0
    base_name = ""
    for match in matches:
        prefix = clean_menu_name(value[cursor : match.start()])
        if prefix and is_spec_fragment(prefix) and dishes:
            dishes[-1]["dishName"] = append_spec(dishes[-1]["dishName"], prefix)
            name = base_name
        elif prefix:
            name = prefix
            base_name = strip_terminal_spec(prefix)
        elif base_name:
            name = base_name
        else:
            cursor = match.end()
            continue
        price = price_from_match(match)
        if price is not None and is_plausible_dish_name(name) and not is_side_dish(name, price):
            dishes.append({"dishName": name, "price": price, "parseWarnings": []})
        cursor = match.end()

    raw_trailing = value[cursor:]
    trailing = clean_menu_name(raw_trailing)
    if trailing and dishes:
        if re.match(r"^\s*[/／]", raw_trailing):
            pass
        elif is_spec_fragment(trailing):
            dishes[-1]["dishName"] = append_spec(dishes[-1]["dishName"], trailing)
        elif len(dishes) == 1 and not base_name and is_plausible_dish_name(trailing):
            dishes[-1]["dishName"] = clean_menu_name(f"{dishes[-1]['dishName']}{trailing}")

    if len(dishes) > 1:
        for dish in dishes:
            dish.setdefault("parseWarnings", []).append("multi-price-line")
    return dedupe_dishes(dishes)


def extract_price(value: str) -> float | None:
    matches = list(PRICE_RE.finditer(value))
    if not matches:
        return None
    return price_from_match(matches[-1])


def strip_price(value: str) -> str:
    value = PRICE_RE.sub("", value)
    return clean_menu_name(value)


def dedupe_records(records: list[dict[str, Any]], existing_by_key: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        grouped.setdefault(review_identity_key(record), []).append(record)

    deduped: list[dict[str, Any]] = []
    for key, group in grouped.items():
        record = choose_primary_record(group)
        duplicate_sources = [duplicate_source(item) for item in group]
        record["duplicateCount"] = len(group)
        record["duplicateSources"] = duplicate_sources
        record.setdefault("parseWarnings", [])
        if len(group) > 1:
            record["parseWarnings"] = unique(record["parseWarnings"] + ["duplicate-merged"])
        existing = existing_by_key.get(key) if existing_by_key else None
        if existing and existing.get("reviewStatus") in {"approved", "rejected"}:
            for field in ["reviewStatus", "types", "available", "heat", "notes"]:
                if field in existing:
                    record[field] = existing[field]
        record.setdefault("reviewId", review_id(record))
        deduped.append(record)
    return deduped


def price_from_match(match: re.Match[str]) -> float | int | None:
    raw = match.groupdict().get("currency") or match.groupdict().get("number")
    if not raw and match.groupdict().get("chinese"):
        chinese = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
        number = float(chinese[match.group("chinese")])
    else:
        try:
            number = float(raw or "")
        except ValueError:
            return None
    if 0 < number <= 99:
        return int(number) if number.is_integer() else number
    return None


def clean_menu_name(value: str) -> str:
    value = clean_text(value)
    value = re.sub(r"[·•.。…⋯]{2,}", " ", value)
    value = re.sub(r"[·•.。…⋯]+(?=\s*$)", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" -_—–:：,，;；、/／|｜.。·…⋯")


def normalize_menu_name(value: str) -> str:
    value = clean_menu_name(value).lower()
    value = value.replace("（", "(").replace("）", ")")
    value = re.sub(r"[\s·•.。…⋯、,，;；:：/／|｜\-—–_]+", "", value)
    return value


def normalize_window_no(value: Any) -> str:
    text = clean_text(str(value or ""))
    text = text.replace("~", "-").replace("—", "-").replace("–", "-")
    text = re.sub(r"\s+", "", text)
    parts = []
    for part in text.split("-"):
        if part.isdigit():
            parts.append(str(int(part)))
        elif part:
            parts.append(part)
    return "-".join(parts)


def is_spec_fragment(value: str) -> bool:
    return bool(SPEC_FRAGMENT_RE.fullmatch(clean_menu_name(value)))


def strip_terminal_spec(value: str) -> str:
    cleaned = clean_menu_name(value)
    return clean_menu_name(re.sub(r"[（(【\[]?(小|中|大|小份|中份|大份|半份|整份)[）)】\]]?$", "", cleaned)) or cleaned


def append_spec(name: str, spec: str) -> str:
    cleaned_spec = clean_menu_name(spec)
    if cleaned_spec.startswith(("(", "（", "【", "[")):
        return clean_menu_name(f"{name}{cleaned_spec}")
    return clean_menu_name(f"{name}（{cleaned_spec}）")


def is_plausible_dish_name(value: str) -> bool:
    name = clean_menu_name(value)
    if len(name) < 2:
        return False
    if re.fullmatch(r"[\d.元¥￥/份碗个杯块\s()（）]+", name):
        return False
    if NOISE_LINE_RE.search(name) or SLOGAN_RE.search(name):
        return False
    return bool(re.search(r"[\u4e00-\u9fa5A-Za-z]", name))


def is_side_dish(name: str, price: Any = None) -> bool:
    normalized = normalize_menu_name(name)
    if not normalized:
        return True
    try:
        numeric_price = float(price) if price is not None else None
    except (TypeError, ValueError):
        numeric_price = None
    if re.search(r"煮馍|盖饭|炒饭|拌饭|套餐|拉面|汤面|拌面|米线|粉|馄饨|水饺|砂锅|冒菜|麻辣烫|夹馍", normalized):
        return False
    if SIDE_DISH_RE.fullmatch(normalized):
        return numeric_price is None or numeric_price <= 8
    if normalized.startswith("加"):
        return True
    return bool(numeric_price is not None and numeric_price <= 5 and len(normalized) <= 4 and SIDE_DISH_RE.search(normalized))


def dedupe_dishes(dishes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for dish in dishes:
        if is_side_dish(dish.get("dishName", ""), dish.get("price")):
            continue
        key = f"{normalize_menu_name(dish.get('dishName', ''))}|{dish.get('price')}"
        if key in seen:
            continue
        seen.add(key)
        dish["dishName"] = clean_menu_name(dish.get("dishName", ""))
        result.append(dish)
    return result


def is_noise_line(value: str) -> bool:
    text = clean_text(value)
    if not text:
        return True
    if SLOGAN_RE.search(text):
        return True
    if NOISE_LINE_RE.search(text) and not PRICE_RE.search(text):
        return True
    return False


def classify_image(image: dict[str, Any]) -> str:
    texts = [clean_text(str(line.get("text", ""))) for line in image.get("lines", [])]
    if not texts:
        return "other"
    joined = " ".join(texts)
    price_lines = sum(1 for text in texts if PRICE_RE.search(text))
    slogan_lines = sum(1 for text in texts if SLOGAN_RE.search(text))
    map_lines = sum(1 for text in texts if MAP_RE.search(text))
    if re.search(r"导视图|平面图|分布图", joined):
        return "map"
    if price_lines > 0:
        return "menu"
    if slogan_lines > 0:
        return "slogan"
    if map_lines >= 2:
        return "map"
    return "other"


def choose_primary_record(group: list[dict[str, Any]]) -> dict[str, Any]:
    def score(record: dict[str, Any]) -> tuple[int, float]:
        return (
            1 if record.get("reviewStatus") == "approved" else 0,
            1 if record.get("sourceImagePath") else 0,
            1 if record.get("sourceMethod") == "ocr" else 0,
            float(record.get("ocrConfidence") or 0),
        )

    return dict(sorted(group, key=score, reverse=True)[0])


def duplicate_source(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "sourceMethod": record.get("sourceMethod"),
        "sourceImagePath": record.get("sourceImagePath"),
        "sourceText": record.get("sourceText"),
        "ocrConfidence": record.get("ocrConfidence"),
    }


def review_identity_key(record: dict[str, Any]) -> str:
    return "|".join(
        [
            str(record.get("articleId", "")),
            normalize_window_no(record.get("windowNo", "")),
            normalize_menu_name(record.get("windowName", "")),
            normalize_menu_name(record.get("dishName", "")),
            str(record.get("price", "")),
        ]
    )


def parse_group_key(article_id: str, image: dict[str, Any], line: dict[str, Any]) -> str:
    raw = "|".join([article_id, str(image.get("imageIndex", "")), str(line.get("text", "")), str(line.get("box", ""))])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def format_location_hint(area: str, floor: Any, window_no: str, window_name: str) -> str:
    parts = [clean_text(area), clean_text(str(floor or ""))]
    if window_no:
        parts.append(f"{window_no}号窗口")
    if window_name:
        parts.append(window_name)
    return " · ".join(part for part in parts if part)


def review_id(record: dict[str, Any]) -> str:
    raw = "|".join(
        str(record.get(field, ""))
        for field in [
            "articleId",
            "sourceMethod",
            "sourceImagePath",
            "sourceText",
            "parseIndex",
            "windowNo",
            "windowName",
            "dishName",
            "price",
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def command_ai_review(args: argparse.Namespace) -> None:
    ensure_dirs()
    records_path = REVIEW_ROOT / "review.json"
    if not records_path.exists():
        raise SystemExit("Run npm run data:xdu:review before AI review.")
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is not set. Set it before running AI-assisted review.")

    records = read_json(records_path)
    image_map = load_ocr_image_map()
    selected = select_ai_review_records(records, args.record, int(args.limit or 10))
    if not selected:
        print("No matching records need AI review.")
        return

    model = args.model or OPENAI_VISION_MODEL
    reviewed = 0
    for record in selected:
        suggestion = suggest_record_with_openai(record, image_map, model=model, timeout=int(args.timeout or 60))
        suggestion["model"] = model
        suggestion["reviewedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        apply_ai_suggestion_to_record(record, suggestion, dry_run=bool(args.dry_run))
        reviewed += 1
        action = suggestion.get("action", "uncertain")
        dish = suggestion.get("dishName") or record.get("dishName") or ""
        price = suggestion.get("price") or record.get("price") or ""
        print(f"{reviewed:03d} {record.get('reviewId')} {action}: {dish} {price}")

    if not args.dry_run:
        write_json(records_path, records)
        write_review_csv(records)
        write_review_html(records)
    print(f"AI reviewed {reviewed} records{' (dry run)' if args.dry_run else ''}.")


def load_ocr_image_map() -> dict[str, dict[str, Any]]:
    ocr_path = OCR_ROOT / "ocr-results.json"
    if not ocr_path.exists():
        return {}
    return {image.get("imagePath"): image for image in read_json(ocr_path) if image.get("imagePath")}


def select_ai_review_records(records: list[dict[str, Any]], record_id: str | None, limit: int) -> list[dict[str, Any]]:
    if record_id:
        return [record for record in records if record.get("reviewId") == record_id]
    candidates = [
        record
        for record in records
        if record.get("reviewStatus") == "pending"
        and record.get("sourceMethod") == "ocr"
        and record.get("sourceImagePath")
        and needs_ai_review(record)
    ]
    candidates.sort(key=ai_review_score, reverse=True)
    return candidates[: max(1, limit)]


def needs_ai_review(record: dict[str, Any]) -> bool:
    if "aiSuggestion" in record:
        return False
    if is_side_dish(record.get("dishName", ""), record.get("price")):
        return True
    if record.get("parseWarnings"):
        return True
    if float(record.get("ocrConfidence") or 1) < 0.88:
        return True
    name = clean_menu_name(record.get("dishName", ""))
    return len(name) < 3 or bool(re.fullmatch(r"[A-Za-z0-9()[\]【】.,，。·…/\-_\s]+", name))


def ai_review_score(record: dict[str, Any]) -> tuple[int, int, float]:
    return (
        1 if is_side_dish(record.get("dishName", ""), record.get("price")) else 0,
        len(record.get("parseWarnings") or []),
        1 - float(record.get("ocrConfidence") or 1),
    )


def suggest_record_with_openai(
    record: dict[str, Any],
    image_map: dict[str, dict[str, Any]],
    model: str,
    timeout: int = 60,
) -> dict[str, Any]:
    image_path = record.get("sourceImagePath")
    image = image_map.get(image_path or "")
    if not image_path or not image:
        raise RuntimeError("Selected record has no OCR image context.")
    prompt = build_ai_review_prompt(record, image)
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_data_url_for_record(record), "detail": "high"},
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "xdu_menu_review",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "action": {"type": "string", "enum": ["correct", "reject", "uncertain"]},
                        "dishName": {"type": "string"},
                        "price": {"type": "number"},
                        "windowNo": {"type": "string"},
                        "windowName": {"type": "string"},
                        "isSideDish": {"type": "boolean"},
                        "confidence": {"type": "number"},
                        "reason": {"type": "string"},
                    },
                    "required": ["action", "dishName", "price", "windowNo", "windowName", "isSideDish", "confidence", "reason"],
                },
            }
        },
        "max_output_tokens": 700,
    }
    response = openai_responses_request(payload, timeout=timeout)
    text = extract_response_text(response)
    try:
        suggestion = json.loads(text)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"OpenAI response was not valid JSON: {text[:240]}") from error
    return normalize_ai_suggestion(suggestion)


def build_ai_review_prompt(record: dict[str, Any], image: dict[str, Any]) -> str:
    nearby_lines = []
    source_text = record.get("sourceText") or ""
    lines = image.get("lines", [])
    for index, line in enumerate(lines):
        if line.get("text") == source_text:
            for nearby in lines[max(0, index - 4) : min(len(lines), index + 5)]:
                nearby_lines.append(str(nearby.get("text", "")))
            break
    if not nearby_lines:
        nearby_lines = [str(line.get("text", "")) for line in lines[:12]]
    context = {
        "currentDishName": record.get("dishName"),
        "currentPrice": record.get("price"),
        "windowNo": record.get("windowNo"),
        "windowName": record.get("windowName"),
        "locationHint": record.get("locationHint"),
        "sourceText": source_text,
        "nearbyOcrLines": nearby_lines,
    }
    return (
        "你是西安电子科技大学食堂菜单复核助手。请只根据图片和 OCR 上下文判断当前候选是否是一个可推荐的主菜/套餐。\n"
        "任务：修正菜名、价格、窗口号/窗口名，或判断它应被拒绝。\n"
        "重要规则：米饭、白米饭、煎蛋、荷包蛋、鸡蛋、加饭、加面、加馍、加菜、加料、火腿、培根、鱼豆腐、丸子、海带、豆皮等配菜/加料不要作为菜品入库；"
        "标语、电话、导视、编号、装饰文字也要拒绝。无法从图中确认就返回 uncertain，不要猜价格。\n"
        "action=correct 表示你能清楚读出主菜和价格；action=reject 表示配菜/标语/非菜品；action=uncertain 表示看不清或无法确认。\n"
        "price 无法确认时填 0。只返回 JSON。\n"
        f"当前候选上下文：{json.dumps(context, ensure_ascii=False)}"
    )


def image_data_url_for_record(record: dict[str, Any]) -> str:
    image_path = (REPO_ROOT / str(record.get("sourceImagePath", ""))).resolve()
    if not image_path.exists():
        raise FileNotFoundError(image_path)
    image_bytes = crop_image_bytes(image_path, record.get("sourceBox"))
    mime_type = "image/jpeg"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def crop_image_bytes(image_path: Path, source_box: Any) -> bytes:
    try:
        from PIL import Image
    except Exception:
        return image_path.read_bytes()

    with Image.open(image_path) as image:
        image = image.convert("RGB")
        if isinstance(source_box, list) and len(source_box) >= 4:
            x1, y1, x2, y2 = [float(value) for value in source_box[:4]]
            width = max(8, x2 - x1)
            height = max(8, y2 - y1)
            pad_x = max(160, width * 4.0)
            pad_y = max(90, height * 5.0)
            left = max(0, int(x1 - pad_x))
            top = max(0, int(y1 - pad_y))
            right = min(image.width, int(x2 + pad_x))
            bottom = min(image.height, int(y2 + pad_y))
            image = image.crop((left, top, right, bottom))
        image.thumbnail((1600, 1600))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()


def openai_responses_request(payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{OPENAI_BASE_URL}/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", "ignore")
        raise RuntimeError(f"OpenAI API error {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"OpenAI API request failed: {error}") from error


def extract_response_text(response: dict[str, Any]) -> str:
    if response.get("output_text"):
        return str(response["output_text"])
    parts: list[str] = []
    for output in response.get("output", []):
        for content in output.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                parts.append(str(content["text"]))
    return "\n".join(parts).strip()


def normalize_ai_suggestion(value: dict[str, Any]) -> dict[str, Any]:
    action = value.get("action") if value.get("action") in {"correct", "reject", "uncertain"} else "uncertain"
    price = value.get("price")
    try:
        price = float(price)
    except (TypeError, ValueError):
        price = 0
    if price < 0:
        price = 0
    if float(price).is_integer():
        price = int(price)
    confidence = value.get("confidence")
    try:
        confidence = max(0.0, min(1.0, float(confidence)))
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "action": action,
        "dishName": clean_menu_name(str(value.get("dishName", ""))),
        "price": price,
        "windowNo": normalize_window_no(value.get("windowNo", "")),
        "windowName": clean_text(str(value.get("windowName", ""))),
        "isSideDish": bool(value.get("isSideDish")),
        "confidence": round(confidence, 4),
        "reason": clean_text(str(value.get("reason", ""))),
    }


def apply_ai_suggestion_to_record(record: dict[str, Any], suggestion: dict[str, Any], dry_run: bool = False) -> None:
    if dry_run:
        return
    record["aiSuggestion"] = suggestion
    record["parseWarnings"] = unique((record.get("parseWarnings") or []) + [f"ai-{suggestion.get('action', 'uncertain')}"])
    if suggestion.get("isSideDish") or is_side_dish(suggestion.get("dishName", ""), suggestion.get("price")):
        record["reviewStatus"] = "rejected"
        record["notes"] = "AI 识别为配菜/加料，不进入正式推荐。"
        return
    if suggestion.get("action") == "reject":
        record["reviewStatus"] = "rejected"
        record["notes"] = suggestion.get("reason") or "AI 建议拒绝。"
        return
    if suggestion.get("action") != "correct" or not suggestion.get("dishName") or not suggestion.get("price"):
        return
    record["dishName"] = suggestion["dishName"]
    record["price"] = suggestion["price"]
    if suggestion.get("windowNo"):
        record["windowNo"] = suggestion["windowNo"]
    if suggestion.get("windowName"):
        record["windowName"] = suggestion["windowName"]
    record["locationHint"] = format_location_hint(
        record.get("area", ""),
        record.get("floor", ""),
        record.get("windowNo", ""),
        record.get("windowName", ""),
    )
    record["types"] = infer_types(record["dishName"])
    record["available"] = infer_available(record["dishName"])
    record["heat"] = infer_heat(record["dishName"])
    record["reviewStatus"] = "pending"


def command_generate(_: argparse.Namespace) -> None:
    ensure_dirs()
    records_path = REVIEW_ROOT / "review.json"
    seed_records = read_json(SEED_REVIEWED_FILE)
    if records_path.exists():
        records = seed_records + read_json(records_path)
    else:
        records = seed_records
    approved = [
        record
        for record in records
        if record.get("reviewStatus") == "approved"
        and isinstance(record.get("price"), (int, float))
        and record.get("price", 0) > 0
        and not is_side_dish(record.get("dishName", ""), record.get("price"))
    ]
    approved_keys = {review_identity_key(record) for record in approved}
    beta_limit = int(os.getenv("XDU_BETA_LIMIT", "650"))
    beta_records = [
        normalize_beta_record(record)
        for record in records
        if is_beta_candidate(record) and review_identity_key(record) not in approved_keys
    ][:beta_limit]
    source_summary = load_source_summary()
    ts = render_ts(approved, source_summary, beta_records)
    GENERATED_TS.write_text(ts, encoding="utf-8", newline="\n")
    print(f"Wrote {rel(GENERATED_TS)} with {len(approved)} approved dishes and {len(beta_records)} beta dishes")


def load_source_summary() -> list[dict[str, Any]]:
    manifest_path = RAW_ROOT / "articles.manifest.json"
    if manifest_path.exists():
        manifest = read_json(manifest_path)
        return [
            {
                "id": article["id"],
                "campus": article["campus"],
                "area": article["area"],
                "floor": article.get("floor"),
                "sourceUrl": article["url"],
                "sourceTitle": article.get("sourceTitle") or article["area"],
                "updatedAt": article.get("updatedAt") or "",
                "imageCount": len(article.get("images", [])),
            }
            for article in manifest
        ]
    return [
            {
                "id": article["id"],
                "campus": article["campus"],
                "area": article["area"],
                "floor": article.get("floor"),
                "sourceUrl": article["url"],
                "sourceTitle": article.get("sourceTitle") or f"{article['area']}窗口分布及菜单",
                "updatedAt": article.get("updatedAt") or "2024-09-27",
                "imageCount": 0,
            }
        for article in load_articles()
    ]


def is_beta_candidate(record: dict[str, Any]) -> bool:
    if record.get("reviewStatus") != "pending":
        return False
    if record.get("sourceMethod") != "ocr" or record.get("imageKind") != "menu":
        return False
    if not isinstance(record.get("price"), (int, float)) or not 3 <= float(record["price"]) <= 45:
        return False
    if is_side_dish(record.get("dishName", ""), record.get("price")):
        return False
    name = normalize_beta_name(record.get("dishName", ""))
    if not is_plausible_dish_name(name) or len(normalize_menu_name(name)) > 18:
        return False
    if float(record.get("ocrConfidence") or 0) < 0.82:
        return False
    allowed_warnings = {"multi-price-line", "duplicate-merged", "ai-correct"}
    if any(warning not in allowed_warnings for warning in record.get("parseWarnings") or []):
        return False
    if re.search(r"电话|办公室|扫码|关注|优惠|活动|套餐搭配|任意|免费|另加|加价", name):
        return False
    return True


def normalize_beta_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(record)
    normalized["dishName"] = normalize_beta_name(record.get("dishName", ""))
    normalized["types"] = infer_types(normalized["dishName"])
    normalized["available"] = infer_available(normalized["dishName"])
    normalized["heat"] = infer_heat(normalized["dishName"])
    warnings = list(normalized.get("parseWarnings") or [])
    if normalized["dishName"] != record.get("dishName"):
        warnings.append("normalized-typo")
    normalized["parseWarnings"] = unique(warnings)
    return normalized


def normalize_beta_name(name: str) -> str:
    value = clean_menu_name(name)
    replacements = {
        "馄吨": "馄饨",
        "馄纯": "馄饨",
        "混沌": "馄饨",
        "云吞": "馄饨",
        "米践": "米线",
        "米銭": "米线",
        "拉而": "拉面",
        "拌而": "拌面",
        "土豆扮粉": "土豆拌粉",
        "肉夹膜": "肉夹馍",
        "糖膜": "糖馍",
    }
    for wrong, right in replacements.items():
        value = value.replace(wrong, right)
    value = re.sub(r"(大|小|中)\s*份$", r"（\1份）", value)
    return clean_menu_name(value)


def render_ts(records: list[dict[str, Any]], source_summary: list[dict[str, Any]], beta_records: list[dict[str, Any]] | None = None) -> str:
    official_vendors = records_to_vendors(records, "approved", "西电后勤公众号 · 已复核菜单")
    beta_vendors = records_to_vendors(beta_records or [], "pending", "西电后勤公众号 · 内测待学生校准")
    return (
        'import type { FoodVendor } from "../domain/food";\n\n'
        "// Auto-generated by tools/xdu-canteen-import/xdu_canteen_importer.py.\n"
        "// Approved rows are verified; beta rows are filtered candidates for student calibration.\n\n"
        "export interface OfficialCanteenSourceSummary {\n"
        '  id: string;\n  campus: FoodVendor["campus"];\n  area: string;\n  floor?: string;\n'
        "  sourceUrl: string;\n  sourceTitle: string;\n  updatedAt: string;\n  imageCount: number;\n"
        "}\n\n"
        f"export const xduOfficialCanteenSourceSummary: OfficialCanteenSourceSummary[] = {json_for_ts(source_summary)};\n\n"
        f"export const xduOfficialCanteenVendors: FoodVendor[] = {json_for_ts(official_vendors)};\n\n"
        f"export const xduBetaCanteenVendors: FoodVendor[] = {json_for_ts(beta_vendors)};\n"
    )


def records_to_vendors(records: list[dict[str, Any]], review_status: str, source_label: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        key = "|".join(
            [
                record["articleId"],
                str(record.get("windowNo") or ""),
                str(record.get("windowName") or record["area"]),
            ]
        )
        grouped.setdefault(key, []).append(record)

    vendors: list[dict[str, Any]] = []
    for _, group in sorted(grouped.items(), key=lambda item: item[0]):
        first = group[0]
        vendor_id = slugify(f"{first['articleId']}-{first.get('windowNo')}-{first.get('windowName')}")
        tags = unique_flat([infer_types(item["dishName"]) for item in group])
        vendor_location_hint = first.get("locationHint") or format_location_hint(
            first["area"],
            first.get("floor"),
            first.get("windowNo") or "",
            first.get("windowName") or "窗口",
        )
        vendors.append(
            {
                "id": vendor_id,
                "name": f"{first['area']} {first.get('windowNo') or ''}# · {first.get('windowName') or '窗口'}",
                "campus": first["campus"],
                "channel": "canteen",
                "area": first["area"],
                "floor": first.get("floor"),
                "windowNo": first.get("windowNo") or "",
                "windowName": first.get("windowName") or "",
                "locationHint": vendor_location_hint,
                "distanceMinutes": int(first.get("distanceMinutes") or 6),
                "tags": tags,
                "source": source_label,
                "sourceUrl": first.get("sourceUrl"),
                "sourceTitle": first.get("sourceTitle"),
                "updatedAt": first.get("updatedAt") or "",
                "sourceMethod": first.get("sourceMethod"),
                "reviewStatus": review_status,
                "ocrConfidence": mean([item.get("ocrConfidence") for item in group]),
                "duplicateCount": sum(int(item.get("duplicateCount") or 1) for item in group),
                "items": [
                    {
                        "id": slugify(f"{vendor_id}-{item['dishName']}-{index}"),
                        "name": item["dishName"],
                        "price": item["price"],
                        "types": item.get("types") or infer_types(item["dishName"]),
                        "heat": item.get("heat") or infer_heat(item["dishName"]),
                        "popularity": 0.76,
                        "available": item.get("available") or infer_available(item["dishName"]),
                        "description": f"{item.get('locationHint') or vendor_location_hint}，{source_label}。",
                        "windowNo": item.get("windowNo") or first.get("windowNo") or "",
                        "windowName": item.get("windowName") or first.get("windowName") or "",
                        "locationHint": item.get("locationHint") or vendor_location_hint,
                        "sourceUrl": item.get("sourceUrl"),
                        "sourceTitle": item.get("sourceTitle"),
                        "sourceImageUrl": item.get("sourceImageUrl"),
                        "sourceMethod": item.get("sourceMethod"),
                        "reviewStatus": review_status,
                        "ocrConfidence": item.get("ocrConfidence"),
                        "imageKind": item.get("imageKind"),
                        "parseWarnings": item.get("parseWarnings") or [],
                        "duplicateCount": item.get("duplicateCount") or 1,
                    }
                    for index, item in enumerate(group)
                ],
            }
        )

    return vendors


def infer_types(name: str) -> list[str]:
    rules = [
        ("rice", r"饭|米|套餐|盖浇|小碗菜|自选"),
        ("noodle", r"面|粉|米线|馄饨|饺"),
        ("spicy", r"辣|麻|椒|川|酸菜|泡椒|水煮"),
        ("light", r"粥|豆浆|汤|番茄|鸡蛋羹|南瓜"),
        ("snack", r"饼|馍|包|串|饭团|小吃|炸"),
        ("western", r"咖喱|汉堡|披萨|意面|西式"),
        ("drink", r"饮|奶|豆浆|茶|咖啡|汁|甜品"),
        ("vegetarian", r"素|豆腐|土豆|茄子|西兰花|南瓜|青菜"),
        ("halal", r"清真|兰州|牛肉拉面"),
        ("protein", r"肉|鸡|牛|羊|鱼|蛋|排骨|肥肠|虾|培根|里脊"),
        ("local", r"陕西|肉夹馍|油泼|臊子|岐山|胡辣汤|扯面"),
    ]
    found = [food_type for food_type, pattern in rules if re.search(pattern, name)]
    return unique(found or ["rice"])


def infer_heat(name: str) -> str:
    if re.search(r"爆辣|特辣|麻辣|辣子|香辣", name):
        return "hot"
    if re.search(r"泡椒|尖椒|藤椒|酸辣|川香|水煮|麻椒", name):
        return "medium"
    if re.search(r"辣|咖喱|孜然|胡辣|椒", name):
        return "mild"
    return "none"


def infer_available(name: str) -> list[str]:
    if re.search(r"豆浆|胡辣汤|粥|包子|小笼包|早餐", name):
        return ["breakfast"]
    if re.search(r"饼|饭团|肉夹馍", name):
        return ["breakfast", "lunch", "dinner"]
    return ["lunch", "dinner"]


def write_review_csv(records: list[dict[str, Any]]) -> None:
    fields = [
        "reviewStatus",
        "articleId",
        "area",
        "windowNo",
        "windowName",
        "locationHint",
        "dishName",
        "price",
        "sourceMethod",
        "imageKind",
        "parseWarnings",
        "duplicateCount",
        "ocrConfidence",
        "sourceImagePath",
        "sourceText",
        "sourceUrl",
    ]
    with (REVIEW_ROOT / "review.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow({field: record.get(field, "") for field in fields})


def write_review_html(records: list[dict[str, Any]]) -> None:
    rows = []
    for record in records:
        image = record.get("sourceImagePath")
        image_src = os.path.relpath(REPO_ROOT / image, REVIEW_ROOT).replace("\\", "/") if image else ""
        image_html = f'<img src="{html.escape(image_src)}" loading="lazy">' if image else ""
        rows.append(
            "<tr>"
            f"<td>{html.escape(record.get('reviewStatus', ''))}</td>"
            f"<td>{html.escape(record.get('area', ''))}<br>{html.escape(record.get('locationHint') or '')}</td>"
            f"<td><strong>{html.escape(record.get('dishName', ''))}</strong><br>¥{html.escape(str(record.get('price') or ''))}</td>"
            f"<td>{html.escape(record.get('sourceMethod', ''))} · {html.escape(record.get('imageKind', ''))}<br>{html.escape(str(record.get('ocrConfidence') or ''))}<br>重复 {html.escape(str(record.get('duplicateCount') or 1))}</td>"
            f"<td>{html.escape(record.get('sourceText', ''))}</td>"
            f"<td>{image_html}</td>"
            "</tr>"
        )
    page = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>西电食堂 OCR 复核</title>
  <style>
    body {{ margin: 0; font-family: "Microsoft YaHei", sans-serif; color: #17211c; background: #f5f7f4; }}
    header {{ position: sticky; top: 0; padding: 18px 22px; background: #fff; border-bottom: 1px solid #dbe3dd; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ padding: 12px; border-bottom: 1px solid #dbe3dd; vertical-align: top; background: #fff; }}
    th {{ position: sticky; top: 69px; background: #eef5f1; text-align: left; }}
    img {{ max-width: 220px; max-height: 180px; object-fit: contain; border: 1px solid #dbe3dd; }}
  </style>
</head>
<body>
  <header>
    <h1>西电食堂 OCR 复核</h1>
    <p>编辑 review.json，把正确行的 reviewStatus 改成 approved 后运行 npm run data:xdu:generate。</p>
  </header>
  <table>
    <thead><tr><th>状态</th><th>窗口</th><th>菜品/价格</th><th>来源</th><th>OCR 原文</th><th>图片</th></tr></thead>
    <tbody>{chr(10).join(rows)}</tbody>
  </table>
</body>
</html>
"""
    (REVIEW_ROOT / "review.html").write_text(page, encoding="utf-8")


def clean_text(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"[\u200b\xa0]+", "", value)
    return value.strip()


def first_match(value: str, pattern: str) -> str:
    match = re.search(pattern, value)
    return html.unescape(match.group(1)) if match else ""


def image_ext(url: str) -> str:
    parsed = urlparse(url)
    fmt = re.search(r"wx_fmt=(\w+)", parsed.query)
    if fmt:
        ext = fmt.group(1).lower()
        return ".jpg" if ext == "jpeg" else f".{ext}"
    suffix = Path(parsed.path).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"


def slugify(value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:8]
    cleaned = re.sub(r"\s+", "-", value.lower())
    cleaned = re.sub(r"[^\u4e00-\u9fa5a-z0-9-]", "", cleaned)
    return f"{cleaned[:56].strip('-')}-{digest}"


def mean(values: list[Any]) -> float | None:
    numbers = [float(value) for value in values if isinstance(value, (int, float))]
    if not numbers:
        return None
    return round(sum(numbers) / len(numbers), 4)


def unique(values: list[Any]) -> list[Any]:
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def unique_flat(values: list[list[str]]) -> list[str]:
    return unique([item for group in values for item in group])


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")


def json_for_ts(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, indent=2)
    return text.replace(": null", ": undefined")


def rel(path: Path) -> str:
    return str(path.resolve().relative_to(REPO_ROOT)).replace("\\", "/")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import public XDU logistics canteen menus.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("fetch", help="Fetch WeChat article HTML and images.").set_defaults(func=command_fetch)
    ocr_parser = subparsers.add_parser("ocr", help="Run PaddleOCR and build review files.")
    ocr_parser.add_argument("--article", help="Only OCR one article id from articles.json.")
    ocr_parser.add_argument("--limit", type=int, help="Maximum number of images to OCR in this run.")
    ocr_parser.add_argument("--force", action="store_true", help="Discard previous OCR results and rerun selected images.")
    ocr_parser.set_defaults(func=command_ocr)
    subparsers.add_parser("review", help="Rebuild review files from fetched/OCR data.").set_defaults(func=command_review)
    ai_parser = subparsers.add_parser("ai-review", help="Use OpenAI vision to suggest corrections for pending OCR review rows.")
    ai_parser.add_argument("--record", help="Only review one reviewId.")
    ai_parser.add_argument("--limit", type=int, default=10, help="Maximum number of pending rows to send to OpenAI.")
    ai_parser.add_argument("--model", default=os.getenv("OPENAI_VISION_MODEL", OPENAI_VISION_MODEL), help="OpenAI vision-capable model.")
    ai_parser.add_argument("--timeout", type=int, default=60, help="OpenAI request timeout in seconds.")
    ai_parser.add_argument("--dry-run", action="store_true", help="Print suggestions without updating review.json.")
    ai_parser.set_defaults(func=command_ai_review)
    subparsers.add_parser("generate", help="Generate the approved TypeScript dataset.").set_defaults(func=command_generate)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
