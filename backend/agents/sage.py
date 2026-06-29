"""
SAGE Agent -- Knowledge Retrieval
===================================
identify_destination uses similarity search:
1. Score every location by how similar its name/node_id is to user input
2. Pass top 5 matches to LLM to pick the best one
No hardcoded words. Fully dynamic.
"""

import os
import json
import re
from groq import Groq
from dotenv import load_dotenv

from backend.services.aurora import get_location, get_connections

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL  = "llama-3.3-70b-versatile"


def get_location_context(node_id: str) -> dict:
    loc = get_location(node_id)
    if not loc:
        return {}
    conns = get_connections(node_id)
    return { **dict(loc), "connections": [dict(c) for c in conns] }


def generate_arrival_message(node_id: str, language: str = "en", destination: str = None) -> str:
    ctx = get_location_context(node_id)
    if not ctx:
        return "I can see you but I could not identify this location."

    lang_instruction = {"te": "Respond in Telugu", "hi": "Respond in Hindi", "en": "Respond in English"}.get(language, "Respond in English")

    prompt = f"""{lang_instruction}. You are VEDA, an AI spatial guide.
Location: {ctx.get('name')}
Description: {ctx.get('description')}
Generate a friendly 1 sentence arrival message and ask where they want to go. Keep it short."""

    resp = client.chat.completions.create(
        model=MODEL, messages=[{"role": "user", "content": prompt}],
        max_tokens=100, temperature=0.7,
    )
    return resp.choices[0].message.content.strip()


def generate_location_facts(node_id: str, question: str = None, language: str = "en") -> str:
    ctx = get_location_context(node_id)
    if not ctx:
        return "I don't have information about this location."

    lang_instruction = {"te": "Respond in Telugu", "hi": "Respond in Hindi", "en": "Respond in English"}.get(language, "Respond in English")

    prompt = f"""{lang_instruction}. You are VEDA, an AI spatial guide.
Location: {ctx.get('name')}
Description: {ctx.get('description')}
Facts: {ctx.get('facts')}
Question: {question or 'Tell me about this place'}
Answer in 2 sentences max."""

    resp = client.chat.completions.create(
        model=MODEL, messages=[{"role": "user", "content": prompt}],
        max_tokens=150, temperature=0.7,
    )
    return resp.choices[0].message.content.strip()


def _similarity_score(user_input: str, location: dict) -> float:
    """
    Score how similar a location is to the user's input.
    Uses character-level overlap — no hardcoded words, fully dynamic.
    """
    user_words = set(re.findall(r'\w+', user_input.lower()))
    
    # All text associated with this location
    name     = location.get("name", "").lower()
    node_id  = location.get("node_id", "").lower().replace("_", " ")
    desc     = location.get("description", "").lower()
    keywords = location.get("visual_keywords", "").lower()

    loc_text = f"{name} {node_id} {desc} {keywords}"
    loc_words = set(re.findall(r'\w+', loc_text))

    if not user_words or not loc_words:
        return 0.0

    # Word overlap score
    overlap = user_words & loc_words
    score   = len(overlap) / max(len(user_words), 1)

    # Bonus: if any user word is a substring of location name or vice versa
    for uw in user_words:
        if len(uw) > 2 and uw in name:
            score += 0.5
        if len(uw) > 2 and uw in node_id:
            score += 0.4
        # Also check if location name words are in user input
        for lw in loc_words:
            if len(lw) > 3 and lw in user_input.lower():
                score += 0.3

    return score


def identify_destination(user_input: str, current_node: str, language: str = "en", node_group: str = None) -> dict:
    """
    Find destination using similarity search + LLM confirmation.
    node_group: if set, only search nodes starting with this prefix (e.g. "home")
    """
    from backend.services.aurora import get_all_locations as _get_all

    try:
        all_locs = [dict(l) for l in _get_all()]
    except Exception:
        all_locs = []

    # Filter by group — only show relevant locations
    # e.g. at home_right_room → only search home_* nodes
    if node_group and any(l["node_id"].startswith(node_group) for l in all_locs):
        all_locs = [l for l in all_locs if l["node_id"].startswith(node_group)]

    if not all_locs:
        return {"found": False, "node_id": None, "name": None}

    # Score all locations
    scored = []
    for loc in all_locs:
        score = _similarity_score(user_input, loc)
        scored.append((score, loc))

    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)

    # If top score is clearly the best — direct match, skip LLM
    top_score, top_loc = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0

    # Direct match if: score is high enough AND clearly better than second best
    if top_score >= 0.5 and top_score > second_score * 1.3:
        return {"found": True, "node_id": top_loc["node_id"], "name": top_loc["name"]}

    # Take top 5 candidates for LLM
    candidates = [loc for score, loc in scored[:5] if score > 0]

    if not candidates:
        return {"found": False, "node_id": None, "name": None}

    # Build candidate list for LLM — include description for better matching
    cands_text = "\n".join([
        f"- node_id: {loc['node_id']} | name: {loc['name']} | description: {str(loc.get('description', ''))[:80]}"
        for loc in candidates
    ])

    lang_instruction = {
        "te": "Respond in Telugu",
        "hi": "Respond in Hindi",
        "en": "Respond in English"
    }.get(language, "Respond in English")

    prompt = f"""The user said: "{user_input}"

Most likely destination candidates (ranked by similarity):
{cands_text}

Which location does the user want to go to?
Return ONLY valid JSON (no markdown, no explanation):
{{
  "found": true or false,
  "node_id": "exact node_id from candidates or null",
  "name": "exact name from candidates or null"
}}"""

    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0.1,
        )
        raw = resp.choices[0].message.content.strip()
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        result = json.loads(raw)

        # Validate node_id is from our actual list
        valid_ids = {loc["node_id"] for loc in all_locs}
        if result.get("found") and result.get("node_id") in valid_ids:
            return result

        return {"found": False, "node_id": None, "name": None}
    except Exception:
        # Last resort — return top similarity match if score is decent
        if top_score > 0.2:
            return {"found": True, "node_id": top_loc["node_id"], "name": top_loc["name"]}
        return {"found": False, "node_id": None, "name": None}