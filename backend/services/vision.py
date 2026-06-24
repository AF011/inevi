import os
import time
import base64
from pathlib import Path
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY      = os.getenv("GROQ_API_KEY")
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

client = Groq(api_key=GROQ_API_KEY)


def encode_image(image_path: str) -> tuple[str, str]:
    """Encode image to base64 and detect mime type."""
    ext  = Path(image_path).suffix.lower()
    mime = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8"), mime


def encode_image_bytes(image_bytes: bytes, mime: str = "image/jpeg") -> str:
    """Encode raw bytes to base64."""
    return base64.b64encode(image_bytes).decode("utf-8")


#  Core Vision Call 

def analyze_image(image_b64: str, mime: str = "image/jpeg", prompt: str = None) -> str:
    """Send image to Groq Vision and get description."""
    if not prompt:
        prompt = """You are analyzing an image of a location inside or around a campus, museum, or public building in India.

Describe what you see in detail:
- What type of location is this? (entrance gate, corridor, building facade, garden, lab, library, cafeteria, etc.)
- What visual landmarks are clearly visible? (signs, boards, gates, trees, pathways, buildings)
- What colors, materials, or distinctive features do you see?
- Are there any readable text or signs visible?
- Is this image clear enough to identify this location? (yes/no)

Be specific and factual. Return only the description."""

    for attempt in range(3):
        try:
            resp = client.chat.completions.create(
                model=GROQ_VISION_MODEL,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type":      "image_url",
                                "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                            },
                            {
                                "type": "text",
                                "text": prompt,
                            },
                        ],
                    }
                ],
                max_tokens=500,
                temperature=0.1,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise e


def check_image_quality(image_b64: str, mime: str = "image/jpeg") -> dict:
    """Check if image is clear enough for location mapping."""
    prompt = """Look at this image carefully.

Answer these questions in JSON format only:
{
  "is_clear": true or false,
  "has_landmarks": true or false,
  "has_signs": true or false,
  "visible_text": "any readable text or signs you see, or empty string",
  "location_type": "what type of place this looks like",
  "rejection_reason": "if not clear, why? otherwise empty string"
}

Return ONLY the JSON. No explanation."""

    resp = client.chat.completions.create(
        model=GROQ_VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type":      "image_url",
                        "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        max_tokens=300,
        temperature=0.1,
    )

    import json, re
    raw = resp.choices[0].message.content.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
    try:
        return json.loads(raw)
    except Exception:
        return {
            "is_clear":        True,
            "has_landmarks":   True,
            "has_signs":       False,
            "visible_text":    "",
            "location_type":   "unknown",
            "rejection_reason": "",
        }


def analyze_live_frame(image_b64: str, mime: str = "image/jpeg") -> dict:
    """Analyze a live camera frame for navigation  used by IRIS agent."""
    prompt = """You are looking at a live camera frame from inside a campus or building.

Return ONLY valid JSON:
{
  "scene_description": "1-2 sentences describing exactly what you see",
  "location_type": "corridor/entrance/garden/building/lab/library/cafeteria/other",
  "visible_signs": ["list of any readable text or signs"],
  "landmarks": ["distinctive visual elements like gates, trees, boards"],
  "confidence": "high/medium/low"
}

Be precise. Only describe what is clearly visible."""

    resp = client.chat.completions.create(
        model=GROQ_VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type":      "image_url",
                        "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        max_tokens=400,
        temperature=0.1,
    )

    import json, re
    raw = resp.choices[0].message.content.strip()
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
    try:
        return json.loads(raw)
    except Exception:
        return {
            "scene_description": raw[:200],
            "location_type":     "unknown",
            "visible_signs":     [],
            "landmarks":         [],
            "confidence":        "low",
        }