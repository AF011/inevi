"""
Inevi API Routes
=================
FastAPI routes for Map Studio (BUILDER agent) and Traverse (navigation).
"""

import os
import uuid
import base64
import logging
import traceback
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.agents.builder import start_builder_session, continue_builder_session
from backend.orchestrator.graph import (
    start_traverse_session,
    process_frame,
    process_user_speech,
    load_nav_session,
    NavigationSession,
)
from backend.services.s3 import upload_image
from backend.services.aurora import (
    get_all_locations,
    get_location,
    get_location_with_details,
    get_full_graph,
    get_all_connections,
    insert_connection,
    delete_location,
    delete_connection,
)
from backend.services.dynamo import (
    create_session,
    get_session,
    update_session,
    append_to_conversation,
)

log = logging.getLogger("inevi")

router = APIRouter(prefix="/api", tags=["inevi"])


#  Health 

@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "Inevi API",
        "agents": ["BUILDER", "IRIS", "LOKI", "SAGE", "NOVA", "VEDA"],
    }


# 
#  MAP STUDIO  BUILDER AGENT
# 

class BuilderChatRequest(BaseModel):
    session_id:  str
    message:     str
    messages:    list
    image_b64:   Optional[str] = ""
    image_mime:  Optional[str] = "image/jpeg"
    image_path:  Optional[str] = ""


@router.post("/studio/analyze")
async def studio_analyze(
    file:          UploadFile = File(...),
    location_name: str        = Form(...),
    session_id:    str        = Form(default=""),
):
    """
    Start a BUILDER agent session.
    Upload an image + location name  agent analyzes and starts asking questions.
    """
    try:
        # Read and encode image
        contents  = await file.read()
        image_b64 = base64.b64encode(contents).decode("utf-8")
        mime      = file.content_type or "image/jpeg"
        filename  = file.filename or "uploaded_image.jpg"

        if not session_id:
            session_id = str(uuid.uuid4())

        # Upload image to S3
        try:
            s3_url = upload_image(contents, filename, mime)
        except Exception as s3_err:
            log.warning("S3 upload failed: %s", s3_err)
            s3_url = filename

        image_path = s3_url

        # Start BUILDER agent session
        result = start_builder_session(
            image_b64=image_b64,
            image_mime=mime,
            image_path=image_path,
            location_name=location_name,
            session_id=session_id,
        )

        # Store session in DynamoDB
        create_session(session_id, {
            "current_node": "",
            "conversation": result.get("messages", []),
        })

        return JSONResponse(content={
            "session_id":  session_id,
            "response":    result["response"],
            "messages":    result["messages"],
            "is_complete": result.get("is_complete", False),
            "image_path":  image_path,
        })

    except Exception as e:
        log.error("BUILDER error: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/studio/chat")
async def studio_chat(req: BuilderChatRequest):
    """
    Continue BUILDER agent conversation.
    Send user message  agent responds with next question or saves node.
    """
    try:
        # Get image_path from session if not provided
        image_path = req.image_path
        if not image_path:
            session = get_session(req.session_id)
            if session:
                image_path = session.get("current_node", "")

        result = continue_builder_session(
            session_id=req.session_id,
            user_message=req.message,
            messages=req.messages,
            image_b64=req.image_b64,
            image_mime=req.image_mime,
            image_path=image_path,
        )

        # Update session in DynamoDB
        append_to_conversation(req.session_id, {
            "role":    "user",
            "content": req.message,
        })
        append_to_conversation(req.session_id, {
            "role":    "assistant",
            "content": result["response"],
        })

        return JSONResponse(content={
            "session_id":  req.session_id,
            "response":    result["response"],
            "messages":    result["messages"],
            "is_complete": result.get("is_complete", False),
        })

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/studio/nodes")
async def studio_get_nodes():
    """Get all location nodes with their images and connections."""
    try:
        graph = get_full_graph()
        clean = []
        for node in graph:
            clean_node = {}
            for k, v in node.items():
                if k == "images":
                    clean_node[k] = [
                        {ik: str(iv) if not isinstance(iv, (str, int, float, bool, type(None))) else iv
                         for ik, iv in img.items()}
                        for img in v
                    ]
                elif k == "connections":
                    clean_node[k] = [
                        {ck: str(cv) if not isinstance(cv, (str, int, float, bool, type(None))) else cv
                         for ck, cv in conn.items()}
                        for conn in v
                    ]
                elif not isinstance(v, (str, int, float, bool, type(None))):
                    clean_node[k] = str(v)
                else:
                    clean_node[k] = v
            clean.append(clean_node)
        return JSONResponse(content={"nodes": clean})
    except Exception as e:
        log.error("Get nodes error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/studio/nodes/{node_id}")
