"""
Inevi Orchestrator — Final Clean Version
=========================================
Key fixes:
- Keyword-first intent detection (no LLM for navigation intent)
- SAGE only searches nodes in same group as current location
- Faster, more reliable coordination
"""

import os
import re
import uuid
from typing import TypedDict, Optional
from dotenv import load_dotenv

from backend.agents.iris  import analyze_frame
from backend.agents.loki  import match_location
from backend.agents.sage  import generate_arrival_message, identify_destination, generate_location_facts
from backend.agents.nova  import get_next_step, get_route_summary, check_destination_reached
from backend.agents.veda  import (
    respond_location_unknown,
    respond_destination_not_found,
    respond_destination_reached,
    respond_greeting,
    generate_custom_response,
)
from backend.services.dynamo import (
    create_session,
    get_session,
    update_session,
    append_to_conversation,
)

load_dotenv()

# ── In-memory session cache ──────────────────────────────
_session_cache: dict[str, dict] = {}

# ── Navigation keywords for fast intent detection ────────
_NAV_KEYWORDS = [
    "go to", "take me to", "i want to go", "i would like to go",
    "navigate to", "how do i get to", "where is", "find", "show me",
    "i need to go", "can you take me", "direct me", "lead me",
    "want to go", "would go", "going to", "head to",
]

# ── Session State ────────────────────────────────────────
class NavigationSession(TypedDict):
    session_id:        str
    current_node:      Optional[str]
    destination_node:  Optional[str]
    language:          str
    status:            str
    conversation:      list
    location_attempts: int
    nav_frame_count:   int


def create_nav_session(session_id: str = None, language: str = "en") -> "NavigationSession":
    if not session_id:
        session_id = str(uuid.uuid4())

    session = NavigationSession(
        session_id=session_id,
        current_node=None,
        destination_node=None,
        language=language,
        status="idle",
        conversation=[],
        location_attempts=0,
        nav_frame_count=0,
    )
    create_session(session_id, {
        "current_node": "", "destination_node": "",
        "language": language, "status": "idle", "conversation": [],
    })
    _session_cache[session_id] = dict(session)
    return session


def load_nav_session(session_id: str) -> Optional["NavigationSession"]:
    if session_id in _session_cache:
        return NavigationSession(**_session_cache[session_id])
    data = get_session(session_id)
    if not data:
        return None
    session = NavigationSession(
        session_id=session_id,
        current_node=data.get("current_node") or None,
        destination_node=data.get("destination_node") or None,
        language=data.get("language", "en"),
        status=data.get("status", "idle"),
        conversation=data.get("conversation", []),
        location_attempts=int(data.get("location_attempts", 0)),
        nav_frame_count=int(data.get("nav_frame_count", 0)),
    )
    _session_cache[session_id] = dict(session)
    return session


def save_nav_session(session: "NavigationSession"):
    _session_cache[session["session_id"]] = dict(session)
    update_session(session["session_id"], {
        "current_node":      session["current_node"] or "",
        "destination_node":  session["destination_node"] or "",
        "language":          session["language"],
        "status":            session["status"],
        "location_attempts": str(session["location_attempts"]),
        "nav_frame_count":   str(session["nav_frame_count"]),
    })


def _simple_arrival(location_name: str, language: str) -> str:
    msgs = {
        "en": f"You are at {location_name}. Where would you like to go?",
        "te": f"మీరు {location_name} లో ఉన్నారు. మీరు ఎక్కడికి వెళ్ళాలనుకుంటున్నారు?",
        "hi": f"आप {location_name} पर हैं। आप कहाँ जाना चाहते हैं?",
    }
    return msgs.get(language, msgs["en"])


def _is_navigation_intent(text: str) -> bool:
    """Fast keyword check — no LLM needed for obvious navigation phrases."""
    t = text.lower()
    return any(kw in t for kw in _NAV_KEYWORDS)


def _is_echo(text: str) -> bool:
    t = text.lower().strip()
    if len(t) < 4:
        return True
    echo_phrases = [
        "where would you like to go", "where do you want to go",
        "i'm looking at your surroundings", "please move your camera",
        "i can see you but", "could you show me something",
        "would like like", "hold the camera steady",
    ]
    return any(phrase in t for phrase in echo_phrases)


def _get_node_group(node_id: str) -> str:
    """Get the prefix group of a node. e.g. 'home_hall' -> 'home'"""
    if "_" in node_id:
        return node_id.split("_")[0]
    return node_id


