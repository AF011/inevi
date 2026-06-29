<div align="center">

# INEVitable

### Where Google Maps ends, Inevi begins.

[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://inevi.vercel.app)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![AWS](https://img.shields.io/badge/AWS-232F3E?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com)
[![Groq](https://img.shields.io/badge/Groq-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com)

**AI-powered indoor spatial navigation. Real-time. Conversational. Multilingual.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-%E2%86%97-2EC4B6?style=for-the-badge)](https://inevi.vercel.app)
[![Map Studio](https://img.shields.io/badge/Map%20Studio-%E2%86%97-2EC4B6?style=for-the-badge)](https://inevi.vercel.app/studio)
[![Start Navigating](https://img.shields.io/badge/Start%20Navigating-%E2%86%97-2EC4B6?style=for-the-badge)](https://inevi.vercel.app/traverse)

</div>

---

## What is Inevi

Google Maps stops at the front door. Inside malls, hospitals, university campuses, and museums, you are on your own. Inevi solves this.

**Inevi is a video call with an AI that knows your space.**

No extra hardware. No beacons. No QR codes. Just open Inevi on your phone, start a call with your AI guide, and point your camera around. The AI sees what you see, figures out where you are, and talks you through every step to your destination — exactly like calling a friend who knows the building.

Anyone can map their own space using Map Studio. Upload photos of each location, describe what is there, draw the connections between spaces. Once mapped, that space is navigable by anyone who visits. A hospital administrator maps the corridors once. Every patient who walks in can call the AI and get guided to their ward, lab, or exit in their own language.

No Google Maps integration needed. No internet-connected sensors. No installation. Just a phone call to an AI that has already learned your building.

---

## How It Works

Inevi runs six specialized AI agents in a coordinated pipeline:

```
Camera Frame
     |
    IRIS  — Analyzes the live frame, separates background from scene
     |
    LOKI  — Matches background against the knowledge graph to identify location
     |
    SAGE  — Retrieves location facts, identifies the user's destination
     |
    NOVA  — Calculates the optimal route using BFS graph traversal
     |
    VEDA  — Generates a natural language response in the user's language
     |
   Avatar — Anam AI avatar speaks the response with lip sync
```

A seventh agent, **BUILDER**, powers the Map Studio — a conversational interface for building indoor maps by uploading images and describing locations.

---

## Architecture

```
Frontend (Next.js)          Backend (FastAPI)           AWS Infrastructure
------------------          -----------------           ------------------
Traverse Page               IRIS Agent                  Aurora DSQL
  - Camera feed             LOKI Agent                    locations
  - Anam AI avatar          SAGE Agent                    connections
  - Voice (Web Speech)      NOVA Agent                    location_images
  - Chat log                VEDA Agent
                            BUILDER Agent               DynamoDB
Map Studio                  Orchestrator                  navigation sessions
  - Upload nodes            Routes
  - Manage connections                                  S3
                                                          location images
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, PWA |
| Backend | Python, FastAPI |
| AI Agents | Groq (Llama 3.3 70B, Llama 4 Scout Vision) |
| Avatar | Anam AI (6 personas — Finn, Hunter, Kevin, Mia, Layla, Emily) |
| Database | AWS Aurora DSQL (locations + connections) |
| Sessions | AWS DynamoDB |
| Storage | AWS S3 (location images) |
| Deployment | Vercel (frontend + backend) |
| Language | English, Telugu, Hindi |

---

## AWS Services

**Aurora DSQL** stores the spatial knowledge graph:
- `locations` — node_id, name, description, visual keywords, signs, facts
- `connections` — from_node, to_node, direction, instruction, distance
- `location_images` — S3 URLs with AI-generated descriptions per angle

**DynamoDB** manages live navigation sessions with in-memory cache for real-time coordination between the frame pipeline and speech pipeline.

**S3** stores location images as public URLs. LOKI compares live camera frames against these reference images to identify the user's location.

---

## Features

- Live camera location detection with confidence scoring
- Conversational navigation in English, Telugu, and Hindi
- Six AI avatars with real-time lip sync (Anam AI)
- BFS route calculation through the knowledge graph
- Map Studio for building custom indoor maps
- PWA — installable on Android and iOS
- Google Meet-style video call interface
- Mobile responsive

---

## Knowledge Graph

Inevi ships with 13 pre-built nodes across two environments:

**VIT-AP University Campus (9 nodes)**
Main Gate → Campus Entrance → Boulevard → MG Block → AB1 Block → AB2 Block → Rock Plaza → Library

**Home Test Environment (4 nodes)**
Hall → Kitchen → Left Room → Leo Workspace

---

## Local Development

```bash
# Backend
cd E:\path\to\inevi
uvicorn backend.main:app --reload --port 8000 --host 0.0.0.0

# Frontend
cd frontend
npm install
npm run dev
```

**Environment variables required:**
```
GROQ_API_KEY=
GROQ_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
AURORA_DSQL_ENDPOINT=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-southeast-2
S3_BUCKET_NAME=
DYNAMODB_TABLE=inevi-sessions
ANAM_API_KEY_1=
ANAM_PERSONA_FINN=
ANAM_PERSONA_HUNTER=
ANAM_PERSONA_KEVIN=
ANAM_PERSONA_MIA=
ANAM_PERSONA_LAYLA=
ANAM_PERSONA_EMILY=
NEXT_PUBLIC_API_URL=https://inevi.vercel.app
```

---

## Hackathon

Built for the **Vercel + AWS Databases Hackathon (H01)** — June 2026.

Track: Open Innovation

AWS Services used: Aurora DSQL, DynamoDB, S3

---

---

## Team

**Nocturne Syndicate**

| Role | Name | GitHub |
|------|------|--------|
| Team Leader | Abdul Faheem | [@AF011](https://github.com/AF011) |
| Member | Gandham Mani Saketh | [@Saketh07](https://github.com/GANDHAMMANI) |

---

<div align="center">
  <sub>An AF's Endeavor &nbsp;|&nbsp; Developed with 🥤 and 💡</sub>
</div>