from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import re
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
XDU_IMPORTER_DIR = REPO_ROOT / "tools" / "xdu-canteen-import"
sys.path.insert(0, str(XDU_IMPORTER_DIR))

from xdu_canteen_importer import (  # noqa: E402
    dishes_from_ocr_line,
    is_side_dish,
    make_paddle_ocr,
    normalize_ocr_result,
    run_paddle_ocr,
)

DEFAULT_INPUT = REPO_ROOT / "data" / "menu-screenshots" / "inbox"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "menu-screenshots" / "review"
DEFAULT_SUBMISSIONS = REPO_ROOT / "server-data" / "submissions.jsonl"
DEFAULT_DATABASE = REPO_ROOT / "server-data" / "xdufood.sqlite"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
PRICE_MARKER_RE = re.compile(r"(?:¥|￥|元|块|\b\d+(?:\.\d{1,2})?\b)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="OCR local menu screenshots/photos into pending review drafts. This tool never visits external platforms."
    )
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Folder containing local screenshots or menu photos.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output folder for review JSON/CSV.")
    parser.add_argument(
        "--submissions",
        default="",
        help="Optional submissions source. Use 'default' to read server-data/xdufood.sqlite, or pass a .sqlite/.jsonl file.",
    )
    parser.add_argument("--vendor", default="", help="Vendor name to attach to standalone image drafts.")
    parser.add_argument("--area", default="", help="Area/location to attach to standalone image drafts.")
    parser.add_argument("--floor", default="", help="Floor to attach to standalone image drafts.")
    parser.add_argument("--window-no", default="", help="Window number to attach to standalone image drafts.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of images to OCR.")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    image_jobs = collect_image_jobs(args)
    if args.limit:
        image_jobs = image_jobs[: args.limit]

    if not image_jobs:
        (output_dir / "menu-ocr-raw.json").write_text("[]\n", encoding="utf-8")
        (output_dir / "menu-ocr-drafts.json").write_text("[]\n", encoding="utf-8")
        write_csv(output_dir / "menu-ocr-drafts.csv", [])
        print("No local screenshots or submission attachments found.")
        print(f"Wrote {relative(output_dir / 'menu-ocr-drafts.json')}")
        return

    engine = make_paddle_ocr()
    records: list[dict[str, Any]] = []
    raw_images: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="xdu-menu-ocr-") as temp_dir:
        temp_root = Path(temp_dir)
        for index, job in enumerate(image_jobs, start=1):
            image_path = materialize_image(job, temp_root)
            print(f"OCR {index}/{len(image_jobs)} {job['label']}")
            raw = run_paddle_ocr(engine, image_path)
            lines = normalize_ocr_result(raw)
            raw_images.append({**public_job(job), "lines": lines})
            records.extend(records_from_lines(job, lines))

    deduped = dedupe_records(records)
    (output_dir / "menu-ocr-raw.json").write_text(json.dumps(raw_images, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "menu-ocr-drafts.json").write_text(json.dumps(deduped, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(output_dir / "menu-ocr-drafts.csv", deduped)

    print(f"Wrote {relative(output_dir / 'menu-ocr-drafts.json')}")
    print(f"Wrote {relative(output_dir / 'menu-ocr-drafts.csv')}")
    print(f"Draft dishes: {len(deduped)}")


def collect_image_jobs(args: argparse.Namespace) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    input_dir = Path(args.input)
    if input_dir.exists():
        for image in sorted(input_dir.rglob("*")):
            if image.is_file() and image.suffix.lower() in IMAGE_EXTENSIONS:
                jobs.append(
                    {
                        "kind": "file",
                        "label": str(image),
                        "path": str(image),
                        "vendorName": args.vendor,
                        "area": args.area,
                        "floor": args.floor,
                        "windowNo": args.window_no,
                        "note": "Local menu screenshot/photo supplied by admin.",
                    }
                )

    submissions_source = resolve_submissions_arg(args.submissions)
    if submissions_source and submissions_source[1].exists():
        source_kind, submissions_path = submissions_source
        submissions = read_sqlite_submissions(submissions_path) if source_kind == "sqlite" else read_jsonl(submissions_path)
        for submission in submissions:
            for photo in submission.get("attachments") or []:
                jobs.append(
                    {
                        "kind": "submission",
                        "label": f"{submission.get('id')} / {photo.get('name', 'menu-photo')}",
                        "submissionId": submission.get("id", ""),
                        "attachmentId": photo.get("id", ""),
                        "name": photo.get("name", "menu-photo.jpg"),
                        "dataUrl": photo.get("dataUrl", ""),
                        "vendorName": submission.get("vendorName", ""),
                        "area": submission.get("area", ""),
                        "floor": submission.get("floor", ""),
                        "windowNo": submission.get("windowNo", ""),
                        "note": submission.get("note", ""),
                    }
                )

    return jobs


def resolve_submissions_arg(value: str) -> tuple[str, Path] | None:
    if not value:
        return None
    if value == "default":
        if DEFAULT_DATABASE.exists():
            return ("sqlite", DEFAULT_DATABASE)
        return ("jsonl", DEFAULT_SUBMISSIONS)
    path = Path(value)
    if path.suffix.lower() in {".sqlite", ".sqlite3", ".db"}:
        return ("sqlite", path)
    return ("jsonl", path)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                rows.append(value)
        except json.JSONDecodeError:
            continue
    return rows


def read_sqlite_submissions(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        for row in connection.execute("SELECT payload_json FROM submissions ORDER BY created_at DESC"):
            try:
                submission = json.loads(row["payload_json"])
            except json.JSONDecodeError:
                continue
            submission["attachments"] = read_sqlite_attachments(connection, str(submission.get("id") or ""))
            submission["attachmentCount"] = len(submission["attachments"])
            rows.append(submission)
    return rows


def read_sqlite_attachments(connection: sqlite3.Connection, submission_id: str) -> list[dict[str, Any]]:
    attachments: list[dict[str, Any]] = []
    for row in connection.execute(
        """
        SELECT id, name, mime_type, size_bytes, data_blob
        FROM submission_attachments
        WHERE submission_id = ?
        ORDER BY rowid ASC
        """,
        (submission_id,),
    ):
        mime_type = str(row["mime_type"] or "image/jpeg")
        data = base64.b64encode(bytes(row["data_blob"])).decode("ascii")
        attachments.append(
            {
                "id": row["id"],
                "name": row["name"],
                "mimeType": mime_type,
                "size": int(row["size_bytes"] or 0),
                "dataUrl": f"data:{mime_type};base64,{data}",
            }
        )
    return attachments


def materialize_image(job: dict[str, Any], temp_root: Path) -> Path:
    if job["kind"] == "file":
        return Path(job["path"])

    data_url = job.get("dataUrl", "")
    match = re.match(r"^data:image/[^;]+;base64,(.+)$", data_url, re.I | re.S)
    if not match:
        raise ValueError(f"Submission image is not a valid data URL: {job.get('label')}")
    suffix = Path(job.get("name") or "menu-photo.jpg").suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        suffix = ".jpg"
    image_path = temp_root / f"{stable_id(job.get('label', 'submission-photo'))}{suffix}"
    image_path.write_bytes(base64.b64decode(re.sub(r"\s+", "", match.group(1))))
    return image_path


def records_from_lines(job: dict[str, Any], lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    texts = [str(line.get("text") or "").strip() for line in lines if str(line.get("text") or "").strip()]
    merged_texts = merge_split_price_lines(texts)

    for text in merged_texts:
        dishes = dishes_from_ocr_line(text)
        for dish in dishes:
            dish_name = str(dish.get("dishName") or "").strip()
            price = dish.get("price")
            if not dish_name or is_side_dish(dish_name, price):
                continue
            confidence = confidence_for_text(text, lines)
            record = {
                "reviewId": stable_id(job.get("label", ""), dish_name, str(price or "")),
                "reviewStatus": "pending",
                "sourceMethod": "ocr",
                "sourceKind": job.get("kind", ""),
                "submissionId": job.get("submissionId", ""),
                "attachmentId": job.get("attachmentId", ""),
                "vendorName": job.get("vendorName", ""),
                "area": job.get("area", ""),
                "floor": job.get("floor", ""),
                "windowNo": job.get("windowNo", ""),
                "dishName": dish_name,
                "price": price,
                "types": infer_types(dish_name),
                "available": ["lunch", "dinner"],
                "heat": infer_heat(dish_name),
                "sourceText": text,
                "ocrConfidence": confidence,
                "parseWarnings": dish.get("parseWarnings") or [],
                "note": job.get("note", ""),
            }
            records.append(record)
    return records


def merge_split_price_lines(texts: list[str]) -> list[str]:
    merged: list[str] = []
    carry = ""
    for text in texts:
        normalized = normalize_text(text)
        if not normalized:
            continue
        has_price = bool(PRICE_MARKER_RE.search(normalized))
        if has_price and carry:
            merged.append(f"{carry} {normalized}")
            carry = ""
        elif has_price:
            merged.append(normalized)
        elif is_probable_dish_fragment(normalized):
            if carry:
                merged.append(carry)
            carry = normalized
        else:
            if carry:
                merged.append(carry)
                carry = ""
            merged.append(normalized)
    if carry:
        merged.append(carry)
    return merged


def is_probable_dish_fragment(text: str) -> bool:
    if len(text) < 2 or len(text) > 24:
        return False
    if re.search(r"配送|月售|评价|起送|满减|公告|商家|推荐|招牌|优惠|下单|会员|红包", text):
        return False
    return bool(re.search(r"[\u4e00-\u9fa5]", text))


def normalize_text(text: str) -> str:
    return (
        text.replace("￥", "¥")
        .replace("＄", "¥")
        .replace(" 元", "元")
        .replace("块钱", "元")
        .strip()
    )


def confidence_for_text(text: str, lines: list[dict[str, Any]]) -> float | None:
    scores = [
        float(line.get("confidence"))
        for line in lines
        if line.get("confidence") is not None and str(line.get("text") or "").strip() in text
    ]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 4)


def dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for record in records:
        key = "|".join(
            [
                comparable(record.get("vendorName", "")),
                comparable(record.get("area", "")),
                comparable(record.get("dishName", "")),
                str(record.get("price") or ""),
            ]
        )
        existing = by_key.get(key)
        if not existing:
            by_key[key] = {**record, "duplicateCount": 1}
            continue
        existing["duplicateCount"] += 1
        existing["ocrConfidence"] = max_score(existing.get("ocrConfidence"), record.get("ocrConfidence"))
        existing["sourceText"] = unique_join([existing.get("sourceText", ""), record.get("sourceText", "")])
    return sorted(by_key.values(), key=lambda row: (row.get("area", ""), row.get("vendorName", ""), row.get("dishName", "")))


def write_csv(path: Path, records: list[dict[str, Any]]) -> None:
    headers = [
        "reviewStatus",
        "vendorName",
        "area",
        "floor",
        "windowNo",
        "dishName",
        "price",
        "types",
        "available",
        "heat",
        "ocrConfidence",
        "sourceKind",
        "submissionId",
        "sourceText",
        "parseWarnings",
        "duplicateCount",
        "note",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for record in records:
            writer.writerow({key: csv_value(record.get(key)) for key in headers})


def infer_types(name: str) -> list[str]:
    if re.search(r"面|粉|米线|馄饨|饺|馍|饼", name):
        return ["noodle"]
    if is_drink_or_dessert(name):
        return ["drink"]
    if re.search(r"炸|串|烤肠|鸡排|小酥肉|薯|饼", name):
        return ["snack"]
    return ["rice"]


def is_drink_or_dessert(name: str) -> bool:
    if re.search(r"茶泡饭|茶香鸡|茶叶蛋|茶树|蜜汁|烤汁饭|甜皮鸭|甜辣|酸甜|香甜豆沙包|甜饭团|水果玉米", name):
        return False
    return bool(
        re.search(
            r"奶茶|咖啡|果茶|饮料|果汁|柠檬水|柠檬茶|柠檬汁|鲜饮|鲜榨|水果捞|水果茶|果切|鲜果|"
            r"时令水果|自选水果|各类水果|西瓜汁|芒果汁|酸奶|豆浆|圣代|甜品|蛋糕|布丁|冰粉",
            name,
        )
    )


def infer_heat(name: str) -> str:
    if re.search(r"麻辣|香辣|辣椒|剁椒|冒菜|川香|湘", name):
        return "medium"
    return "none"


def csv_value(value: Any) -> str:
    if isinstance(value, list):
        return ",".join(map(str, value))
    if value is None:
        return ""
    return str(value)


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in job.items() if key != "dataUrl"}


def comparable(value: Any) -> str:
    return re.sub(r"[^\w\u4e00-\u9fa5]+", "", str(value).lower())


def stable_id(*parts: str) -> str:
    text = "|".join(str(part) for part in parts)
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
    readable = re.sub(r"[^\w\u4e00-\u9fa5]+", "-", text.lower()).strip("-")[:60]
    return f"{readable}-{digest}" if readable else digest


def max_score(a: Any, b: Any) -> float | None:
    scores = [float(value) for value in [a, b] if value is not None]
    return max(scores) if scores else None


def unique_join(values: list[str]) -> str:
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
    return " / ".join(seen)


def relative(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    main()
