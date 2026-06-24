"""
BUILDER Agent  Inevi Map Studio
==================================
LangGraph-powered agent that helps build the spatial knowledge graph
for Inevi. It analyzes campus/museum images, asks smart questions,
suggests connections to existing nodes, and saves everything to Aurora DSQL.

Tool Calls:
    1. analyze_image        Groq Vision analyzes uploaded image
    2. check_existing_nodes  Queries Aurora for existing locations
    3. suggest_connections   Suggests which nodes to connect based on context
    4. save_node             Saves the complete node to Aurora DSQL
"""

import os
import json
import uuid
from typing import TypedDict, Annotated
from dotenv import load_dotenv

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage

from backend.services.vision import analyze_image, check_image_quality
from backend.services.aurora import (
    get_all_locations,
    get_connections,
    insert_location,
    insert_location_image,
    insert_connection,
)

load_dotenv()

#  LLM 
llm = ChatGroq(
    api_key=os.getenv("GROQ_API_KEY"),
    model="llama-3.3-70b-versatile",
    temperature=0.3,
)

#  Agent State 
class BuilderState(TypedDict):
    messages:       list
    image_b64:      str
    image_mime:     str
    image_path:     str
    node_id:        str
    location_name:  str
    session_id:     str
    step:           str
    node_data:      dict
    existing_nodes: list
    is_complete:    bool
    error:          str


#  Tool 1: analyze_image 
@tool
def tool_analyze_image(description: str) -> str:
    """
    Returns the pre-analyzed image description.
    Image analysis was already performed before the agent started.
    
    Args:
        description: The vision analysis already performed on the image
    """
    return json.dumps({
        "status": "accepted",
        "description": description,
    })


#  Tool 2: check_existing_nodes 
@tool
def tool_check_existing_nodes() -> str:
    """
    Retrieves all existing location nodes from Aurora DSQL.
    Returns a list of node IDs, names, and their current connections.
    Used to suggest which nodes should be connected to the new location.
    """
    locations = get_all_locations()
    if not locations:
        return json.dumps({
            "count": 0,
            "nodes": [],
            "message": "No existing nodes. This will be the first location in the graph.",
        })

    nodes = []
    for loc in locations:
        conns = get_connections(loc["node_id"])
        nodes.append({
            "node_id":     loc["node_id"],
            "name":        loc["name"],
            "description": loc["description"][:100] if loc["description"] else "",
            "is_start":    loc["is_start"],
            "connections": [
                {
                    "direction":  c["direction"],
                    "to_node":    c["to_node"],
                    "instruction": c["instruction"],
                }
                for c in conns
            ],
        })

    return json.dumps({
        "count": len(nodes),
        "nodes": nodes,
    })


#  Tool 3: suggest_connections 
@tool
def tool_suggest_connections(
    new_location_name: str,
    new_location_description: str,
    user_provided_directions: str,
) -> str:
    """
    Suggests which existing nodes should be connected to the new location.
    Takes the new location details and user-provided direction hints,
    cross-references with existing nodes, and returns suggested connections
    with directions and navigation instructions.

    Args:
        new_location_name: Name of the new location being added
        new_location_description: AI-generated description of the new location
        user_provided_directions: User's input about what is in each direction
                                  (e.g. "north leads to library, south is entrance")
    """
    existing_raw = tool_check_existing_nodes.invoke({})
    existing     = json.loads(existing_raw)

    suggestions = []
    directions_lower = user_provided_directions.lower()

    for node in existing.get("nodes", []):
        name_lower = node["name"].lower()
        node_id    = node["node_id"]

        # Check if user mentioned this node in their directions
        if any(word in directions_lower for word in name_lower.split()):
            # Figure out which direction
            direction = "unknown"
            for d in ["north", "south", "east", "west", "left", "right", "straight", "ahead"]:
                if d in directions_lower and name_lower.split()[0] in directions_lower:
                    direction = d
                    break

            suggestions.append({
                "node_id":    node_id,
                "name":       node["name"],
                "direction":  direction,
                "instruction": f"Head {direction} to reach {node['name']}",
                "confidence": "high",
            })

    return json.dumps({
        "suggestions":        suggestions,
        "total_existing":     existing.get("count", 0),
        "message": (
            f"Found {len(suggestions)} suggested connections based on your directions."
            if suggestions
            else "No automatic connections found. You can manually specify connections."
        ),
    })