async def studio_get_node(node_id: str):
    """Get a single location node with all details."""
    try:
        node = get_location_with_details(node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        return JSONResponse(content={"node": dict(node)})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/studio/nodes/{node_id}")
async def studio_delete_node(node_id: str):
    """Delete a location node and all its connections."""
    try:
        delete_location(node_id)
        return JSONResponse(content={"message": f"Node '{node_id}' deleted successfully"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ConnectionRequest(BaseModel):
    from_node:        str
    to_node:          str
    direction:        str
    instruction:      Optional[str] = ""
    distance_meters:  Optional[int] = 0


@router.post("/studio/connections")
async def studio_add_connection(req: ConnectionRequest):
    """Manually add a connection between two nodes."""
    try:
        conn_id = insert_connection({
            "from_node":       req.from_node,
            "to_node":         req.to_node,
            "direction":       req.direction,
            "instruction":     req.instruction,
            "distance_meters": req.distance_meters,
        })
        return JSONResponse(content={
            "message":    "Connection added successfully",
            "connection_id": conn_id,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/studio/connections/{conn_id}")
async def studio_delete_connection(conn_id: str):
    """Delete a connection."""
    try:
        delete_connection(conn_id)
        return JSONResponse(content={"message": "Connection deleted successfully"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/studio/graph")
async def studio_get_graph():
    """Get the full knowledge graph  all nodes and connections."""
    try:
        nodes       = get_full_graph()
        connections = get_all_connections()
        return JSONResponse(content={
            "nodes":       [dict(n) for n in nodes],
            "connections": [dict(c) for c in connections],
            "total_nodes": len(nodes),
            "total_connections": len(connections),
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 
#  TRAVERSE  NAVIGATION (placeholder for now)
# 

class NavigationRequest(BaseModel):
    session_id:  str
    image_b64:   str
    destination: Optional[str] = ""
    language:    Optional[str] = "en"




class TraverseStartRequest(BaseModel):
    session_id: Optional[str] = None
    language:   Optional[str] = "en"


class TraverseFrameRequest(BaseModel):
    session_id:  str
    image_b64:   str
    image_mime:  Optional[str] = "image/jpeg"
    language:    Optional[str] = "en"


class TraverseSpeechRequest(BaseModel):
    session_id:   str
    user_speech:  str
    language:     Optional[str] = "en"

@router.post("/traverse/start")
async def traverse_start(req: TraverseStartRequest):
    """Start a Traverse navigation session."""
    try:
        result = start_traverse_session(
            session_id=req.session_id or None,
            language=req.language or "en",
        )
        return JSONResponse(content={
            "session_id":    result["session_id"],
            "veda_response": result["veda_response"],
            "status":        "started",
        })
    except Exception as e:
        log.error("Traverse start error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/traverse/frame")
async def traverse_frame(req: TraverseFrameRequest):
    """
    Process a live camera frame through IRIS -> LOKI pipeline.
    Called every 3 seconds from frontend camera.
    """
    try:
        session = load_nav_session(req.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Keep session language in sync with what frontend sends
        if req.language and req.language != session["language"]:
            session["language"] = req.language

        result = process_frame(
            session=session,
            image_b64=req.image_b64,
            image_mime=req.image_mime or "image/jpeg",
        )

        return JSONResponse(content={
            "session_id":    req.session_id,
            "has_response":  result["has_response"],
            "veda_response": result["veda_response"],
            "location": {
                "matched":    result["loki"]["matched"],
                "node_id":    result["loki"]["node_id"],
                "name":       result["loki"]["name"],
                "confidence": result["loki"]["confidence"],
            },
            "scene":  result["iris"]["scene_description"],
            "status": result["session"]["status"],
        })
    except HTTPException:
        raise
    except Exception as e:
        log.error("Traverse frame error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/traverse/speech")
async def traverse_speech(req: TraverseSpeechRequest):
    """
    Process user speech through VEDA -> SAGE -> NOVA pipeline.
    Called when user speaks during navigation.
    """
    try:
        session = load_nav_session(req.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Keep session language in sync with what frontend sends
        if req.language and req.language != session["language"]:
            session["language"] = req.language

        result = process_user_speech(
            session=session,
            user_speech=req.user_speech,
        )

        # Don't send anything back if echo was filtered
        intent_type = result["intent"].get("intent", "unknown")
        if intent_type == "echo_ignored":
            return JSONResponse(content={
                "session_id":    req.session_id,
                "veda_response": None,
                "intent":        "echo_ignored",
                "destination":   None,
                "status":        result["session"]["status"],
            })

        return JSONResponse(content={
            "session_id":    req.session_id,
            "veda_response": result["veda_response"],
            "intent":        intent_type,
            "destination":   result["intent"].get("destination"),
            "status":        result["session"]["status"],
        })
    except HTTPException:
        raise
    except Exception as e:
        log.error("Traverse speech error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))