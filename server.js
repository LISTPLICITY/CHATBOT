// server.js — Listplicity Chatbot (Claude v2: CTA link + richer UI support)
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, provider: 'anthropic', llm: !!process.env.ANTHROPIC_API_KEY });
});

// Lead → GHL
app.post('/api/lead', async (req, res) => {
  const webhook = process.env.GHL_WEBHOOK_URL;
  if (!webhook) return res.status(500).json({ ok: false, error: 'Missing GHL_WEBHOOK_URL' });
  try {
    const payload = { source: 'listplicity-chatbot', ...req.body, ts: new Date().toISOString() };
    const r = await fetch(webhook, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('forward_failed:' + r.status);
    res.json({ ok: true });
  } catch (e) {
    console.error('Lead forward failed:', e);
    res.status(500).json({ ok: false, error: 'forward_failed' });
  }
});

// Warm Welcome
app.get('/api/welcome', (_req, res) => {
  res.json({
    intent: 'welcome',
    bot_text: "Hi there, and welcome to Listplicity! 👋\nThanks for stopping by. Whether you’re buying, selling, or just exploring, I’m here to help.\nAsk me anything about real estate — from our 1% Listing (Limited Services) to getting real-time MLS access.\nWhat brings you here today?",
    state_patch: {},
    action: null
  });
});

// ===== SYSTEM PROMPT (personality slot) =====
// Paste your long-form Claude personality below between <<<PERSONALITY>>> markers if you want to override.
const PERSONALITY_OVERRIDE = ``; // <— paste your custom persona here if desired

const BASE_PROMPT = `
You are the Listplicity Real Estate Assistant.
Tone: confident, warm, upbeat, and human. Keep responses tight (1–2 sentences) and always end with a helpful next question.

Primary goals:
1) Hold a friendly conversation about buying, selling, or both.
2) Progressively collect fields: path(sell|buy|both), state, address, sell_timeline, buy_area, buy_budget, buy_preapproval(yes|no|unsure), name, email, phone.
3) When path + name + email + phone are present, set action="submit" and confirm briefly.

1% Listing (Limited Services):
- Explain it's a Limited Services Listing that can reduce listing-side fees (not for everyone). Avoid a data-dump; invite a quick call and capture contact.
- Example: "It could save you thousands, but it depends on your situation. What’s the best number and a good time for a 10‑minute call?"

Buyer flow — collect-first, then link:
- If user is buying / asks for MLS access, acknowledge the free MLS-connected app (iOS & Android) but DO NOT paste the full link yet.
- Ask two qualifiers first: preferred areas/school zones and price range.
- Then collect: name → email → phone with the value hook "I’ll text you the app link and set up instant alerts."
- AFTER phone is provided, share the short link as a CTA: label "Open MLS App", href "https://tinyurl.com/3cjtjupn" AND set tag "MLS Link Request". Keep answers concise and continue collecting timeline + preapproval.
- If they insist on the link first, give the same short link but request at least one contact method and a next step.

Handling questions:
- Answer succinctly for their state; pivot back to the next missing field.
- If off-topic, acknowledge quickly and return to real estate.
- Validate email/phone formats; politely re-ask if invalid.
- Urgent/safety/legal → suggest human handoff and capture contact.

Output STRICT JSON ONLY with this shape:
{
  "intent": "collect_info" | "relevant_question" | "off_topic" | "handoff",
  "bot_text": "string",
  "state_patch": {
    "path"?: "sell" | "buy" | "both",
    "answers"?: { /* incremental fields */ },
    "tag"?: "MLS Link Request"
  },
  "cta": { "label": "Open MLS App", "href": "https://tinyurl.com/3cjtjupn" } | null,
  "action": null | "submit"
}
`;

const SYSTEM_PROMPT = (PERSONALITY_OVERRIDE && PERSONALITY_OVERRIDE.trim().length > 10)
  ? PERSONALITY_OVERRIDE
  : BASE_PROMPT;

// Claude chat
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ intent:'collect_info', bot_text:'LLM is off. Set ANTHROPIC_API_KEY in Render.', state_patch:{}, cta:null, action:null });
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
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(userPayload) }]
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(()=>'');
      console.error('Claude API error:', r.status, errText);
      return res.status(500).json({ intent:'collect_info', bot_text:`Claude error (${r.status})`, state_patch:{}, cta:null, action:null });
    }

    const data = await r.json();
    const raw = data?.content?.[0]?.text || '{}';

    let out;
    try { out = JSON.parse(raw); }
    catch {
      out = { intent:'collect_info', bot_text: raw, state_patch:{}, cta:null, action:null };
    }
    if (!out || typeof out !== 'object') {
      out = { intent:'collect_info', bot_text:'Sorry, hiccup. Could you rephrase that?', state_patch:{}, cta:null, action:null };
    }
    return res.json(out);
  } catch (e) {
    console.error('LLM exception:', e);
    return res.status(500).json({ intent:'collect_info', bot_text:'LLM exception', state_patch:{}, cta:null, action:null });
  }
});

// Diagnostics
app.get('/api/diag', async (_req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
  let status = null, sample = null;
  if (apiKey) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{
          'content-type':'application/json',
          'x-api-key': apiKey,
          'anthropic-version':'2023-06-01'
        },
        body: JSON.stringify({
          model, max_tokens:8, system:'Return "ok" as plain text.',
          messages:[{role:'user', content:'ping'}]
        })
      });
      status = r.status;
      sample = await r.text();
    } catch (e) { status = 'exception'; sample = String(e); }
  }
  res.json({ ok:true, provider:'anthropic', hasKey:!!apiKey, model, diag:{ status, sample:(sample||'').slice(0,180) } });
});

// Static hosting
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Start
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listplicity (Claude v2) running on :${port}`));
