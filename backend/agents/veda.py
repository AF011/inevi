"""
VEDA Agent -- Communication & Response Generation
==================================================
VEDA is the voice of Inevi. It takes outputs from LOKI, SAGE, and NOVA
and generates natural conversational responses for the user.
VEDA also processes user speech to understand intent.
"""

import os
import json
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL  = "llama-3.3-70b-versatile"

VEDA_SYSTEM = """You are VEDA, a warm and intelligent AI spatial guide for Inevi.
You speak like a friendly local guide who knows the place well.
You are always helpful, clear, and concise.
Keep responses SHORT -- 1-2 sentences maximum.
Never use bullet points or lists. Speak naturally."""


def understand_user_intent(
    user_speech:  str,
    current_node: str = None,
    language:     str = "en",
) -> dict:
    """
    Understand what the user wants from their speech.
    Returns intent type and extracted information.

    Intent types:
    - navigation: user wants to go somewhere
    - question: user is asking about current location
    - confirmation: user said yes/no
    - greeting: user said hi/hello
    - unknown: could not understand
    """
    lang_instruction = {
        "te": "The user is speaking in Telugu. Understand Telugu.",
        "hi": "The user is speaking in Hindi. Understand Hindi.",
        "en": "The user is speaking in English.",
    }.get(language, "The user is speaking in English.")

    prompt = f"""{lang_instruction}

The user said: "{user_speech}"
Current location: {current_node or 'unknown'}

Classify the user's intent. Return ONLY valid JSON:
{{
  "intent": "navigation" or "question" or "confirmation" or "greeting" or "unknown",
  "destination": "extracted destination if navigation intent, else null",
  "question": "extracted question if question intent, else null",
  "confirmation": true or false or null,
  "raw_text": "{user_speech}"
}}"""

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=150,
        temperature=0.1,
    )

    raw = resp.choices[0].message.content.strip()
    import re
    raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()

    try:
        return json.loads(raw)
    except Exception:
        return {
            "intent":       "unknown",
            "destination":  None,
            "question":     None,
            "confirmation": None,
            "raw_text":     user_speech,
        }


def respond_location_unknown(language: str = "en") -> str:
    """Response when LOKI cannot identify location."""
    responses = {
        "en": "I can see you but I'm not sure where you are. Could you show me something distinctive around you, like a sign or a specific area?",
        "te": "నేను మీరు ఎక్కడ ఉన్నారో గుర్తించలేకపోతున్నాను. దయచేసి మీ చుట్టూ ఉన్న ఏదైనా విశిష్టమైనది చూపించగలరా?",
        "hi": "मुझे पता नहीं चल रहा आप कहाँ हैं। क्या आप मुझे कोई खास चीज़ दिखा सकते हैं?",
    }
    return responses.get(language, responses["en"])


def respond_destination_not_found(destination: str, language: str = "en") -> str:
    """Response when user's destination cannot be found."""
    responses = {
        "en": f"I couldn't find '{destination}' in this area. Could you describe it differently or choose another place?",
        "te": f"'{destination}' ఈ ప్రాంతంలో కనుగొనలేకపోయాను. దయచేసి వేరే విధంగా వర్ణించగలరా?",
        "hi": f"'{destination}' यहाँ नहीं मिल रहा। क्या आप इसे अलग तरह से बता सकते हैं?",
    }
    return responses.get(language, responses["en"])


def respond_destination_reached(location_name: str, language: str = "en") -> str:
    """Response when user reaches their destination."""
    responses = {
        "en": f"You have arrived at {location_name}! Is there anything you would like to know about this place?",
        "te": f"మీరు {location_name} చేరుకున్నారు! ఈ స్థలం గురించి ఏదైనా తెలుసుకోవాలా?",
        "hi": f"आप {location_name} पहुँच गए हैं! क्या आप यहाँ के बारे में कुछ जानना चाहते हैं?",
    }
    return responses.get(language, responses["en"])


def respond_no_route(
    from_name: str,
    to_name:   str,
    language:  str = "en",
) -> str:
    """Response when no route found between two locations."""
    responses = {
        "en": f"I couldn't find a path from {from_name} to {to_name}. These locations may not be connected yet.",
        "te": f"{from_name} నుండి {to_name} కి మార్గం కనుగొనలేకపోయాను.",
        "hi": f"{from_name} से {to_name} का रास्ता नहीं मिल रहा।",
    }
    return responses.get(language, responses["en"])


def respond_greeting(language: str = "en") -> str:
    """Initial greeting when Traverse starts."""
    responses = {
        "en": "Hi! I'm VEDA, your spatial guide. I'm looking at your surroundings to figure out where you are. Please move your camera around slowly.",
        "te": "నమస్కారం! నేను VEDA, మీ స్థల గైడ్. మీరు ఎక్కడ ఉన్నారో చూస్తున్నాను. దయచేసి కెమెరాను నెమ్మదిగా తిప్పండి.",
        "hi": "नमस्ते! मैं VEDA हूँ, आपका गाइड। मैं देख रहा हूँ आप कहाँ हैं। कृपया कैमरा धीरे-धीरे घुमाएं।",
    }
    return responses.get(language, responses["en"])


def generate_custom_response(
    context:  str,
    language: str = "en",
) -> str:
    """Generate a custom VEDA response for any situation."""
    lang_instruction = {
        "te": "Respond in Telugu language",
        "hi": "Respond in Hindi language",
        "en": "Respond in English",
    }.get(language, "Respond in English")

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": VEDA_SYSTEM + f"\n{lang_instruction}."},
            {"role": "user",   "content": context},
        ],
        max_tokens=100,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip()