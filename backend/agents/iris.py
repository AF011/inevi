"""
IRIS Agent -- Perception
=========================
IRIS captures live camera frames and analyzes what it sees.
It produces TWO separate outputs:
1. Background description -- for LOKI location matching (ignores people)
2. Scene context -- for VEDA communication (includes people and activity)
"""

import os
import time
import base64
import json
import re
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY      = os.getenv("GROQ_API_KEY")
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

client = Groq(api_key=GROQ_API_KEY)

IRIS_PROMPT = """Analyze this camera frame and return ONLY this exact JSON with no markdown or explanation:

{
  "background_description": "Describe ONLY the background environment - walls, furniture, objects, colors, patterns. Completely ignore any people in the frame. Be very specific: wall colors, distinctive objects, decorations, signs.",
  "scene_description": "Describe the full scene including what person(s) are doing and where they are in the environment.",
  "person_context": "What is the person doing? Are they walking, standing, looking at something? Or 'no person visible'.",
  "location_type": "room/kitchen/hall/corridor/outdoor/entrance/office/other",
  "visible_signs": ["any readable text, signs, labels, boards, calendars visible in background"],
  "landmarks": ["specific background items: exact colors of walls, distinctive furniture, patterns, decorations"],
  "distinctive_features": "the single most unique identifying background feature (e.g. 'blue walls with brown wardrobes', 'black white geometric tiles', 'colorful hanging chandelier')",
  "confidence": "high/medium/low"
}

Critical rules:
- background_description must NEVER mention people or persons
- landmarks must be background objects only - wall colors, furniture, fixtures
- Be very specific: 'light blue walls' not just 'walls', 'red mechanical keyboard' not just 'keyboard'
- visible_signs: include ANY text visible anywhere in background
- Return raw JSON only, absolutely no backticks or markdown"""


def analyze_frame(image_b64: str, mime: str = "image/jpeg") -> dict:
    """
    Analyze a live camera frame using Groq Vision.
    Returns TWO tracks:
    - Background track (for LOKI matching) -- no people
    - Scene track (for VEDA communication) -- full context

    Args:
        image_b64: Base64 encoded image
        mime: MIME type

    Returns:
        {
            background_description: str,  -- LOKI uses this
            scene_description: str,        -- VEDA uses this
            person_context: str,           -- VEDA uses this
            location_type: str,
            visible_signs: list,
            landmarks: list,
            distinctive_features: str,
            confidence: str,
        }
    """
    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=GROQ_VISION_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                            },
                            {
                                "type": "text",
                                "text": IRIS_PROMPT,
                            },
                        ],
                    }
                ],
                max_tokens=500,
                temperature=0.1,
            )

            raw = resp.choices[0].message.content.strip()
            raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()

            result = json.loads(raw)

            return {
                "background_description": str(result.get("background_description", "")),
                "scene_description":      str(result.get("scene_description", "")),
                "person_context":         str(result.get("person_context", "no person visible")),
                "location_type":          str(result.get("location_type", "unknown")),
                "visible_signs":          result.get("visible_signs", []),
                "landmarks":              result.get("landmarks", []),
                "distinctive_features":   str(result.get("distinctive_features", "")),
                "confidence":             str(result.get("confidence", "low")),
            }

        except json.JSONDecodeError:
            # Fallback -- try to extract background description from raw text
            return {
                "background_description": raw[:300] if 'raw' in dir() else "",
                "scene_description":      raw[:300] if 'raw' in dir() else "",
                "person_context":         "unknown",
                "location_type":          "unknown",
                "visible_signs":          [],
                "landmarks":              [],
                "distinctive_features":   "",
                "confidence":             "low",
            }

        except Exception as e:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            return {
                "background_description": f"Vision error: {str(e)}",
                "scene_description":      f"Vision error: {str(e)}",
                "person_context":         "unknown",
                "location_type":          "unknown",
                "visible_signs":          [],
                "landmarks":              [],
                "distinctive_features":   "",
                "confidence":             "low",
            }

    return {
        "background_description": "Could not analyze frame",
        "scene_description":      "Could not analyze frame",
        "person_context":         "unknown",
        "location_type":          "unknown",
        "visible_signs":          [],
        "landmarks":              [],
        "distinctive_features":   "",
        "confidence":             "low",
    }


def encode_image(image_bytes: bytes, mime: str = "image/jpeg") -> str:
    """Encode raw bytes to base64."""
    return base64.b64encode(image_bytes).decode("utf-8")