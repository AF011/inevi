import os
from dotenv import load_dotenv

load_dotenv()

# ── Groq ──────────────────────────────────────────────
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_LLM_MODEL: str = "llama-3.3-70b-versatile"
GROQ_VISION_MODEL: str = os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

# ── Aurora DSQL ───────────────────────────────────────
AURORA_ENDPOINT: str = os.getenv("AURORA_ENDPOINT", "")
AURORA_USER: str = os.getenv("AURORA_USER", "admin")
AURORA_REGION: str = os.getenv("AURORA_REGION", "ap-southeast-2")

# ── DynamoDB ──────────────────────────────────────────
DYNAMO_TABLE: str = os.getenv("DYNAMO_TABLE", "inevi-sessions")
AWS_REGION: str = os.getenv("AWS_REGION", "ap-southeast-2")
AWS_ACCESS_KEY_ID: str = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")

# ── App ───────────────────────────────────────────────
APP_HOST: str = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT: int = int(os.getenv("APP_PORT", "8000"))
DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"

# ── Validation ────────────────────────────────────────
def validate():
    missing = []
    if not GROQ_API_KEY:
        missing.append("GROQ_API_KEY")
    if not AURORA_ENDPOINT:
        missing.append("AURORA_ENDPOINT")
    if not AWS_ACCESS_KEY_ID:
        missing.append("AWS_ACCESS_KEY_ID")
    if not AWS_SECRET_ACCESS_KEY:
        missing.append("AWS_SECRET_ACCESS_KEY")
    if missing:
        raise ValueError(f"Missing env vars: {', '.join(missing)}")