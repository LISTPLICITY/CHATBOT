# Listplicity Chatbot (Claude / Anthropic)

A real-estate focused chatbot for Listplicity using Anthropic (Claude 3.5 Sonnet).
- Conversational buyer/seller flows
- Collect-first MLS app sharing (short link only)
- Limited Services 1% listing CTA
- Lead forwarding to Go High Level (GHL)
- Static front-end included

## Quick Start (Render)
1. Upload this repo or connect GitHub.
2. Set Environment Variables (Settings → Environment):
   - `ANTHROPIC_API_KEY` = your Claude key
   - `GHL_WEBHOOK_URL`   = your LeadConnector webhook
   - (optional) `CLAUDE_MODEL` = `claude-3-5-sonnet-20241022`
3. Ensure Node 18+ (package.json engines set).
4. Deploy. Visit `/api/health` (should show provider anthropic + hasKey true).
5. Visit `/` to chat.

## Local Dev
1. Copy `.env.example` to `.env` and fill values.
2. `npm install`
3. `npm start`
4. Open http://localhost:3000

## Endpoints
- `GET /api/health` — basic status
- `GET /api/welcome` — warm greeting payload
- `POST /api/chat` — conversation (returns JSON with bot_text/state_patch)
- `POST /api/lead` — forwards to GHL webhook
- `GET /api/diag` — quick Anthropic ping

## Notes
- The bot **collects name/email/phone first** before sharing the **short** MLS link (https://tinyurl.com/3cjtjupn).
- If user insists on the link first, it shares it but still requests at least one contact method and a next step.
- Tag `"MLS Link Request"` is set in the response when applicable so you can trigger a GHL workflow.
