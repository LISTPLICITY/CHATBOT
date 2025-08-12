# Listplicity Chatbot (Claude v2)

- Claude-powered backend (Anthropic) with strict JSON responses
- MLS link logic: collect info first, then drop **short CTA button** to `https://tinyurl.com/3cjtjupn`
- Buyer/Seller flows + 1% Listing (Limited Services) call-first
- Lead forwarding to GHL via /api/lead
- Warm welcome + in-page, branded chat UI

## Deploy (Render)
1) Upload to GitHub or ZIP to Render.
2) Set env vars:
   - `ANTHROPIC_API_KEY`
   - `GHL_WEBHOOK_URL`
   - (optional) `CLAUDE_MODEL=claude-3-5-sonnet-20241022`
3) Deploy → open `/api/health`, `/api/diag`, then `/`.

## Personality override
- In `server.js`, set `PERSONALITY_OVERRIDE` to your long-form Claude persona to fully control tone and behavior without touching code elsewhere.
