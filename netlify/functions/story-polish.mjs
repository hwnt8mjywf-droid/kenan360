// Story Studio "Polish it" button (kenan360.net/story).
// POST /api/story/polish  { text } -> { options: [{ kicker, text }, ...] }
// Uses Netlify AI Gateway (no API key needed in the project).
import Anthropic from "@anthropic-ai/sdk";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const PROMPT = (raw) => `You polish Instagram story text for Ken (KENAN360 — fitness, lifestyle and nightlife coach in Salt Lake City). His audience: men and women 25-45.

RAW POST:
"""${raw}"""

Return 3 polished versions. Rules:
- Fix every spelling, grammar and punctuation error (your/you're, its/it's, extra spaces before punctuation, "!!!" -> one "!").
- KEEP his voice, slang and meaning ("Fellas", "free game" etc. are fine). Do not add hashtags, emojis or new claims.
- Keep it short and punchy for a story: max ~30 words.
- Split into a headline and a payoff with ONE blank line between them (use \\n\\n).
- Wrap 1-3 of the most important words in *asterisks* so they show in orange.
- "kicker": a 1-3 word label for the top of the story (e.g. "FREE GAME", "REAL TALK"), or "" if none fits.
- Version 1: closest to his original wording. Version 2: punchier. Version 3: boldest/most quotable.

Reply with JSON only: {"options":[{"kicker":"...","text":"..."},{"kicker":"...","text":"..."},{"kicker":"...","text":"..."}]}`;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY)
    return json({ error: "ai_unavailable" }, 503);

  const body = await req.json().catch(() => ({}));
  const raw = String(body.text ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, 600);
  if (!raw) return json({ error: "empty" }, 400);

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 700,
      messages: [{ role: "user", content: PROMPT(raw) }],
    });
    const out = msg.content.map((c) => c.text || "").join("");
    const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    const options = (parsed.options || [])
      .filter((o) => o && o.text)
      .slice(0, 3)
      .map((o) => ({ kicker: String(o.kicker || "").slice(0, 30), text: String(o.text).slice(0, 400) }));
    if (!options.length) return json({ error: "empty_result" }, 502);
    return json({ options });
  } catch (e) {
    return json({ error: "ai_error", detail: String(e).slice(0, 200) }, 502);
  }
};

export const config = { path: "/api/story/polish" };
