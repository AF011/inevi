import os
import boto3
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

AWS_REGION            = os.getenv("AWS_REGION", "ap-southeast-2")
AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
DYNAMO_TABLE          = os.getenv("DYNAMO_TABLE", "inevi-sessions")


def get_client():
    return boto3.client(
        "dynamodb",
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )


def get_resource():
    return boto3.resource(
        "dynamodb",
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )


#  Session Operations 

def create_session(session_id: str, data: dict = {}):
    """Create a new navigation session."""
    table = get_resource().Table(DYNAMO_TABLE)
    item = {
        "session_id":       session_id,
        "current_node":     data.get("current_node", ""),
        "destination_node": data.get("destination_node", ""),
        "conversation":     json.dumps(data.get("conversation", [])),
        "created_at":       datetime.utcnow().isoformat(),
        "updated_at":       datetime.utcnow().isoformat(),
    }
    table.put_item(Item=item)
    return item


def get_session(session_id: str):
    """Get a session by ID."""
    table = get_resource().Table(DYNAMO_TABLE)
    resp = table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if item and "conversation" in item:
        item["conversation"] = json.loads(item["conversation"])
    return item


def update_session(session_id: str, updates: dict):
    """Update session fields."""
    table = get_resource().Table(DYNAMO_TABLE)
    updates["updated_at"] = datetime.utcnow().isoformat()

    if "conversation" in updates:
        updates["conversation"] = json.dumps(updates["conversation"])

    expr        = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    names       = {f"#{k}": k for k in updates}
    values      = {f":{k}": v for k, v in updates.items()}

    table.update_item(
        Key={"session_id": session_id},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def delete_session(session_id: str):
    """Delete a session."""
    table = get_resource().Table(DYNAMO_TABLE)
    table.delete_item(Key={"session_id": session_id})


def append_to_conversation(session_id: str, message: dict):
    """Append a message to session conversation history."""
    session = get_session(session_id)
    if not session:
        session = create_session(session_id)
        conversation = []
    else:
        conversation = session.get("conversation", [])

    conversation.append({
        **message,
        "timestamp": datetime.utcnow().isoformat()
    })

    update_session(session_id, {"conversation": conversation})
    return conversation