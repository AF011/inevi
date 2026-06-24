"""
LOKI Agent -- Location Matching
=================================
LOKI takes a live camera frame description from IRIS and matches it
to the closest known location in the Aurora knowledge graph.

Matching strategy (4 signals combined):
1. Visual description similarity -- LLM compares descriptions
2. Sign/text detection -- strongest signal, exact match
3. Path filtering -- only check nodes connected to previous location
4. Confidence threshold -- ask user if below 0.6
"""

import os
import json
from groq import Groq
from dotenv import load_dotenv

from backend.services.aurora import get_all_locations, get_location, get_connections, get_location_images

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL  = "llama-3.3-70b-versatile"


def _get_candidate_nodes(previous_node_id: str = None) -> list:
    """
    Get candidate nodes to match against.
    If previous_node_id known -- only return connected nodes (path filtering).
    Otherwise return all nodes.
    """
    if previous_node_id:
        conns = get_connections(previous_node_id)
        candidate_ids = [c["to_node"] for c in conns] + [previous_node_id]
        candidates = []
        for nid in candidate_ids:
            loc = get_location(nid)
            if loc:
                candidates.append(dict(loc))
        if candidates:
            return candidates

    # Fallback -- return all locations
    return [dict(loc) for loc in get_all_locations()]


def _check_sign_match(visible_signs: list, candidates: list) -> dict | None:
    """
    Check if any visible sign exactly matches a node's signs_visible.
    This is the strongest matching signal.
    """
    if not visible_signs:
        return None

    signs_lower = [s.lower().strip() for s in visible_signs]

    for node in candidates:
        node_signs = (node.get("signs_visible") or "").lower()
        keywords   = (node.get("visual_keywords") or "").lower()

        for sign in signs_lower:
            if sign and len(sign) > 2:
                if sign in node_signs or sign in keywords:
                    return {
                        "node_id":    node["node_id"],
                        "name":       node["name"],
                        "confidence": 0.95,
                        "reason":     f"Sign match: '{sign}' found in node signs",
                    }
    return None


def _llm_match(frame_description: str, visible_signs: list, candidates: list, landmarks: list = None, distinctive_features: str = "") -> dict:
    """
    Use LLM to match the frame description against candidate nodes.
    Returns the best matching node with confidence score.
    """
    if not candidates:
        return {"node_id": None, "confidence": 0.0, "reason": "No candidate nodes"}

    # Build candidate descriptions
    candidates_text = ""
    for i, node in enumerate(candidates):
        candidates_text += f"""
Node {i+1}:
  ID: {node['node_id']}
  Name: {node['name']}
  Description: {node.get('description', '')}
  Visual Keywords: {node.get('visual_keywords', '')}
  Signs: {node.get('signs_visible', '')}
"""

    signs_text     = ", ".join(visible_signs) if visible_signs else "none visible"
    landmarks_text = ", ".join(landmarks) if landmarks else "none identified"

    prompt = f"""You are LOKI, a location matching AI for an indoor navigation system.

A live camera frame background shows (person/people excluded):
BACKGROUND DESCRIPTION: {frame_description}
VISIBLE TEXT/SIGNS: {signs_text}
DISTINCTIVE LANDMARKS: {landmarks_text}
DISTINCTIVE FEATURE: {distinctive_features}

Match this against these known locations:
{candidates_text}

Return ONLY valid JSON:
{{
  "matched_node_id": "node_id or null if no match",
  "matched_node_name": "name or null",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation of why this matched or why no match"
}}

Rules:
- confidence >= 0.75 means strong match
- confidence 0.5-0.74 means possible match
- confidence < 0.5 means no reliable match, return null
- Match based on visual similarities, distinctive features, and signs
- If signs visible match exactly -- confidence should be 0.9+"""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.1,
    )

    raw = resp.choices[0].message.content.strip()

    import re
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()

    try:
        result = json.loads(raw)
        return {
            "node_id":    result.get("matched_node_id"),
            "name":       result.get("matched_node_name"),
            "confidence": float(result.get("confidence", 0.0)),
            "reason":     result.get("reason", ""),
        }
    except Exception:
        return {"node_id": None, "confidence": 0.0, "reason": "Parse error"}


def match_location(
    frame_description: str,
    visible_signs:     list = None,
    previous_node_id:  str  = None,
    confidence_threshold: float = 0.6,
    landmarks: list = None,
    distinctive_features: str = "",
) -> dict:
    """
    Main LOKI function. Match a camera frame to a known location.
    Uses BACKGROUND description only -- ignores people in frame.

    Args:
        frame_description: Background description from IRIS (no people)
        visible_signs:     List of readable text/signs detected in background
        previous_node_id:  Last known location (for path filtering)
        confidence_threshold: Minimum confidence to return a match
        landmarks:         Distinctive background elements from IRIS
        distinctive_features: Most unique background feature

    Returns:
        {
            "matched": True/False,
            "node_id": str or None,
            "name": str or None,
            "confidence": float,
            "reason": str,
            "node_data": dict or None,
            "connections": list,
        }
    """
    if visible_signs is None:
        visible_signs = []

    # Step 1 -- get candidate nodes
    candidates = _get_candidate_nodes(previous_node_id)

    if not candidates:
        return {
            "matched":     False,
            "node_id":     None,
            "name":        None,
            "confidence":  0.0,
            "reason":      "No locations in knowledge graph",
            "node_data":   None,
            "connections": [],
        }

    # Step 2 -- check sign match first (strongest signal)
    sign_match = _check_sign_match(visible_signs, candidates)

    if sign_match and sign_match["confidence"] >= confidence_threshold:
        node_data   = dict(get_location(sign_match["node_id"]) or {})
        connections = [dict(c) for c in get_connections(sign_match["node_id"])]
        return {
            "matched":     True,
            "node_id":     sign_match["node_id"],
            "name":        sign_match["name"],
            "confidence":  sign_match["confidence"],
            "reason":      sign_match["reason"],
            "node_data":   node_data,
            "connections": connections,
        }

    # Step 3 -- LLM visual matching
    llm_result = _llm_match(frame_description, visible_signs, candidates, landmarks or [], distinctive_features or "")

    if llm_result["node_id"] and llm_result["confidence"] >= confidence_threshold:
        node_data   = dict(get_location(llm_result["node_id"]) or {})
        connections = [dict(c) for c in get_connections(llm_result["node_id"])]
        return {
            "matched":     True,
            "node_id":     llm_result["node_id"],
            "name":        llm_result["name"],
            "confidence":  llm_result["confidence"],
            "reason":      llm_result["reason"],
            "node_data":   node_data,
            "connections": connections,
        }

    # Step 4 -- No reliable match
    return {
        "matched":     False,
        "node_id":     None,
        "name":        None,
        "confidence":  llm_result["confidence"],
        "reason":      llm_result["reason"],
        "node_data":   None,
        "connections": [],
    }


def get_location_info(node_id: str) -> dict:
    """Get full location info including connections and images."""
    loc  = get_location(node_id)
    if not loc:
        return {}
    conns  = [dict(c) for c in get_connections(node_id)]
    images = [dict(i) for i in get_location_images(node_id)]
    return {
        **dict(loc),
        "connections": conns,
        "images":      images,
    }