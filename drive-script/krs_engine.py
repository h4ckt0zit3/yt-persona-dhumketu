"""
KRS ASTROLOGY KNOWLEDGE ENGINE — Final Fixed Version
=====================================================
pip install sentence-transformers groq supabase
"""
from sentence_transformers import SentenceTransformer
from groq import Groq
from supabase import create_client

# ─── CONFIG ───────────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

TOP_K           = 8      # retrieve more chunks
MATCH_THRESHOLD = 0.05   # very low — finds more matches
LLM_MODEL       = "llama-3.3-70b-versatile"
# ──────────────────────────────────────────────────────────────────────────────

print("⏳ Loading embedding model...")
embed_model = SentenceTransformer("all-MiniLM-L6-v2")
groq_client = Groq(api_key=GROQ_API_KEY)
supabase    = create_client(SUPABASE_URL, SUPABASE_KEY)
print("✅ Ready!\n")


def vector_search(question: str) -> list[dict]:
    """Search using embeddings (semantic meaning)."""
    embedding = embed_model.encode(question).tolist()
    result    = supabase.rpc("match_chunks", {
        "query_embedding": embedding,
        "match_count":     TOP_K,
        "match_threshold": MATCH_THRESHOLD
    }).execute()
    return result.data or []


def keyword_search(question: str) -> list[dict]:
    """
    Fallback keyword search when vector search misses.
    Extracts key terms from question and searches directly.
    """
    # Extract important words (ignore common words)
    stop_words = {"what", "does", "mean", "is", "the", "a", "an", "in", "of",
                  "and", "or", "for", "to", "how", "when", "why", "tell", "me",
                  "about", "explain", "with", "do", "i", "my", "your"}

    words = [w.strip("?.,!") for w in question.lower().split()]
    keywords = [w for w in words if w not in stop_words and len(w) > 2]

    if not keywords:
        return []

    # Search for chunks containing the most important keywords
    # Try combinations from most specific to least
    results = []

    # Try all keywords together first
    if len(keywords) >= 2:
        try:
            # Build ilike filter for top 3 keywords
            top_keywords = keywords[:3]
            query = supabase.table("chunks").select("id, transcript_id, chunk_text, chunk_index")
            for kw in top_keywords:
                query = query.ilike("chunk_text", f"%{kw}%")
            resp = query.limit(TOP_K).execute()
            if resp.data:
                for row in resp.data:
                    row["similarity"] = 0.5  # fixed score for keyword matches
                results = resp.data
        except Exception:
            pass

    # If no results, try just the first 2 keywords
    if not results and len(keywords) >= 2:
        try:
            resp = (
                supabase.table("chunks")
                .select("id, transcript_id, chunk_text, chunk_index")
                .ilike("chunk_text", f"%{keywords[0]}%")
                .ilike("chunk_text", f"%{keywords[1]}%")
                .limit(TOP_K)
                .execute()
            )
            if resp.data:
                for row in resp.data:
                    row["similarity"] = 0.4
                results = resp.data
        except Exception:
            pass

    # Last resort — just the first keyword
    if not results and keywords:
        try:
            resp = (
                supabase.table("chunks")
                .select("id, transcript_id, chunk_text, chunk_index")
                .ilike("chunk_text", f"%{keywords[0]}%")
                .limit(TOP_K)
                .execute()
            )
            if resp.data:
                for row in resp.data:
                    row["similarity"] = 0.3
                results = resp.data
        except Exception:
            pass

    return results


def search(question: str, debug: bool = False) -> list[dict]:
    """
    Combined search:
    1. Try vector search first
    2. If poor results, add keyword search results
    3. Deduplicate and return best chunks
    """
    vector_results  = vector_search(question)
    keyword_results = keyword_search(question)

    if debug:
        print(f"📊 Vector search found  : {len(vector_results)} chunks")
        print(f"📊 Keyword search found : {len(keyword_results)} chunks")

    # Combine results, deduplicate by id
    seen_ids = set()
    combined = []

    # Vector results first (higher quality)
    for chunk in vector_results:
        if chunk["id"] not in seen_ids:
            seen_ids.add(chunk["id"])
            combined.append(chunk)

    # Add keyword results not already in vector results
    for chunk in keyword_results:
        if chunk["id"] not in seen_ids:
            seen_ids.add(chunk["id"])
            combined.append(chunk)

    # Sort by similarity score
    combined.sort(key=lambda x: x.get("similarity", 0), reverse=True)

    if debug and combined:
        print(f"\n📚 Top chunks found ({len(combined)} total):")
        for i, c in enumerate(combined[:5], 1):
            print(f"   {i}. [{c.get('similarity', 0):.0%}] {c['chunk_text'][:80]}...")
        print()

    return combined[:TOP_K]


def ask(question: str, debug: bool = False) -> str:
    """Full RAG pipeline — search → retrieve → generate answer."""

    chunks = search(question, debug=debug)

    if not chunks:
        return (
            "I couldn't find relevant information in the KRS database.\n"
            "Try asking like:\n"
            "  • 'What does Saturn in 1st house mean?'\n"
            "  • 'What is Rahu in 5th house?'\n"
            "  • 'What does Moon conjunct Saturn mean?'"
        )

    # Build context from chunks
    context = "\n\n---\n\n".join(
        f"[Source {i} | Relevance: {c.get('similarity', 0):.0%}]\n{c['chunk_text']}"
        for i, c in enumerate(chunks, 1)
    )

    # Generate answer with Groq
    response = groq_client.chat.completions.create(
        model=LLM_MODEL,
        temperature=0.3,
        max_tokens=1500,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert Vedic astrology assistant trained exclusively on "
                    "KRS (Kapiel Raaj) channel knowledge.\n\n"
                    "RULES:\n"
                    "- Answer ONLY using the provided KRS transcript sources\n"
                    "- Synthesize all relevant sources into one clear, complete answer\n"
                    "- Never say 'not available' if ANY related info exists\n"
                    "- Be specific, detailed and easy to understand\n"
                    "- Use proper Vedic astrology terminology\n"
                    "- If multiple sources cover the same topic, combine them"
                )
            },
            {
                "role": "user",
                "content": f"""Question: {question}

Relevant KRS Knowledge:
{context}

Please give a complete, detailed answer based on the above KRS transcript sources."""
            }
        ]
    )

    return response.choices[0].message.content.strip()


def chat_loop():
    print("=" * 60)
    print("   🔮 KRS ASTROLOGY KNOWLEDGE ENGINE")
    print("   Powered by KRS transcripts + Groq AI")
    print("=" * 60)
    print("   Ask any Vedic astrology question.")
    print("   Commands: 'debug' = show sources | 'quit' = exit\n")

    debug = False

    while True:
        try:
            question = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n\nGoodbye! 🙏")
            break

        if not question:
            continue
        if question.lower() in ("quit", "exit", "bye"):
            print("\nGoodbye! 🙏")
            break
        if question.lower() == "debug":
            debug = not debug
            print(f"🔧 Debug mode {'ON — showing sources' if debug else 'OFF'}\n")
            continue

        print("\n🔍 Searching KRS knowledge base...\n")
        try:
            answer = ask(question, debug=debug)
            print(f"🔮 KRS Engine:\n{answer}\n")
            print("-" * 60)
        except Exception as e:
            print(f"❌ Error: {e}\n")


if __name__ == "__main__":
    chat_loop()