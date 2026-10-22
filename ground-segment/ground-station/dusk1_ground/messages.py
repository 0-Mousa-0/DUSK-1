"""The JSON messages the backend pushes to dashboards (Server-Sent Events).

The dashboard's demo simulator and replay player send exactly the same messages,
so every view works the same whatever the source. Keep this file and
web/js/core/store.js in step.
"""
from typing import Optional


def telemetry(sat_time: str, rx_ms: int, values: dict) -> dict:
    return {"type": "telemetry", "t": sat_time, "rx": rx_ms, **values}


def event(ts_ms: int, severity: str, category: str, text: str) -> dict:
    return {"type": "event", "ts": ts_ms, "sev": severity, "cat": category, "msg": text}


def console(ts_ms: int, text: str) -> dict:
    return {"type": "console", "ts": ts_ms, "text": text}


def boot(sat_time: str, rx_ms: int, text: str, fields: dict) -> dict:
    return {"type": "boot", "t": sat_time, "text": text, "fields": fields, "rx": rx_ms}


def ground_status(ts_ms: int, text: str, fields: dict) -> dict:
    return {"type": "gs", "ts": ts_ms, "text": text, "fields": fields}


def picture_progress(image_id: int, got: int, total: int, width: int, height: int, size: int) -> dict:
    return {"type": "img_progress", "id": image_id, "got": got, "total": total,
            "w": width, "h": height, "bytes": size}


def picture(image_id: int, url: str, name: str, width: int, height: int, size: int, missing: int,
            pieces: int, sat_time: str, rx_ms: int) -> dict:
    return {"type": "image", "id": image_id, "url": url, "name": name, "w": width, "h": height,
            "bytes": size, "complete": missing == 0, "missing": missing, "pieces": pieces,
            "t": sat_time, "rx": rx_ms}


def link(state: str, source: str, connected: bool, age: Optional[float]) -> dict:
    return {"type": "link", "state": state, "source": source, "connected": connected, "age": age}


def stats(counters: dict) -> dict:
    return {"type": "stats", **counters}