#  Tool 4: save_node 
@tool
def tool_save_node(
    node_id:         str,
    name:            str,
    description:     str,
    visual_keywords: str,
    signs_visible:   str,
    facts:           str,
    is_start:        bool,
    image_b64:       str,
    image_path:      str,
    image_mime:      str,
    connections:     str,
) -> str:
    """
    Saves the complete location node to Aurora DSQL.
    Stores the location details, image with AI description,
    and all connections to neighboring nodes.

    Args:
        node_id:         Unique identifier (e.g. main_entrance, library)
        name:            Human readable name (e.g. Main Entrance Gate)
        description:     Rich AI-generated + human-enhanced description
        visual_keywords: Comma-separated visual features for matching
        signs_visible:   Any readable signs or text in the location
        facts:           Interesting facts about this location
        is_start:        Whether this is the starting point of navigation
        image_b64:       Base64 encoded image
        image_path:      Original file path of the image
        image_mime:      MIME type of the image
        connections:     JSON string of connections list
                         [{"to_node": "library", "direction": "north",
                           "instruction": "Walk straight 200m", "distance_meters": 200}]
    """
    try:
        # Save location node
        insert_location({
            "node_id":         node_id,
            "name":            name,
            "description":     description,
            "visual_keywords": visual_keywords,
            "signs_visible":   signs_visible,
            "facts":           facts,
            "is_start":        is_start,
        })

        # Save image with its AI description
        insert_location_image(
            node_id=node_id,
            image_path=image_path,
            ai_description=description,
            angle="primary",
        )

        # Save connections
        conn_list = json.loads(connections) if isinstance(connections, str) else connections
        saved_connections = []
        for c in conn_list:
            conn_id = insert_connection({
                "from_node":        node_id,
                "to_node":          c.get("to_node", ""),
                "direction":        c.get("direction", ""),
                "instruction":      c.get("instruction", ""),
                "distance_meters":  c.get("distance_meters", 0),
            })
            saved_connections.append(conn_id)

        return json.dumps({
            "status":             "success",
            "node_id":            node_id,
            "name":               name,
            "connections_saved":  len(saved_connections),
            "message":            f" '{name}' saved successfully to the knowledge graph!",
        })

    except Exception as e:
        return json.dumps({
            "status":  "error",
            "message": f"Failed to save node: {str(e)}",
        })


#  Tools list 
TOOLS = [
    tool_analyze_image,
    tool_check_existing_nodes,
    tool_suggest_connections,
    tool_save_node,
]

llm_with_tools = llm.bind_tools(TOOLS)

#  System Prompt 
BUILDER_SYSTEM_PROMPT = """You are the BUILDER agent for Inevi  an AI-powered indoor spatial navigation system.

Your job is to help build a spatial knowledge graph of a campus or museum by analyzing location images and asking smart questions.

## Your Workflow:
1. ANALYZE the uploaded image using tool_analyze_image
   - If image is unclear or rejected  tell the user kindly and stop
   - If image is good  proceed

2. CHECK existing nodes using tool_check_existing_nodes
   - Know what locations already exist
   - This helps suggest connections

3. ASK the user smart questions based on what you see:
   - Confirm/correct the location name
   - Ask what is in each direction (north/south/east/west OR left/right/straight)
   - Ask for any specific facts about this location
   - Ask if this is the starting point (main entrance)
   - Ask about approximate distances to neighboring locations

4. SUGGEST connections using tool_suggest_connections
   - Based on user's direction answers
   - Show suggestions and ask for confirmation

5. SAVE the node using tool_save_node
   - Only save when user has confirmed all details
   - Include all connections

## Personality:
- Be conversational and friendly, not robotic
- Ask ONE question at a time, not all at once
- Acknowledge what you see in the image
- Give specific observations: "I can see what looks like a large gate with palm trees..."
- If user says something is wrong, accept the correction gracefully

## Important Rules:
- NEVER save a node without user confirmation
- NEVER make up location names or connections
- If image quality is poor, reject it and explain why
- Always generate a clean node_id (lowercase, underscores, no spaces)
  Example: "Main Entrance Gate"  "main_entrance_gate"

## Language:
- Respond in English by default
- If user writes in Telugu or Hindi, respond in that language too
"""


#  Graph Nodes 

def agent_node(state: BuilderState) -> BuilderState:
    """Main agent reasoning node."""
    messages = [SystemMessage(content=BUILDER_SYSTEM_PROMPT)] + state["messages"]
    response = llm_with_tools.invoke(messages)
    return {**state, "messages": state["messages"] + [response]}


def tool_node_fn(state: BuilderState) -> BuilderState:
    """Execute tool calls."""
    tool_node = ToolNode(TOOLS)
    result    = tool_node.invoke(state)
    return {**state, "messages": result["messages"]}


