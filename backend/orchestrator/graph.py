"""
Inevi Orchestrator -- LangGraph Agentic MAS
=============================================
Coordinates IRIS, LOKI, SAGE, NOVA, and VEDA agents
to provide real-time indoor spatial navigation.

Flow:
    Camera frame -> IRIS -> LOKI -> SAGE + NOVA (parallel) -> VEDA -> User

This is the Agentic MAS orchestrator. It:
- Plans which agents to call
- Handles fallbacks when location is unknown
- Maintains session state
- Loops until destination reached
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


# -- Session State --------------------------------------------

class NavigationSession(TypedDict):
    session_id:       str
    current_node:     Optional[str]
    destination_node: Optional[str]
    language:         str
    status:           str   # idle / locating / navigating / arrived
    conversation:     list
    location_attempts: int


def create_nav_session(session_id: str = None, language: str = "en") -> NavigationSession:
    """Create a new navigation session."""
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
    )

    # Store in DynamoDB
    create_session(session_id, {
        "current_node":     "",
        "destination_node": "",
        "conversation":     [],
    })

    return session


def load_nav_session(session_id: str) -> Optional[NavigationSession]:
    """Load session from DynamoDB."""
    data = get_session(session_id)
    if not data:
        return None
    return NavigationSession(
        session_id=session_id,
        current_node=data.get("current_node") or None,
        destination_node=data.get("destination_node") or None,
        language=data.get("language", "en"),
        status=data.get("status", "idle"),
        conversation=data.get("conversation", []),
        location_attempts=int(data.get("location_attempts", 0)),
    )


def save_nav_session(session: NavigationSession):
    """Save session state to DynamoDB."""
    update_session(session["session_id"], {
        "current_node":      session["current_node"] or "",
        "destination_node":  session["destination_node"] or "",
        "language":          session["language"],
        "status":            session["status"],
        "location_attempts": str(session["location_attempts"]),
    })


# -- Core Orchestration Functions -----------------------------

def process_frame(
    session:    NavigationSession,
    image_b64:  str,
    image_mime: str = "image/jpeg",
) -> dict:
    """
    Process a live camera frame through IRIS -> LOKI pipeline.
    Returns updated session + VEDA response if location found.

    Called every 3 seconds from Traverse frontend.
    """
    language = session["language"]

    # Step 1 -- IRIS analyzes frame
    iris_result = analyze_frame(image_b64, image_mime)

    # Use BACKGROUND description for LOKI (ignores people)
    background_desc      = iris_result.get("background_description", "")
    scene_desc           = iris_result.get("scene_description", "")
    visible_signs        = iris_result.get("visible_signs", [])
    landmarks            = iris_result.get("landmarks", [])
    distinctive_features = iris_result.get("distinctive_features", "")

    # Step 2 -- LOKI matches location using background only
    loki_result = match_location(
        frame_description=background_desc,
        visible_signs=visible_signs,
        previous_node_id=session.get("current_node"),
        landmarks=landmarks,
        distinctive_features=distinctive_features,
    )

    response = None

    if loki_result["matched"]:
        new_node = loki_result["node_id"]
        session["location_attempts"] = 0

        # Location changed or first time
        if new_node != session.get("current_node"):
            session["current_node"] = new_node
            session["status"] = "locating"

            # Check if destination reached
            if session.get("destination_node") and check_destination_reached(new_node, session["destination_node"]):
                from backend.services.aurora import get_location
                dest_loc  = get_location(session["destination_node"])
                dest_name = dest_loc["name"] if dest_loc else session["destination_node"]
                response  = respond_destination_reached(dest_name, language)
                session["status"] = "arrived"
                session["destination_node"] = None

            # If navigating -- give next step
            elif session.get("destination_node"):
                step = get_next_step(new_node, session["destination_node"], language)
                response = step["instruction"]
                session["status"] = "navigating"

            # No destination -- announce location
            else:
                response = generate_arrival_message(new_node, language)
                session["status"] = "locating"

    else:
        session["location_attempts"] = session.get("location_attempts", 0) + 1

        # Only respond every 3 failed attempts to avoid spam
        if session["location_attempts"] % 3 == 1:
            response = respond_location_unknown(language)

    save_nav_session(session)

    return {
        "session":        session,
        "iris":           iris_result,
        "loki":           loki_result,
        "veda_response":  response,
        "has_response":   response is not None,
    }


def process_user_speech(
    session:     NavigationSession,
    user_speech: str,
) -> dict:
    """
    Process user speech through VEDA -> SAGE -> NOVA pipeline.
    Called when user speaks during Traverse.
    """
    language = session["language"]

    # Step 1 -- VEDA understands intent
    intent = understand_user_intent(
        user_speech=user_speech,
        current_node=session.get("current_node"),
        language=language,
    )

    response = None

    # Handle greeting
    if intent["intent"] == "greeting":
        response = respond_greeting(language)

    # Handle navigation request
    elif intent["intent"] == "navigation":
        destination_text = intent.get("destination", user_speech)

        if not session.get("current_node"):
            response = "I'm still figuring out where you are. Please wait a moment while I look around."
        else:
            # SAGE identifies destination node
            dest_result = identify_destination(
                user_input=destination_text,
                current_node=session["current_node"],
                language=language,
            )

            if dest_result.get("found") and dest_result.get("node_id"):
                dest_node = dest_result["node_id"]
                dest_name = dest_result["name"]
                session["destination_node"] = dest_node
                session["status"] = "navigating"

                # NOVA gives route summary + first step
                summary = get_route_summary(session["current_node"], dest_node, language)
                response = summary

            else:
                response = respond_destination_not_found(destination_text, language)

    # Handle question about current location
    elif intent["intent"] == "question":
        if session.get("current_node"):
            response = generate_location_facts(
                node_id=session["current_node"],
                question=intent.get("question", user_speech),
                language=language,
            )
        else:
            response = "I'm not sure where you are yet. Let me look around."

    # Handle confirmation
    elif intent["intent"] == "confirmation":
        if intent.get("confirmation") is False:
            session["destination_node"] = None
            session["status"] = "locating"
            response = generate_custom_response(
                "The user said no or cancelled. Acknowledge and ask what they need.",
                language,
            )
        else:
            response = generate_custom_response(
                "The user confirmed. Acknowledge positively.",
                language,
            )

    else:
        response = generate_custom_response(
            f"The user said: '{user_speech}'. Respond helpfully as a spatial guide.",
            language,
        )

    # Log to conversation
    append_to_conversation(session["session_id"], {
        "role":    "user",
        "content": user_speech,
    })
    append_to_conversation(session["session_id"], {
        "role":    "veda",
        "content": response or "",
    })

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
    Returns session + initial greeting from VEDA.
    """
    session  = create_nav_session(session_id, language)
    greeting = respond_greeting(language)

    append_to_conversation(session["session_id"], {
        "role":    "veda",
        "content": greeting,
    })

    return {
        "session_id":    session["session_id"],
        "veda_response": greeting,
        "session":       session,
    }