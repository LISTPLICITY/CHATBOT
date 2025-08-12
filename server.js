// server.js — Listplicity Chatbot (Claude / Anthropic version)
// Warm welcome + buyer/seller flows + MLS link tag + lead forwarder + static hosting + diagnostics

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());

// ---------- CORS (lock to your site domain later) ----------
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // e.g. 'https://your-ghl-domain.com'
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------- Health ----------
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: 'anthropic',
    llm: !!process.env.ANTHROPIC_API_KEY,
  });
});

// ---------- Lead forwarder to GHL ----------
app.post('/api/lead', async (req, res) => {
  const webhook = process.env.GHL_WEBHOOK_URL;
  if (!webhook) return res.status(500).json({ ok: false, error: 'Missing GHL_WEBHOOK_URL' });

  try {
    const payload = { source: 'listplicity-chatbot', ...req.body, ts: new Date().toISOString() };
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`GHL forward failed: ${r.status}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('Lead forward failed:', e);
    res.status(500).json({ ok: false, error: 'forward_failed' });
  }
});

// ---------- Warm Welcome (instant, no LLM round-trip) ----------
app.get('/api/welcome', (_req, res) => {
  res.json({
    intent: 'welcome',
    bot_text:
`Hi there, and welcome to Listplicity! 👋
Thanks for stopping by. Whether you’re buying, selling, or just exploring, I’m here to help.
Ask me anything about real estate — from our 1% Listing (Limited Services) to getting real-time MLS access.
What brings you here today?`,
    state_patch: {},
    action: null
  });
});

// ---------- System prompt (Claude) ----------
const SYSTEM_PROMPT = `
You are the Listplicity Real Estate Assistant.
Tone: confident, warm, professional, conversational. Be brief (1–2 sentences per turn).

Primary goals:
1) Have a helpful conversation about buying, selling, or both.
2) Progressively collect these fields:
   path(sell|buy|both), state, address, sell_timeline,
   buy_area, buy_budget, buy_preapproval(yes|no|unsure),
   name, email, phone.
3) When the required contact fields (path, name, email, phone) are present, set action="submit" and confirm briefly.

1% Listing (Limited Services):
- If asked about “1% listing”, explain it's a Limited Services Listing and not for everyone.
- Avoid exhaustive details in chat; push to book a quick call or collect phone number.
- Example: "It can save money, but it depends on your situation. A 10-minute call is best—what’s the best number and a good time?"

Buyer flow (collect first, then link):
- If the user is buying or asks for MLS access, acknowledge that you have a free MLS-connected app (iOS & Android), but DO NOT paste the full URL immediately.
- First ask two qualifiers: preferred areas/school zones and price range.
- Then collect contact:
  1) name
  2) email
  3) phone — with a value hook: "I’ll text you the app link and set up instant alerts."
- AFTER they provide phone, respond with a shortened, friendly link (https://tinyurl.com/3cjtjupn) instead of the long URL, and set \"tag\": "MLS Link Request".
- Keep collecting timeline and preapproval status.
- If they insist on the link without sharing info, politely explain you can still share it, but they may miss out on personalized instant alerts unless you have at least one contact method.

Handling questions:
- Answer real estate questions (laws, timelines, processes, market) for the user's state concisely, then pivot to the next missing field.
- Off-topic: acknowledge briefly and return to real estate.
- Urgent/safety/legal: suggest human handoff; ask best phone/email.
- Validate email/phone formats; if invalid, politely re-ask.
- Never overwhelm; one question at a time.

Return STRICT JSON ONLY:
{
  "intent": "collect_info" | "relevant_question" | "off_topic" | "handoff",
  "bot_text": "string",
  "state_patch": { "path"?: "sell|buy|both", "answers"?: { /* partial fields */ }, "tag"?: "MLS Link Request" },
  "action": null | "submit"
}
`.trim();

// ---------- Claude (Anthropic) chat ----------
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      intent: 'collect_info',
      bot_text: 'LLM is off. Set ANTHROPIC_API_KEY in Render.',
      state_patch: {},
      action: null
    });
  }

  const { history = [], state = {} } = req.body || {};
  const userPayload = { history: Array.isArray(history) ? history.slice(-12) : [], state };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(userPayload) }]
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(()=>'');
      console.error('Claude API error:', r.status, errText);
      return res.status(500).json({
        intent: 'collect_info',
        bot_text: `Claude error (status ${r.status}): ${errText.slice(0,180)}`,
        state_patch: {},
        action: null
      });
    }

    const data = await r.json();
    const raw = data?.content?.[0]?.text || '{}';

    let out;
    try { out = JSON.parse(raw); }
    catch {
      out = { intent: 'collect_info', bot_text: raw, state_patch: {}, action: null };
    }
    if (!out || typeof out !== 'object') {
      out = { intent: 'collect_info', bot_text: 'Sorry, hiccup. Could you rephrase that?', state_patch: {}, action: null };
    }

    return res.json(out);
  } catch (e) {
    console.error('LLM exception:', e);
    return res.status(500).json({
      intent: 'collect_info',
      bot_text: `LLM exception: ${String(e).slice(0,180)}`,
      state_patch: {},
      action: null
    });
  }
});

// ---------- Diagnostics (pings Anthropic) ----------
app.get('/api/diag', async (_req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
  let status = null, sample = null;

  if (apiKey) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          system: 'Return "ok" as plain text.',
          messages: [{ role: 'user', content: 'ping' }]
        })
      });
      status = r.status;
      sample = await r.text();
    } catch (e) {
      status = 'exception';
      sample = String(e);
    }
  }

  res.json({ ok: true, provider: 'anthropic', hasKey: !!apiKey, model, diag: { status, sample: (sample || '').slice(0,180) } });
});

// ---------- Static hosting (serves index.html) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.use(express.static(__dirname));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- Start ----------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listplicity (Claude) running on :${port}`));
