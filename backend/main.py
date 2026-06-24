"""
Inevi  FastAPI Application Entry Point
========================================
AI-powered indoor spatial navigation system.
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from backend.api.routes import router
from backend.config import validate

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s  %(name)s  %(message)s"
)
log = logging.getLogger("inevi")

#  Validate environment 
try:
    validate()
    log.info("Environment validated")
except ValueError as e:
    log.warning(f"{e}")

#  FastAPI app 
app = FastAPI(
    title="Inevi API",
    description="AI-powered indoor spatial navigation  Multi-Agent System",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

#  CORS 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

#  Routes 
app.include_router(router)

#  Root 
@app.get("/")
async def root():
    return {
        "name":    "Inevi API",
        "version": "1.0.0",
        "status":  "running",
        "docs":    "/api/docs",
        "agents":  ["BUILDER", "IRIS", "LOKI", "SAGE", "NOVA", "VEDA"],
    }