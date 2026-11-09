// "AI lesson plan": a 60-minute plan for one booked lesson.
// If ANTHROPIC_API_KEY is set on the server, Claude writes the plan. Otherwise (or if the AI is
// slow / unavailable) a smart template is used, so the feature always works in a demo.

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function templatePlan({ skill, level }) {
  const deep = level === 'advanced';
  return [
    `0–10 min · Warm-up: what does the learner already know about ${skill}? Agree on ONE goal for today.`,
    `10–25 min · Core idea: the teacher shows ${deep ? 'the key technique an expert uses' : 'the most important basic'} of ${skill}, step by step, with one clear example.`,
    `25–45 min · Practice: the learner tries it alone. The teacher watches, asks questions and gives tips.`,
    `45–55 min · Mini challenge: one small task that uses everything from today${deep ? ', a bit harder than the practice' : ''}.`,
    `55–60 min · Wrap-up: the learner explains what they learned in 3 sentences. Homework for next week, then book the next lesson.`,
  ].join('\n');
}

export async function aiPlan({ skill, level, category }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const prompt =
    `Write a 60-minute lesson plan for a peer-to-peer tutoring session between two university students.\n` +
    `Skill: ${skill} (category: ${category}). The teacher's level: ${level}. The learner is a beginner.\n` +
    `Format: exactly 5 lines, each like "0–10 min · Warm-up: ...". Concrete activities, plain text, ` +
    `no markdown, under 170 words in total.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-haiku-5-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.content?.find?.((c) => c.type === 'text')?.text?.trim();
  return text || null;
}

export const dayName = (d) => DAYS[(d - 1 + 7) % 7];
