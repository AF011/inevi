# Inevi — Vision

## One Line
The complete preparation OS for Indian govt exam aspirants. Free. Forever.

## The Experience
Not a chatbot. A preparation companion that lives with you.

### 1. Dashboard — Sticky Note Planner
- Daily goals as sticky cards
- Adaptive — AI sets goals based on exam date + weak areas
- Visual progress — how much syllabus covered
- Streak tracking

### 2. Exam Brain — Heatmap
- 10 years of PYQs visualized
- Topic frequency grid
- Hot topics vs cold topics
- Trending topics (asked more recently)

### 3. Topic Deep Dive
- Concept explanation (LLM)
- Examiner angle (how UPSC frames it)
- All PYQs on this topic with citations
- Current affairs connecting to this topic (live web)
- Likely next year question prediction

### 4. Linked Notes System
- Every chat session can be linked to a project
- AI auto-extracts important points → adds to notes
- User can tick any message → adds to notes
- Notes grow as one living document
- Highlighter colors, clean UI

### 5. Paper Simulator
- Full past paper in exam mode
- Timer, negative marking
- Submit → instant analysis
- Compare your score vs actual cutoff

### 6. Personal Weak Area Heatmap
- YOUR accuracy per topic
- Benchmarked against real cutoffs
- "You need 12% more accuracy in Polity"

### 7. Audio Digest
- Any topic → 3 min AI audio explanation
- Listen while commuting

### 8. Snapshot Cards
- Any topic → shareable image card
- WhatsApp viral loop

## Tech Stack
- Next.js 15 + Vercel
- BGE-M3 embeddings (dense + sparse + colbert)
- Aurora PostgreSQL + pgvector
- DynamoDB (user data, plans, progress)
- Groq Llama 3.3 70B (main LLM)
- DeepSeek R1 on Groq (reasoning)
- Tavily (live web search)
- BGE Reranker

## Hackathon MVP (15 days)
1. Heatmap
2. Topic Deep Dive
3. Sticky planner with daily goals
4. Linked notes in chat
5. Paper simulator

## Post Hackathon
- Audio digest
- Snapshot cards
- Mobile app
- WhatsApp bot
- Hindi + Telugu interface
- 10 more exams