def should_continue(state: BuilderState) -> str:
    """Decide whether to call tools or end."""
    last_msg = state["messages"][-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return END


#  Build LangGraph 

def build_graph():
    graph = StateGraph(BuilderState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node_fn)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")
    return graph.compile(checkpointer=None)


BUILDER_GRAPH = build_graph()


#  Public API 

def start_builder_session(
    image_b64:     str,
    image_mime:    str,
    image_path:    str,
    location_name: str,
    session_id:    str = None,
) -> dict:
    """
    Start a new builder session with an uploaded image.
    First analyzes the image directly, then passes result to agent.
    """
    import uuid
    if not session_id:
        session_id = str(uuid.uuid4())

    # Step 1 — analyze image directly using vision service
    from backend.services.vision import analyze_image, check_image_quality
    import json

    quality     = check_image_quality(image_b64, image_mime)
    description = ""

    if not quality.get("is_clear", True):
        return {
            "session_id":  session_id,
            "response":    f"The image is not clear enough to map this location. Reason: {quality.get('rejection_reason', 'Image too blurry or lacks distinctive features')}. Please upload a clearer image.",
            "messages":    [],
            "is_complete": False,
        }

    description = analyze_image(image_b64, image_mime)

    # Step 2 — pass description to agent (no image in message)
    initial_message = HumanMessage(
        content=f"""I want to add a new location to the knowledge graph.

Location name: {location_name}
Image path: {image_path}

AI Vision Analysis of the image:
{description}

Visible text/signs: {quality.get('visible_text', 'none')}
Location type detected: {quality.get('location_type', 'unknown')}

Based on this analysis, please check existing nodes and help me build this location node by asking smart questions one at a time."""
    )

    state = BuilderState(
        messages=[initial_message],
        image_b64=image_b64,
        image_mime=image_mime,
        image_path=image_path,
        node_id="",
        location_name=location_name,
        session_id=session_id,
        step="analyze",
        node_data={},
        existing_nodes=[],
        is_complete=False,
        error="",
    )

    result   = BUILDER_GRAPH.invoke(state, config={"recursion_limit": 5})
    last_msg = result["messages"][-1]

    return {
        "session_id":  session_id,
        "response":    last_msg.content if hasattr(last_msg, "content") else str(last_msg),
        "messages":    [
            {"type": type(m).__name__, "content": m.content if hasattr(m, "content") else str(m)}
            for m in result["messages"]
        ],
        "is_complete": result.get("is_complete", False),
    }


def tool_node_fn(state: BuilderState) -> BuilderState:
    """Execute tool calls with error handling."""
    try:
        tool_node = ToolNode(TOOLS)
        result    = tool_node.invoke(state)
        return {**state, "messages": result["messages"]}
    except Exception as e:
        error_msg = ToolMessage(
            content=f"Tool execution error: {str(e)}",
            tool_call_id="error",
        )
        return {**state, "messages": state["messages"] + [error_msg]}


def continue_builder_session(
    session_id:   str,
    user_message: str,
    messages:     list,
    image_b64:    str = "",
    image_mime:   str = "image/jpeg",
    image_path:   str = "",
) -> dict:
    """
    Continue an existing builder session with a user message.
    Returns the agent's next response.
    """
    from langchain_core.messages import messages_from_dict

    # Reconstruct message history
    history = []
    for m in messages:
        if isinstance(m, dict):
            role    = m.get("type", m.get("role", "human"))
            content = m.get("content", "")
            if role in ("human", "HumanMessage"):
                history.append(HumanMessage(content=content))
            elif role in ("ai", "AIMessage"):
                history.append(AIMessage(content=content))
        else:
            history.append(m)

    history.append(HumanMessage(content=user_message))

    state = BuilderState(
        messages=history,
        image_b64=image_b64,
        image_mime=image_mime,
        image_path=image_path,
        node_id="",
        location_name="",
        session_id=session_id,
        step="continue",
        node_data={},
        existing_nodes=[],
        is_complete=False,
        error="",
    )

    result = BUILDER_GRAPH.invoke(state, config={"recursion_limit": 5})
    last_msg = result["messages"][-1]

    return {
        "session_id": session_id,
        "response":   last_msg.content if hasattr(last_msg, "content") else str(last_msg),
        "messages":   [
            {"type": type(m).__name__, "content": m.content if hasattr(m, "content") else str(m)}
            for m in result["messages"]
        ],
        "is_complete": result.get("is_complete", False),
    }