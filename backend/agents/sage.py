"""
SAGE Agent -- Knowledge Retrieval
===================================
SAGE takes a matched location node and retrieves relevant knowledge
to help the user understand where they are and what is around them.
"""

import os
import json
from groq import Groq
from dotenv import load_dotenv

from backend.services.aurora import get_location, get_connections

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL  = "llama-3.3-70b-versatile"


def get_location_context(node_id: str) -> dict:
    """Get all knowledge about a location."""
    loc = get_location(node_id)
    if not loc:
        return {}

    conns = get_connections(node_id)
    return {
        **dict(loc),
        "connections": [dict(c) for c in conns],
    }


def generate_arrival_message(
    node_id:     str,
    language:    str = "en",
    destination: str = None,
) -> str:
    """
    Generate a natural greeting when user arrives at a location.
    Example: "You are at the Hall. This is the main living area.
              Where would you like to go?"
    """
    ctx = get_location_context(node_id)
    if not ctx:
        return "I can see you but I could not identify this location."

    connected_places = [c["to_node"].replace("_", " ") for c in ctx.get("connections", [])]
    connected_str    = ", ".join(connected_places) if connected_places else "no connected locations"

    lang_instruction = {
        "te": "Respond in Telugu language",
        "hi": "Respond in Hindi language",
        "en": "Respond in English",
    }.get(language, "Respond in English")

    prompt = f"""{lang_instruction}.

You are VEDA, an AI spatial guide. The user has just been identified at this location:

Name: {ctx.get('name')}
Description: {ctx.get('description')}
Facts: {ctx.get('facts')}
Connected to: {connected_str}

Generate a SHORT, friendly arrival message (2-3 sentences max) that:
1. Tells them where they are
2. Briefly mentions what this place is
3. Asks where they want to go

Be conversational and warm. No bullet points. Speak naturally like a guide."""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=150,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()


def generate_location_facts(
    node_id:  str,
    question: str = None,
    language: str = "en",
) -> str:
    """
    Answer a question about the current location or provide facts.
    """
    ctx = get_location_context(node_id)
    if not ctx:
        return "I don't have information about this location."

    lang_instruction = {
        "te": "Respond in Telugu language",
        "hi": "Respond in Hindi language",
        "en": "Respond in English",
    }.get(language, "Respond in English")

    prompt = f"""{lang_instruction}.

You are VEDA, an AI spatial guide. Answer this about the current location.

Location: {ctx.get('name')}
Description: {ctx.get('description')}
Facts: {ctx.get('facts')}

User question: {question or 'Tell me about this place'}

Answer in 2-3 sentences max. Be helpful and informative."""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=150,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()


def identify_destination(
    user_input:   str,
    current_node: str,
    language:     str = "en",
) -> dict:
    """
    Extract the user's destination from their speech.
    First tries fast keyword match, then LLM fallback.
    """
    from backend.services.aurora import get_all_locations as _get_all
    import re as _re

    try:
        all_locs = [dict(l) for l in _get_all()]
    except Exception:
        all_locs = []

    if not all_locs:
        return {"found": False, "node_id": None, "name": None}

    user_lower = user_input.lower().strip()

    # ── Fast keyword match first (no LLM needed) ──
    # Check if any location name words appear in user speech
    for loc in all_locs:
        name_lower = loc["name"].lower()
        node_lower = loc["node_id"].lower().replace("_", " ")

        # Direct name match
        if name_lower in user_lower:
            return {"found": True, "node_id": loc["node_id"], "name": loc["name"]}

        # Node words match (e.g. "kitchen" matches "home_kitchen")
        node_words = [w for w in node_lower.split() if len(w) > 3]
        if any(w in user_lower for w in node_words):
            return {"found": True, "node_id": loc["node_id"], "name": loc["name"]}

        # Name words match (e.g. "library" matches "VIT-AP University Library")
        name_words = [w for w in name_lower.split() if len(w) > 3]
        if any(w in user_lower for w in name_words):
            return {"found": True, "node_id": loc["node_id"], "name": loc["name"]}

    # ── LLM fallback for fuzzy matches ──
    locs_text = "\n".join([
        f"- node_id: {loc['node_id']} | name: {loc['name']}"
        for loc in all_locs
    ])

    prompt = f"""The user said: "{user_input}"

Available locations:
{locs_text}

Which location does the user want to go to?
Return ONLY valid JSON (no markdown):
{{
  "found": true or false,
  "node_id": "exact node_id from list or null",
  "name": "exact name from list or null",
  "reason": "why"
}}"""

    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=150,
            temperature=0.1,
        )
        raw = resp.choices[0].message.content.strip()
        raw = _re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        return json.loads(raw)
    except Exception:
        return {"found": False, "node_id": None, "name": None}