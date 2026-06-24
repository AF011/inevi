"""
NOVA Agent -- Navigation & Route Calculation
=============================================
NOVA calculates the best route from current location to destination
using the knowledge graph connections stored in Aurora DSQL.
"""

import os
import json
from collections import deque
from groq import Groq
from dotenv import load_dotenv

from backend.services.aurora import get_connections, get_location

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL  = "llama-3.3-70b-versatile"


def find_route(from_node: str, to_node: str) -> list:
    """
    BFS to find shortest path from current node to destination.
    Returns list of node_ids in order from current to destination.
    """
    if from_node == to_node:
        return [from_node]

    visited = {from_node}
    queue   = deque([[from_node]])

    while queue:
        path = queue.popleft()
        current = path[-1]

        conns = get_connections(current)
        for conn in conns:
            next_node = conn["to_node"]
            if next_node not in visited:
                new_path = path + [next_node]
                if next_node == to_node:
                    return new_path
                visited.add(next_node)
                queue.append(new_path)

    return []


def get_next_step(
    current_node: str,
    destination_node: str,
    language: str = "en",
) -> dict:
    """
    Get the immediate next navigation instruction.
    Returns what to do RIGHT NOW to get closer to destination.
    """
    if current_node == destination_node:
        loc  = get_location(destination_node)
        name = loc["name"] if loc else destination_node
        return {
            "reached":     True,
            "instruction": f"You have arrived at {name}!",
            "direction":   None,
            "next_node":   destination_node,
            "steps_left":  0,
        }

    # Find route
    route = find_route(current_node, destination_node)

    if not route or len(route) < 2:
        return {
            "reached":     False,
            "instruction": "I could not find a route to your destination.",
            "direction":   None,
            "next_node":   None,
            "steps_left":  0,
        }

    next_node = route[1]

    # Get the connection details for this step
    conns = get_connections(current_node)
    step_conn = None
    for conn in conns:
        if conn["to_node"] == next_node:
            step_conn = dict(conn)
            break

    if not step_conn:
        return {
            "reached":     False,
            "instruction": "Keep moving towards your destination.",
            "direction":   None,
            "next_node":   next_node,
            "steps_left":  len(route) - 1,
        }

    # Generate natural instruction
    next_loc  = get_location(next_node)
    dest_loc  = get_location(destination_node)
    next_name = next_loc["name"] if next_loc else next_node
    dest_name = dest_loc["name"] if dest_loc else destination_node

    lang_instruction = {
        "te": "Respond in Telugu language",
        "hi": "Respond in Hindi language",
        "en": "Respond in English",
    }.get(language, "Respond in English")

    raw_instruction = step_conn.get("instruction", f"Head {step_conn.get('direction', 'forward')}")
    steps_remaining = len(route) - 1

    prompt = f"""{lang_instruction}.

You are VEDA, an AI navigation guide. Give a clear, natural navigation instruction.

Current location: {get_location(current_node)['name'] if get_location(current_node) else current_node}
Next step: {next_name}
Final destination: {dest_name}
Direction: {step_conn.get('direction', 'forward')}
Raw instruction: {raw_instruction}
Steps remaining: {steps_remaining}

Generate ONE short natural navigation instruction (1 sentence).
Be clear and specific. Like a real guide talking to you."""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=80,
        temperature=0.5,
    )

    instruction = resp.choices[0].message.content.strip()

    return {
        "reached":     False,
        "instruction": instruction,
        "direction":   step_conn.get("direction"),
        "next_node":   next_node,
        "steps_left":  steps_remaining,
        "full_route":  route,
    }


def check_destination_reached(
    current_node:     str,
    destination_node: str,
) -> bool:
    """Check if user has reached their destination."""
    return current_node == destination_node


def get_route_summary(
    from_node: str,
    to_node:   str,
    language:  str = "en",
) -> str:
    """
    Generate a summary of the full route before starting navigation.
    Example: "To reach the Kitchen from Hall, turn right through the curtain. It is just 5 meters away."
    """
    route = find_route(from_node, to_node)

    if not route:
        return "I could not find a route to your destination."

    if len(route) == 1:
        loc  = get_location(from_node)
        name = loc["name"] if loc else from_node
        return f"You are already at {name}!"

    # Build route description
    steps = []
    for i in range(len(route) - 1):
        conns = get_connections(route[i])
        for conn in conns:
            if conn["to_node"] == route[i + 1]:
                steps.append(conn.get("instruction", f"Go {conn.get('direction', 'forward')}"))
                break

    from_loc = get_location(from_node)
    to_loc   = get_location(to_node)
    from_name = from_loc["name"] if from_loc else from_node
    to_name   = to_loc["name"] if to_loc else to_node

    lang_instruction = {
        "te": "Respond in Telugu language",
        "hi": "Respond in Hindi language",
        "en": "Respond in English",
    }.get(language, "Respond in English")

    prompt = f"""{lang_instruction}.

You are VEDA, an AI navigation guide. Give a brief route summary.

From: {from_name}
To: {to_name}
Steps: {' -> '.join(steps)}
Total steps: {len(route) - 1}

Give a brief 1-2 sentence route overview. Be natural and helpful."""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=100,
        temperature=0.5,
    )

    return resp.choices[0].message.content.strip()