"""Client OpenRouter compatible format OpenAI.

Centralise les appels API pour Gemini (vision) et Claude Opus 4.6 (raisonnement)
via un seul endpoint. Voir section 3 de la specification.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from .config import AgentConfig


@dataclass
class ChatMessage:
    role: str
    content: Any  # string ou list de "parts" multimodales


class OpenRouterClient:
    """Client minimal pour l'API OpenRouter (format OpenAI-compatible)."""

    def __init__(self, config: AgentConfig):
        config.ensure_valid()
        self.config = config
        self._cache_dir = Path(config.cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    # ----- API publique -------------------------------------------------

    def call_reasoning(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        response_is_json: bool = True,
        cache_key: Optional[str] = None,
    ) -> str:
        """Appel au modele de raisonnement (Claude Opus 4.6)."""
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        return self._chat(
            model=self.config.model_reasoning,
            messages=messages,
            response_format_json=response_is_json,
            cache_key=cache_key,
        )

    def call_vision(
        self,
        system_prompt: str,
        user_prompt: str,
        image_path: str,
        *,
        response_is_json: bool = True,
        cache_key: Optional[str] = None,
    ) -> str:
        """Appel au modele multimodal (Gemini) avec une image encodee en base64."""
        image_data_url = _encode_image_as_data_url(image_path)
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ]
        return self._chat(
            model=self.config.model_vision,
            messages=messages,
            response_format_json=response_is_json,
            cache_key=cache_key,
        )

    # ----- Implementation interne --------------------------------------

    def _chat(
        self,
        *,
        model: str,
        messages: List[Dict[str, Any]],
        response_format_json: bool,
        cache_key: Optional[str],
    ) -> str:
        cache_file = self._cache_path(model, messages, cache_key)
        if cache_file and cache_file.exists():
            return cache_file.read_text(encoding="utf-8")

        headers = {
            "Authorization": f"Bearer {self.config.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://fimurex.local/ia-agent",
            "X-Title": "Fimurex IA Agent",
        }
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        }
        if response_format_json:
            payload["response_format"] = {"type": "json_object"}

        last_err: Optional[Exception] = None
        for attempt in range(3):
            try:
                response = requests.post(
                    f"{self.config.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=self.config.request_timeout_s,
                )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                if cache_file:
                    cache_file.write_text(content, encoding="utf-8")
                return content
            except (requests.RequestException, KeyError, ValueError) as err:
                last_err = err
                time.sleep(2 ** attempt)
        raise RuntimeError(f"OpenRouter call failed after retries: {last_err}")

    def _cache_path(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        cache_key: Optional[str],
    ) -> Optional[Path]:
        if not self.config.cache_dir:
            return None
        if cache_key is None:
            # Hash du payload pour clef de cache automatique.
            h = hashlib.sha256()
            h.update(model.encode())
            h.update(json.dumps(messages, sort_keys=True, default=str).encode())
            cache_key = h.hexdigest()[:24]
        safe = "".join(c for c in cache_key if c.isalnum() or c in "-_.")
        return self._cache_dir / f"{safe}.txt"


def _encode_image_as_data_url(image_path: str) -> str:
    ext = os.path.splitext(image_path)[1].lower().lstrip(".") or "png"
    mime = {"jpg": "jpeg"}.get(ext, ext)
    with open(image_path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    return f"data:image/{mime};base64,{b64}"


def parse_json_response(raw: str) -> Any:
    """Extrait un JSON d'une reponse de modele, tolerant aux fences Markdown."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)
