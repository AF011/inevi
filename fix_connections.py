"""
Run once to fix missing home graph connections.
cd E:\Hackathons\2026\vercel-hackathon\inevi
uv run python fix_connections.py
"""

from backend.services.aurora import get_all_connections, insert_connection

def fix():
    print("Fetching existing connections...")
    existing = get_all_connections()
    existing_pairs = {(c["from_node"], c["to_node"]) for c in existing}
    print(f"Found {len(existing_pairs)} existing connections")

    connections_to_add = [
        # home_right_room (Leo Workspace) <-> home_hall
        {"from_node": "home_right_room", "to_node": "home_hall",      "direction": "forward", "instruction": "Exit through the door in front of you to reach the Hall.",          "distance_meters": 5},
        {"from_node": "home_hall",       "to_node": "home_right_room", "direction": "right",   "instruction": "Enter the door on your right to reach the Leo Workspace.",          "distance_meters": 5},
        # home_left_room (Sleeping Room) <-> home_hall
        {"from_node": "home_left_room",  "to_node": "home_hall",      "direction": "forward", "instruction": "Exit through the door in front of you to reach the Hall.",          "distance_meters": 5},
        {"from_node": "home_hall",       "to_node": "home_left_room",  "direction": "left",    "instruction": "Enter the door on your left to reach the Sleeping Room.",           "distance_meters": 5},
        # home_kitchen <-> home_hall
        {"from_node": "home_kitchen",    "to_node": "home_hall",      "direction": "forward", "instruction": "Walk forward through the curtain to reach the Hall.",               "distance_meters": 4},
        {"from_node": "home_hall",       "to_node": "home_kitchen",    "direction": "forward", "instruction": "Walk forward through the curtain to reach the Kitchen.",            "distance_meters": 4},
    ]

    added = 0
    skipped = 0
    for conn in connections_to_add:
        pair = (conn["from_node"], conn["to_node"])
        if pair in existing_pairs:
            print(f"  SKIP (exists): {conn['from_node']} -> {conn['to_node']}")
            skipped += 1
        else:
            insert_connection(conn)
            print(f"  ADDED: {conn['from_node']} -> {conn['to_node']}")
            added += 1

    print(f"\nDone. Added: {added}, Skipped: {skipped}")
    print("\nHome graph now fully connected:")
    print("  home_kitchen <-> home_hall <-> home_right_room")
    print("                   home_hall <-> home_left_room")

if __name__ == "__main__":
    fix()