"""
Inevi Orchestrator
==================
Coordinates IRIS, LOKI, SAGE, NOVA, and VEDA agents
to provide real-time indoor spatial navigation.

Flow:
    Camera frame -> IRIS -> LOKI -> SAGE + NOVA -> VEDA -> User

Key fixes:
- In-memory session cache (no read-lag between frame + speech pipelines)
- Proper state machine: idle -> locating -> navigating -> arrived
- VEDA speaks when location first found, on each location change,
  and periodically while navigating
- Language passed consistently to every agent
"""

import os
import json
import uuid
from typing import TypedDict, Optional
from dotenv import load_dotenv

from backend.agents.iris  import analyze_frame, encode_image
from backend.agents.loki  import match_location
from backend.agents.sage  import generate_arrival_message, identify_destination, generate_location_facts
from backend.agents.nova  import get_next_step, get_route_summary, check_destination_reached
from backend.agents.veda  import (
    understand_user_intent,
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
# Keeps session state immediately available between frame + speech
# calls without waiting for DynamoDB reads.
_session_cache: dict[str, dict] = {}


# ── Session State ────────────────────────────────────────

class NavigationSession(TypedDict):
    session_id:        str
    current_node:      Optional[str]
    destination_node:  Optional[str]
    language:          str
    status:            str   # idle / locating / navigating / arrived
    conversation:      list
    location_attempts: int
    nav_frame_count:   int   # how many frames since last nav instruction


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

    # Persist to DynamoDB
    create_session(session_id, {
        "current_node":     "",
        "destination_node": "",
        "language":         language,
        "status":           "idle",
        "conversation":     [],
    })

    # Store in memory cache
    _session_cache[session_id] = dict(session)

    return session


def load_nav_session(session_id: str) -> Optional["NavigationSession"]:
    """Load session — check memory cache first, fall back to DynamoDB."""
    # Memory cache hit (fast path)
    if session_id in _session_cache:
        return NavigationSession(**_session_cache[session_id])

    # DynamoDB fallback
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

    # Populate cache
    _session_cache[session_id] = dict(session)
    return session


def save_nav_session(session: "NavigationSession"):
    """Save to memory cache immediately, then DynamoDB."""
    _session_cache[session["session_id"]] = dict(session)

    update_session(session["session_id"], {
        "current_node":      session["current_node"] or "",
        "destination_node":  session["destination_node"] or "",
        "language":          session["language"],
        "status":            session["status"],
        "location_attempts": str(session["location_attempts"]),
        "nav_frame_count":   str(session["nav_frame_count"]),
    })


# ── Core Orchestration ───────────────────────────────────


def _simple_arrival(location_name: str, language: str) -> str:
    """Guaranteed fallback arrival message using only LOKI matched name."""
    msgs = {
        "en": f"You are at {location_name}. Where would you like to go?",
        "te": f"మీరు {location_name} లో ఉన్నారు. మీరు ఎక్కడికి వెళ్ళాలనుకుంటున్నారు?",
        "hi": f"आप {location_name} पर हैं। आप कहाँ जाना चाहते हैं?",
    }
    return msgs.get(language, msgs["en"])


def process_frame(
    session:    "NavigationSession",
    image_b64:  str,
    image_mime: str = "image/jpeg",
) -> dict:
    """
    Process a live camera frame through IRIS -> LOKI pipeline.
    Returns updated session + VEDA response when something meaningful happens.

    State machine:
      idle      -> locating  : first location match found
      locating  -> navigating: destination set by user speech
      navigating-> navigating: location changed, give next step
      navigating-> arrived   : current_node == destination_node
    """
    language = session["language"]
    response = None

    # Step 1 — IRIS analyzes frame
    iris_result = analyze_frame(image_b64, image_mime)

    background_desc      = iris_result.get("background_description", "")
    scene_desc           = iris_result.get("scene_description", "")
    visible_signs        = iris_result.get("visible_signs", [])
    landmarks            = iris_result.get("landmarks", [])
    distinctive_features = iris_result.get("distinctive_features", "")

    # Step 2 — LOKI matches location
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
            session["current_node"]   = new_node
            session["nav_frame_count"] = 0

            # ── Arrived at destination ──
            if (
                session.get("destination_node")
                and check_destination_reached(new_node, session["destination_node"])
            ):
                from backend.services.aurora import get_location
                dest_loc  = get_location(session["destination_node"])
                dest_name = dest_loc["name"] if dest_loc else session["destination_node"]
                response  = respond_destination_reached(dest_name, language)
                session["status"]           = "arrived"
                session["destination_node"] = None

            # ── Navigating — give next step ──
            elif session.get("destination_node"):
                step     = get_next_step(new_node, session["destination_node"], language)
                response = step["instruction"]
                session["status"] = "navigating"

            # ── No destination — announce location and ask ──
            else:
                # Use LOKI name directly — avoids extra Aurora call
                # Try SAGE for richer message, fall back to simple template
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
            # Same location — if navigating, remind every 4 frames
            session["nav_frame_count"] = session.get("nav_frame_count", 0) + 1

            if (
                session.get("destination_node")
                and session["nav_frame_count"] % 4 == 0
            ):
                step     = get_next_step(new_node, session["destination_node"], language)
                response = step["instruction"]

    else:
        # No match
        session["location_attempts"] = session.get("location_attempts", 0) + 1

        # Speak every 4th failed attempt — don't spam
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


# Phrases VEDA says that the mic might echo back — ignore these
_VEDA_ECHO_PHRASES = [
    "where would you like to go",
    "where do you want to go",
    "i'm looking at your surroundings",
    "please move your camera",
    "i can see you but",
    "could you show me something",
    "would you like to go",
    "would like like",
    "i'm still figuring out",
    "i am still figuring",
    "hold the camera steady",
]


def _is_echo(text: str) -> bool:
    """Return True if this looks like VEDA's own voice echoed back."""
    t = text.lower().strip()
    # Very short — probably noise
    if len(t) < 4:
        return True
    # Matches a known VEDA phrase
    if any(phrase in t for phrase in _VEDA_ECHO_PHRASES):
        return True
    return False


def process_user_speech(
    session:     "NavigationSession",
    user_speech: str,
) -> dict:
    """
    Process user speech through VEDA -> SAGE -> NOVA pipeline.

    Intent routing:
      greeting    -> VEDA greets back
      navigation  -> SAGE identifies destination, NOVA plans route
      question    -> SAGE answers from location facts
      confirmation-> acknowledge / cancel
      unknown     -> VEDA handles generically
    """
    language = session["language"]
    response = None

    # Echo guard — ignore if mic picked up VEDA's own voice
    if _is_echo(user_speech):
        return {
            "session":       session,
            "intent":        {"intent": "echo_ignored"},
            "veda_response": None,
        }

    # Step 1 — VEDA understands intent
    intent = understand_user_intent(
        user_speech=user_speech,
        current_node=session.get("current_node"),
        language=language,
    )

    intent_type = intent.get("intent", "unknown")

    # ── Greeting ──
    if intent_type == "greeting":
        response = respond_greeting(language)

    # ── Navigation request ──
    elif intent_type == "navigation":
        destination_text = intent.get("destination") or user_speech

        if not session.get("current_node"):
            # We don't know where user is yet
            response = generate_custom_response(
                "The user wants to navigate but we haven't located them yet. "
                "Ask them to hold the camera steady so you can figure out where they are.",
                language,
            )
        else:
            # SAGE identifies which node the user means
            dest_result = identify_destination(
                user_input=destination_text,
                current_node=session["current_node"],
                language=language,
            )

            if dest_result.get("found") and dest_result.get("node_id"):
                dest_node = dest_result["node_id"]
                dest_name = dest_result["name"]

                # Don't navigate to current location
                if dest_node == session["current_node"]:
                    response = generate_custom_response(
                        f"The user wants to go to {dest_name} but they are already there. "
                        "Tell them they are already at this location.",
                        language,
                    )
                else:
                    session["destination_node"] = dest_node
                    session["status"]           = "navigating"

                    # NOVA gives route overview + first step
                    response = get_route_summary(
                        session["current_node"],
                        dest_node,
                        language,
                    )
            else:
                response = respond_destination_not_found(destination_text, language)

    # ── Question about current location ──
    elif intent_type == "question":
        if session.get("current_node"):
            response = generate_location_facts(
                node_id=session["current_node"],
                question=intent.get("question") or user_speech,
                language=language,
            )
        else:
            response = generate_custom_response(
                "The user asked a question but we don't know their location yet. "
                "Tell them you're still scanning to find where they are.",
                language,
            )

    # ── Confirmation / cancellation ──
    elif intent_type == "confirmation":
        if intent.get("confirmation") is False:
            # User said no / cancel
            session["destination_node"] = None
            session["status"]           = "locating"
            response = generate_custom_response(
                "The user cancelled navigation. Acknowledge and ask what they need.",
                language,
            )
        else:
            response = generate_custom_response(
                "The user confirmed. Acknowledge positively and tell them you'll guide them.",
                language,
            )

    # ── Unknown / general ──
    else:
        # Resolve node IDs to human names for VEDA context
        from backend.services.aurora import get_location as _get_loc
        cur_name  = "unknown"
        dest_name = "none"
        try:
            if session.get("current_node"):
                loc = _get_loc(session["current_node"])
                cur_name = loc["name"] if loc else session["current_node"]
        except Exception:
            cur_name = session.get("current_node") or "unknown"
        try:
            if session.get("destination_node"):
                loc = _get_loc(session["destination_node"])
                dest_name = loc["name"] if loc else session["destination_node"]
        except Exception:
            dest_name = session.get("destination_node") or "none"

        response = generate_custom_response(
            f"The user said: '{user_speech}'. "
            f"Current location: {cur_name}. "
            f"Destination: {dest_name}. "
            "Respond helpfully as a spatial navigation guide. Keep it to 1-2 sentences.",
            language,
        )

    # Log conversation
    append_to_conversation(session["session_id"], {"role": "user",  "content": user_speech})
    append_to_conversation(session["session_id"], {"role": "veda",  "content": response or ""})

    save_nav_session(session)

    return {
        "session":       session,
        "intent":        intent,
        "veda_response": response,
    }


def start_traverse_session(
    session_id: str = None,
    language:   str = "en",
) -> dict:
    """
    Initialize a Traverse navigation session.
    Returns session + VEDA's opening greeting.
    """
    session  = create_nav_session(session_id, language)
    greeting = respond_greeting(language)

    append_to_conversation(session["session_id"], {"role": "veda", "content": greeting})

    return {
        "session_id":    session["session_id"],
        "veda_response": greeting,
        "session":       session,
    }