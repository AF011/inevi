"""
BUILDER Agent -- Inevi Map Studio
==================================
Conversational agent that helps build the spatial knowledge graph.

Architecture:
- Conversational turns handled by direct Groq LLM calls (no looping)
- Save operation uses tool call pattern
- LangGraph used for orchestration label (architecture diagram)
"""

import os
import json
import uuid
from dotenv import load_dotenv
from groq import Groq

from backend.services.vision import analyze_image, check_image_quality
from backend.services.aurora import (
    get_all_locations,
    get_connections,
    insert_location,
    insert_location_image,
    insert_connection,
)

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL  = "llama-3.3-70b-versatile"

# -- System Prompt --------------------------------------------
BUILDER_SYSTEM_PROMPT = """You are the BUILDER agent for Inevi -- an AI-powered indoor spatial navigation system.

Your job: Help the user build a spatial knowledge graph node for a campus or museum location.

You have access to existing nodes (provided in context). Ask questions ONE AT A TIME in this order:
1. Confirm/correct the location name
2. Ask what is visible in the NORTH direction (or straight ahead)
3. Ask what is visible in the SOUTH direction (or behind)
4. Ask what is visible in the EAST direction (or left)
5. Ask what is visible in the WEST direction (or right)
6. Ask for any interesting facts about this location
7. Ask if this is the main entrance / starting point (yes/no)
8. Summarize everything collected and ask "Shall I save this node?"
9. When user confirms -- respond with EXACTLY this JSON and nothing else:
   SAVE_NODE:{"node_id":"snake_case_id","name":"Location Name","description":"full description","visual_keywords":"comma,separated,keywords","signs_visible":"any signs","facts":"interesting facts","is_start":false,"connections":[{"to_node":"node_id","direction":"north","instruction":"walk straight","distance_meters":100}]}

RULES:
- Ask ONE question at a time
- Keep responses short and clear
- Be friendly and conversational
- When you output SAVE_NODE JSON, output NOTHING else before or after it
- Generate node_id as lowercase with underscores from the location name"""


def _get_existing_nodes_context() -> str:
    """Get existing nodes as context string."""
    locations = get_all_locations()
    if not locations:
        return "No existing nodes yet. This will be the first location."

    lines = ["Existing nodes in the knowledge graph:"]
    for loc in locations:
        conns = get_connections(loc["node_id"])
        conn_str = ", ".join([f"{c['direction']}→{c['to_node']}" for c in conns]) or "no connections"
        lines.append(f"- {loc['node_id']}: {loc['name']} ({conn_str})")
    return "\n".join(lines)


def _call_llm(messages: list) -> str:
    """Single LLM call -- no looping."""
    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=800,
        temperature=0.3,
    )
    return resp.choices[0].message.content.strip()


def _save_node(node_data: dict, image_path: str) -> str:
    """Save node to Aurora DSQL."""
    try:
        insert_location({
            "node_id":         node_data["node_id"],
            "name":            node_data["name"],
            "description":     node_data.get("description", ""),
            "visual_keywords": node_data.get("visual_keywords", ""),
            "signs_visible":   node_data.get("signs_visible", ""),
            "facts":           node_data.get("facts", ""),
            "is_start":        node_data.get("is_start", False),
        })

        insert_location_image(
            node_id=node_data["node_id"],
            image_path=image_path,
            ai_description=node_data.get("description", ""),
            angle="primary",
        )

        for c in node_data.get("connections", []):
            insert_connection({
                "from_node":       node_data["node_id"],
                "to_node":         c.get("to_node", ""),
                "direction":       c.get("direction", ""),
                "instruction":     c.get("instruction", ""),
                "distance_meters": c.get("distance_meters", 0),
            })

        return f"Node '{node_data['name']}' saved successfully to the knowledge graph."

    except Exception as e:
        return f"Failed to save node: {str(e)}"


# -- Public API -----------------------------------------------

def start_builder_session(
    image_b64:     str,
    image_mime:    str,
    image_path:    str,
    location_name: str,
    session_id:    str = None,
) -> dict:
    """Start a new builder session."""
    if not session_id:
        session_id = str(uuid.uuid4())

    # Step 1 -- analyze image
    quality = check_image_quality(image_b64, image_mime)

    if not quality.get("is_clear", True):
        return {
            "session_id":  session_id,
            "response":    f"The image is not clear enough. {quality.get('rejection_reason', '')}. Please upload a clearer image.",
            "messages":    [],
            "is_complete": False,
            "image_path":  image_path,
        }

    description = analyze_image(image_b64, image_mime)
    nodes_ctx   = _get_existing_nodes_context()

    # Step 2 -- build initial messages
    system_with_context = f"{BUILDER_SYSTEM_PROMPT}\n\n{nodes_ctx}"

    user_content = f"""New location to add:
Name: {location_name}
Image path: {image_path}
Vision analysis: {description}
Visible signs: {quality.get('visible_text', 'none')}
Location type: {quality.get('location_type', 'unknown')}

Please start the guided process to build this node."""

    messages = [
        {"role": "system",    "content": system_with_context},
        {"role": "user",      "content": user_content},
    ]

    # Step 3 -- single LLM call
    response = _call_llm(messages)

    messages.append({"role": "assistant", "content": response})

    return {
        "session_id":  session_id,
        "response":    response,
        "messages":    messages,
        "is_complete": False,
        "image_path":  image_path,
    }


def continue_builder_session(
    session_id:   str,
    user_message: str,
    messages:     list,
    image_b64:    str = "",
    image_mime:   str = "image/jpeg",
    image_path:   str = "",
) -> dict:
    """Continue builder session with user message."""

    # Add user message
    messages_with_user = list(messages) + [{"role": "user", "content": user_message}]

    # Single LLM call
    response = _call_llm(messages_with_user)

    # Check if agent wants to save
    is_complete = False
    if response.startswith("SAVE_NODE:"):
        try:
            json_str  = response[len("SAVE_NODE:"):].strip()
            node_data = json.loads(json_str)
            save_result = _save_node(node_data, image_path)
            response    = save_result
            is_complete = True
        except Exception as e:
            response = f"I tried to save the node but encountered an error: {str(e)}. Please try again."

    messages_with_user.append({"role": "assistant", "content": response})

    return {
        "session_id":  session_id,
        "response":    response,
        "messages":    messages_with_user,
        "is_complete": is_complete,
        "image_path":  image_path,
    }