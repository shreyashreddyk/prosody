from __future__ import annotations

import json
import logging
from typing import Any


def configure_logging(level_name: str) -> None:
    level = getattr(logging, level_name.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        force=True,
    )


def format_log_fields(**fields: Any) -> str:
    pairs: list[str] = []
    for key, value in sorted(fields.items()):
        if value is None:
            continue
        pairs.append(f"{key}={json.dumps(value, default=str, sort_keys=True)}")
    return " ".join(pairs)


def log_diagnostic(logger: logging.Logger, level: int, message: str, **fields: Any) -> None:
    formatted_fields = format_log_fields(**fields)
    if formatted_fields:
        logger.log(level, "%s %s", message, formatted_fields)
        return
    logger.log(level, message)
