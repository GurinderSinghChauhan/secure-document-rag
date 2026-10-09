"""Bounded conversation context, distinct from authoritative document evidence."""

from collections.abc import Iterable


def bounded_history(messages: Iterable[object], max_characters: int) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    remaining = max_characters
    for message in reversed(list(messages)):
        role = getattr(message, "role", None)
        content = getattr(message, "content", "")
        if role not in {"user", "assistant"} or not isinstance(content, str) or not content.strip():
            continue
        # Keep complete messages so a truncated answer cannot change its meaning.
        if len(content) > remaining:
            break
        history.append({"role": role, "content": content})
        remaining -= len(content)
    return list(reversed(history))
