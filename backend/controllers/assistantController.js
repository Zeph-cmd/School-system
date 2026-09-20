/**
 * AI Help Assistant controller.
 *
 * Security rules baked in:
 * - The user's role comes ONLY from the verified JWT (req.user), never the request body.
 * - The assistant receives NO real app data — no DB records, no student info.
 *   It only sees the static, editable guide from backend/assistantGuides.js.
 * - The OpenAI API key is read from the environment and is never logged.
 */

const { ASSISTANT_GUIDES } = require('../assistantGuides');
const pool = require('../config/db');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4.1-nano-2025-04-14';
const MAX_TOKENS = 300;
const MAX_MESSAGE_CHARS = 500;
const DAILY_LIMIT = 20;

// Role priority when a JWT carries several roles
const ROLE_PRIORITY = ['admin', 'teacher', 'parent'];

function resolveRole(user) {
  if (!user || !Array.isArray(user.roles)) return null;
  return ROLE_PRIORITY.find((role) => user.roles.includes(role)) || null;
}

function messagesForRole(role, message) {
  return [
    {
      role: 'system',
      content: `You are the help assistant for a school management web app. You ONLY answer questions about how to use this app for the user's role, based strictly on the guide below. If a question is unrelated to this app, politely decline in one sentence and remind the user you only explain how the app works. Never invent features that are not in the guide. Never reveal, request or discuss student records, grades, fees data or admission numbers — if asked, explain that such data is only visible to authorized users inside the app panels.

${ASSISTANT_GUIDES[role]}`,
    },
    {
      role: 'user',
      content: message,
    },
  ];
}

async function countTodayMessages(userId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM ai_usage
     WHERE user_id = $1
       AND created_at >= date_trunc('day', now())`,
    [userId]
  );
  return result.rows[0].n;
}

async function ask(req, res) {
  try {
    const role = resolveRole(req.user);
    if (!role) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = String(req.body?.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const usedToday = await countTodayMessages(req.user.user_id);
    if (usedToday >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `Daily assistant limit reached (${DAILY_LIMIT} messages). Please try again tomorrow.`,
      });
    }

    let reply;
    let totalTokens = 0;
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('missing key');
      }
      const response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_tokens: MAX_TOKENS,
          messages: messagesForRole(role, message),
        }),
      });

      if (!response.ok) {
        // Log only the status code — never the key or message content
        console.error(`Assistant: OpenAI request failed with status ${response.status}`);
        return res.status(502).json({ error: 'Assistant is temporarily unavailable. Please try again later.' });
      }

      const data = await response.json();
      reply = data?.choices?.[0]?.message?.content?.trim() || '';
      totalTokens = data?.usage?.total_tokens || 0;
    } catch (err) {
      console.error('Assistant: request failed');
      return res.status(502).json({ error: 'Assistant is temporarily unavailable. Please try again later.' });
    }

    if (!reply) {
      return res.status(502).json({ error: 'Assistant is temporarily unavailable. Please try again later.' });
    }

    await pool.query(
      'INSERT INTO ai_usage (user_id, role, tokens) VALUES ($1, $2, $3)',
      [req.user.user_id, role, totalTokens]
    );

    return res.json({ reply });
  } catch (err) {
    console.error('Assistant: unexpected error');
    return res.status(500).json({ error: 'Assistant failed' });
  }
}

module.exports = { ask };