# ── Frame Processing ─────────────────────────────────────
def process_frame(
    session:    "NavigationSession",
    image_b64:  str,
    image_mime: str = "image/jpeg",
) -> dict:
    language = session["language"]
    response = None

    # IRIS analyzes frame
    iris_result = analyze_frame(image_b64, image_mime)
    background_desc      = iris_result.get("background_description", "")
    visible_signs        = iris_result.get("visible_signs", [])
    landmarks            = iris_result.get("landmarks", [])
    distinctive_features = iris_result.get("distinctive_features", "")

    # LOKI matches location
    loki_result = match_location(
        frame_description=background_desc,
        visible_signs=visible_signs,
        previous_node_id=session.get("current_node"),
        landmarks=landmarks,
        distinctive_features=distinctive_features,
    )

    if loki_result["matched"]:
        new_node = loki_result["node_id"]
        session["location_attempts"] = 0
        location_changed = new_node != session.get("current_node")

        if location_changed:
            session["current_node"]    = new_node
            session["nav_frame_count"] = 0

            # Arrived at destination
            if session.get("destination_node") and check_destination_reached(new_node, session["destination_node"]):
                from backend.services.aurora import get_location
                dest_loc  = get_location(session["destination_node"])
                dest_name = dest_loc["name"] if dest_loc else session["destination_node"]
                response  = respond_destination_reached(dest_name, language)
                session["status"]           = "arrived"
                session["destination_node"] = None

            # Navigating — give next step
            elif session.get("destination_node"):
                step     = get_next_step(new_node, session["destination_node"], language)
                response = step["instruction"]
                session["status"] = "navigating"

            # New location found — announce and ask
            else:
                location_name = loki_result.get("name") or new_node.replace("_", " ").title()
                try:
                    sage_response = generate_arrival_message(new_node, language)
                    if sage_response and "could not identify" not in sage_response.lower():
                        response = sage_response
                    else:
                        response = _simple_arrival(location_name, language)
                except Exception:
                    response = _simple_arrival(location_name, language)
                session["status"] = "locating"

        else:
            # Same location — remind navigation every 4 frames
            session["nav_frame_count"] = session.get("nav_frame_count", 0) + 1
            if session.get("destination_node") and session["nav_frame_count"] % 4 == 0:
                step     = get_next_step(new_node, session["destination_node"], language)
                response = step["instruction"]
    else:
        session["location_attempts"] = session.get("location_attempts", 0) + 1
        if session["location_attempts"] % 4 == 1:
            response = respond_location_unknown(language)

    save_nav_session(session)
    return {
        "session":       session,
        "iris":          iris_result,
        "loki":          loki_result,
        "veda_response": response,
        "has_response":  response is not None,
    }


# ── Speech Processing ────────────────────────────────────
def process_user_speech(
    session:     "NavigationSession",
    user_speech: str,
) -> dict:
    language = session["language"]
    response = None

    # Echo guard
    if _is_echo(user_speech):
        return {"session": session, "intent": {"intent": "echo_ignored"}, "veda_response": None}

    text_lower = user_speech.lower().strip()

    # ── Fast navigation intent detection — no LLM ──
    if _is_navigation_intent(text_lower):
        intent_type      = "navigation"
        destination_text = user_speech  # pass full speech to SAGE similarity search
    elif any(w in text_lower for w in ["hi", "hello", "hey", "namaste", "నమస్కారం"]):
        intent_type      = "greeting"
        destination_text = None
    else:
        # Only call LLM if not obvious
        from backend.agents.veda import understand_user_intent
        intent = understand_user_intent(user_speech, session.get("current_node"), language)
        intent_type      = intent.get("intent", "unknown")
        destination_text = intent.get("destination") or user_speech

    # ── Route based on intent ──
    if intent_type == "greeting":
        response = respond_greeting(language)

    elif intent_type == "navigation":
        if not session.get("current_node"):
            response = generate_custom_response(
                "User wants to navigate but location unknown. Ask them to show camera around.",
                language,
            )
        else:
            # Only search nodes in same group as current location
            # e.g. if at home_right_room → only search home_* nodes
            current_group = _get_node_group(session["current_node"])

            dest_result = identify_destination(
                user_input=destination_text,
                current_node=session["current_node"],
                language=language,
                node_group=current_group,  # ← filter by group
            )

            if dest_result.get("found") and dest_result.get("node_id"):
                dest_node = dest_result["node_id"]
                dest_name = dest_result["name"]

                if dest_node == session["current_node"]:
                    response = generate_custom_response(
                        f"User is already at {dest_name}. Tell them they're already there.",
                        language,
                    )
                else:
                    session["destination_node"] = dest_node
                    session["status"]           = "navigating"
                    response = get_route_summary(session["current_node"], dest_node, language)
            else:
                response = respond_destination_not_found(destination_text, language)

    elif intent_type == "question":
        if session.get("current_node"):
            response = generate_location_facts(
                node_id=session["current_node"],
                question=user_speech,
                language=language,
            )
        else:
            response = generate_custom_response(
                "User asked a question but location unknown. Tell them you're still scanning.",
                language,
            )

    elif intent_type == "confirmation":
        response = generate_custom_response(
            "User confirmed. Acknowledge and continue guiding.", language,
        )

    else:
        from backend.services.aurora import get_location as _get_loc
        cur_name = "unknown"
        try:
            if session.get("current_node"):
                loc = _get_loc(session["current_node"])
                cur_name = loc["name"] if loc else session["current_node"]
        except Exception:
            pass
        response = generate_custom_response(
            f"User said: '{user_speech}'. At: {cur_name}. Help them navigate. 1-2 sentences.",
            language,
        )

    append_to_conversation(session["session_id"], {"role": "user",  "content": user_speech})
    append_to_conversation(session["session_id"], {"role": "veda",  "content": response or ""})
    save_nav_session(session)

    return {"session": session, "intent": {"intent": intent_type}, "veda_response": response}


def start_traverse_session(session_id: str = None, language: str = "en") -> dict:
    session  = create_nav_session(session_id, language)
    greeting = respond_greeting(language)
    append_to_conversation(session["session_id"], {"role": "veda", "content": greeting})
    return {
        "session_id":    session["session_id"],
        "veda_response": greeting,
        "session":       session,
    }