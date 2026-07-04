import asyncio
import csv
import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import edge_tts


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = PROJECT_ROOT / "Word-Rush"
DATA_DIR = APP_ROOT / "data"
OUTPUT_ROOT = APP_ROOT / "assets" / "word-audio" / "en-us-edge-tts"
WORK_ROOT = PROJECT_ROOT / "work" / "edge-word-audio-generation"
REPORT_PATH = WORK_ROOT / "report.json"
PROGRESS_PATH = WORK_ROOT / "progress.jsonl"
ERROR_PATH = WORK_ROOT / "errors.jsonl"
VOICE = "en-US-JennyNeural"
MAX_RETRIES = 5
RETRY_BASE_SECONDS = 3


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def load_words():
    words = []
    for csv_path in sorted(DATA_DIR.glob("*.csv")):
        level_id = csv_path.stem
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                word_id = (row.get("id") or "").strip()
                english = (row.get("english") or "").strip()
                if not word_id or not english:
                    raise ValueError(f"Missing id/english in {csv_path}: {row}")
                words.append({
                    "level": level_id,
                    "id": word_id,
                    "english": english,
                    "output": str(OUTPUT_ROOT / level_id / f"{word_id}.mp3"),
                })
    return words


def valid_mp3(path):
    return path.exists() and path.stat().st_size > 512


def append_jsonl(path, record):
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


async def synthesize(word, index, total):
    output = Path(word["output"])
    output.parent.mkdir(parents=True, exist_ok=True)

    if valid_mp3(output):
        return "skipped"

    temp_output = output.with_suffix(".tmp.mp3")
    if temp_output.exists():
        temp_output.unlink()

    last_error = ""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            tts = edge_tts.Communicate(text=word["english"], voice=VOICE)
            await tts.save(str(temp_output))
            if not valid_mp3(temp_output):
                raise RuntimeError(f"Generated file is too small: {temp_output.stat().st_size if temp_output.exists() else 0}")
            shutil.move(str(temp_output), str(output))
            append_jsonl(PROGRESS_PATH, {
                "at": iso_now(),
                "index": index,
                "total": total,
                "id": word["id"],
                "english": word["english"],
                "bytes": output.stat().st_size,
                "status": "created",
            })
            return "created"
        except Exception as error:
            last_error = repr(error)
            if temp_output.exists():
                temp_output.unlink()
            append_jsonl(ERROR_PATH, {
                "at": iso_now(),
                "index": index,
                "total": total,
                "id": word["id"],
                "english": word["english"],
                "attempt": attempt,
                "error": last_error,
            })
            await asyncio.sleep(RETRY_BASE_SECONDS * attempt)

    raise RuntimeError(f"Failed {word['id']} after {MAX_RETRIES} attempts: {last_error}")


async def main():
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    words = load_words()
    total = len(words)
    if total != 7000:
        raise RuntimeError(f"Expected 7000 words, found {total}")

    started = time.time()
    created = 0
    skipped = 0

    for index, word in enumerate(words, start=1):
        status = await synthesize(word, index, total)
        if status == "created":
            created += 1
        else:
            skipped += 1

        if index == 1 or index % 25 == 0 or index == total:
            elapsed = time.time() - started
            done = created + skipped
            rate = done / elapsed if elapsed > 0 else 0
            remaining = (total - done) / rate if rate > 0 else None
            report = {
                "updatedAt": iso_now(),
                "voice": VOICE,
                "outputRoot": str(OUTPUT_ROOT),
                "total": total,
                "createdThisRun": created,
                "skippedThisRun": skipped,
                "doneThisRun": done,
                "lastId": word["id"],
                "elapsedSeconds": round(elapsed, 1),
                "estimatedRemainingSeconds": round(remaining, 1) if remaining is not None else None,
            }
            REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10+ is required")
    asyncio.run(main())
