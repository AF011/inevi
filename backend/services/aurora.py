import os
import uuid
import boto3
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

ENDPOINT              = os.getenv("AURORA_ENDPOINT")
REGION                = os.getenv("AURORA_REGION")
AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")


def get_connection():
    client = boto3.client(
        "dsql",
        region_name=REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )
    token = client.generate_db_connect_admin_auth_token(ENDPOINT, REGION)
    conn = psycopg2.connect(
        host=ENDPOINT,
        port=5432,
        database="postgres",
        user="admin",
        password=token,
        sslmode="require",
        cursor_factory=RealDictCursor,
    )
    return conn


#  Locations 

def insert_location(node: dict):
    """Insert or update a location node."""
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO locations 
                    (node_id, name, description, visual_keywords, signs_visible, facts, is_start)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (node_id) DO UPDATE SET
                        name            = EXCLUDED.name,
                        description     = EXCLUDED.description,
                        visual_keywords = EXCLUDED.visual_keywords,
                        signs_visible   = EXCLUDED.signs_visible,
                        facts           = EXCLUDED.facts,
                        is_start        = EXCLUDED.is_start
                """, (
                    node["node_id"],
                    node["name"],
                    node.get("description", ""),
                    node.get("visual_keywords", ""),
                    node.get("signs_visible", ""),
                    node.get("facts", ""),
                    node.get("is_start", False),
                ))
    finally:
        conn.close()


def get_all_locations():
    """Get all location nodes."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM locations ORDER BY created_at ASC")
            return cur.fetchall()
    finally:
        conn.close()


def get_location(node_id: str):
    """Get a single location by node_id."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM locations WHERE node_id = %s", (node_id,))
            return cur.fetchone()
    finally:
        conn.close()


def delete_location(node_id: str):
    """Delete a location and its images and connections."""
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM location_images WHERE node_id = %s", (node_id,))
                cur.execute("DELETE FROM connections WHERE from_node = %s OR to_node = %s", (node_id, node_id))
                cur.execute("DELETE FROM locations WHERE node_id = %s", (node_id,))
    finally:
        conn.close()


#  Location Images 

def insert_location_image(node_id: str, image_path: str, ai_description: str, angle: str = ""):
    """Add an image to a location node."""
    conn = get_connection()
    image_id = str(uuid.uuid4())
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO location_images
                    (id, node_id, image_path, ai_description, angle)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    image_id,
                    node_id,
                    image_path,
                    ai_description,
                    angle,
                ))
    finally:
        conn.close()
    return image_id


def get_location_images(node_id: str):
    """Get all images for a location node."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM location_images WHERE node_id = %s ORDER BY created_at ASC",
                (node_id,)
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_all_location_images():
    """Get all images across all locations."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT li.*, l.name as location_name 
                FROM location_images li
                JOIN locations l ON li.node_id = l.node_id
                ORDER BY li.created_at ASC
            """)
            return cur.fetchall()
    finally:
        conn.close()


def delete_location_image(image_id: str):
    """Delete a specific image."""
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM location_images WHERE id = %s", (image_id,))
    finally:
        conn.close()


#  Connections 

def insert_connection(conn_data: dict):
    """Insert or update a connection between two nodes."""
    conn = get_connection()
    conn_id = conn_data.get("id") or str(uuid.uuid4())
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO connections
                    (id, from_node, to_node, direction, instruction, distance_meters)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        to_node          = EXCLUDED.to_node,
                        direction        = EXCLUDED.direction,
                        instruction      = EXCLUDED.instruction,
                        distance_meters  = EXCLUDED.distance_meters
                """, (
                    conn_id,
                    conn_data["from_node"],
                    conn_data["to_node"],
                    conn_data.get("direction", ""),
                    conn_data.get("instruction", ""),
                    conn_data.get("distance_meters", 0),
                ))
    finally:
        conn.close()
    return conn_id


def get_connections(node_id: str):
    """Get all connections FROM a node."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM connections WHERE from_node = %s",
                (node_id,)
            )
            return cur.fetchall()
    finally:
        conn.close()


def get_all_connections():
    """Get all connections in the graph."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM connections")
            return cur.fetchall()
    finally:
        conn.close()


def delete_connection(conn_id: str):
    """Delete a specific connection."""
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM connections WHERE id = %s", (conn_id,))
    finally:
        conn.close()


#  Graph helpers 

def get_full_graph():
    """Get all locations with their images and connections."""
    locations = get_all_locations()
    result    = []
    for loc in locations:
        node_id = loc["node_id"]
        images  = get_location_images(node_id)
        conns   = get_connections(node_id)
        result.append({
            **loc,
            "images":      list(images),
            "connections": list(conns),
        })
    return result


def get_location_with_details(node_id: str):
    """Get a location with all its images and connections."""
    loc = get_location(node_id)
    if not loc:
        return None
    return {
        **loc,
        "images":      list(get_location_images(node_id)),
        "connections": list(get_connections(node_id)),
    }