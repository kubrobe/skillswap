// "AI matchmaker": the user says (or types) what they want to learn, in English, Uzbek or Russian,
// and gets the 3 best lessons with a reason for each.
// With ANTHROPIC_API_KEY set, Claude reads the request and picks from the real offers.
// Without it (or if the AI is slow), a keyword matcher in three languages does the same job,
// so the feature always works in a demo.

// Words people use for each skill (lower case; Cyrillic and Uzbek stems match inside longer words).
const SKILL_WORDS = [
  ['Python basics', ['python', 'pyton', 'питон', 'пайтон']],
  ['Web development (HTML/CSS)', ['html', 'css', 'website', 'web dev', 'sayt', 'veb', 'сайт', 'веб']],
  ['SQL and databases', ['sql', 'database', 'baza', 'ma\'lumotlar', 'база данных', 'баз данных']],
  ['JavaScript', ['javascript', 'java script', 'джаваскрипт', 'react']],
  ['Excel and data analysis', ['excel', 'spreadsheet', 'data analysis', 'эксел', 'таблиц']],
  ['English conversation', ['english', 'speaking', 'ingliz', 'английск', 'разговорн']],
  ['IELTS writing', ['ielts', 'айелтс', 'essay', 'esse', 'эссе']],
  ['Korean for beginners', ['korean', 'koreys', 'корейск', 'hangul', 'topik']],
  ['Russian', ['russian', 'rus tili', 'ruscha', 'русск']],
  ['UI design in Figma', ['figma', 'ui design', 'ux', 'dizayn', 'дизайн', 'фигм']],
  ['Photo editing', ['photo', 'photoshop', 'lightroom', 'foto', 'surat', 'фото']],
  ['Video editing', ['video', 'montaj', 'capcut', 'premiere', 'видео', 'монтаж']],
  ['Guitar', ['guitar', 'gitara', 'гитар']],
  ['Piano', ['piano', 'pianino', 'пианино', 'фортепиан']],
  ['Gym training basics', ['gym', 'fitness', 'workout', 'sport zal', 'trenajor', 'mashq', 'спортзал', 'тренировк', 'фитнес']],
  ['Chess', ['chess', 'shaxmat', 'шахмат']],
  ['Running for beginners', ['running', 'jogging', 'yugur', 'бег ', 'бегать', 'пробеж']],
  ['Public speaking', ['public speaking', 'speech', 'notiq', 'nutq', 'ораторск', 'выступ']],
  ['Presentation design', ['presentation', 'slides', 'powerpoint', 'taqdimot', 'презентац']],
  ['Academic writing', ['academic', 'thesis', 'research paper', 'ilmiy', 'akademik', 'академическ', 'научн']],
  ['Cooking plov', ['plov', 'pilaf', 'palov', 'osh ', 'cooking', 'oshpaz', 'плов', 'готовить']],
  ['Baking', ['baking', 'cake', 'pishiriq', 'tort', 'выпечк', 'торт']],
  ['Calligraphy', ['calligraphy', 'xattot', 'каллиграф']],
];

// Words for a whole category, used when no single skill is named ("something with music").
const CATEGORY_WORDS = [
  ['Programming', ['programming', 'coding', 'code', 'dasturlash', 'программирован']],
  ['Languages', ['language', 'chet tili', 'язык']],
  ['Design', ['design', 'dizayn', 'дизайн']],
  ['Music', ['music', 'musiqa', 'музык']],
  ['Fitness & Sport', ['sport', 'спорт']],
  ['Business & Study', ['study', 'university', 'o\'qish', 'учеб']],
  ['Cooking & Crafts', ['cook', 'ovqat', 'кухн', 'готов']],
];

const TIME_WORDS = {
  weekend: ['weekend', 'saturday', 'sunday', 'dam olish', 'shanba', 'yakshanba', 'выходн', 'суббот', 'воскрес'],
  evening: ['evening', 'after class', 'after work', 'kechqurun', 'kechki', 'вечер'],
  morning: ['morning', 'ertalab', 'утр'],
};

const fits = { weekend: (d) => d >= 6, evening: (d, h) => h >= 17, morning: (d, h) => h < 12 };

// Reason phrases in the three app languages.
const SAY = {
  en: { teaches: (s) => `Teaches ${s}`, weekend: 'free on weekends', evening: 'free in the evening', morning: 'free in the morning',
        swap: (s) => `wants your ${s} — a two-way swap`, rating: (r) => `★ ${r}`, popular: 'Popular with students', newT: 'new teacher' },
  uz: { teaches: (s) => `${s} oʻrgatadi`, weekend: 'dam olish kunlari boʻsh', evening: 'kechqurun boʻsh', morning: 'ertalab boʻsh',
        swap: (s) => `sizdan ${s} oʻrganmoqchi — ikki tomonlama almashuv`, rating: (r) => `★ ${r}`, popular: 'Talabalar orasida mashhur', newT: 'yangi ustoz' },
  ru: { teaches: (s) => `Учит: ${s}`, weekend: 'свободен в выходные', evening: 'свободен вечером', morning: 'свободен утром',
        swap: (s) => `хочет ваш навык «${s}» — взаимный обмен`, rating: (r) => `★ ${r}`, popular: 'Популярно у студентов', newT: 'новый учитель' },
};

const normalize = (text) =>
  ` ${String(text).toLowerCase().replace(/[ʻʼ’`‘]/g, '\'').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ')} `;

/** What the request asks for: skills, categories and a time of the week. */
export function understand(text) {
  const t = normalize(text);
  const has = (w) => t.includes(w.length <= 4 && /^[a-z]/.test(w) ? ` ${w.trim()} ` : w);
  const skills = SKILL_WORDS.filter(([, words]) => words.some(has)).map(([name]) => name);
  const categories = skills.length ? [] : CATEGORY_WORDS.filter(([, words]) => words.some(has)).map(([name]) => name);
  const time = Object.keys(TIME_WORDS).find((k) => TIME_WORDS[k].some(has)) || null;
  return { skills, categories, time };
}

/** The keyword matcher: scores every offer and explains the top 3 in the user's language. */
export function rankOffers(offers, wish, lang = 'en') {
  const say = SAY[lang] || SAY.en;
  const asked = wish.skills.length > 0 || wish.categories.length > 0;
  const scored = offers.map((o) => {
    const timeOk = wish.time ? o.days.some((d, i) => fits[wish.time](d, o.hours[i])) : false;
    let score = Number(o.rating) * 0.6 + Math.min(o.reviews, 5) * 0.2;
    if (wish.skills.includes(o.skill)) score += 10;
    if (wish.categories.includes(o.category)) score += 4;
    if (o.theyWant) score += 3;
    if (wish.time) score += timeOk ? 3 : -2;
    const parts = [asked ? say.teaches(o.skill) : say.popular];
    if (timeOk) parts.push(say[wish.time]);
    if (o.theyWant) parts.push(say.swap(o.theyWant));
    parts.push(o.reviews > 0 ? say.rating(o.rating) : say.newT);
    return { offerId: o.offerId, score, reason: parts.join(' · ') };
  });
  const relevant = asked ? scored.filter((s) => s.score >= 8) : scored;
  return (relevant.length ? relevant : scored).sort((a, b) => b.score - a.score).slice(0, 3)
    .map(({ offerId, reason }) => ({ offerId, reason }));
}

/** Claude picks from the real offers. Returns null when there is no key or anything goes wrong. */
export async function aiMatch({ text, lang, offers }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || offers.length === 0) return null;
  const language = { en: 'English', uz: 'Uzbek (Latin script)', ru: 'Russian' }[lang] || 'English';
  const list = offers.slice(0, 80).map((o) =>
    `${o.offerId} | ${o.skill} (${o.category}) | teacher ${o.teacher} | ${o.level} | rating ${o.rating} from ${o.reviews} reviews | ` +
    `free: ${o.days.map((d, i) => `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]} ${o.hours[i]}:00`).join(', ')}` +
    (o.theyWant ? ` | wants to learn ${o.theyWant} from this student` : '')).join('\n');
  const prompt =
    `A university student wants to learn something. Their words: "${String(text).slice(0, 300)}"\n\n` +
    `Lessons available (id | skill | teacher | level | rating | free weekly times | swap):\n${list}\n\n` +
    `Pick the 1 to 3 lessons that fit best (skill first, then time of the week, then a two-way swap, then rating). ` +
    `Answer ONLY with JSON: {"understood": "<what they want, a few words>", "picks": [{"offerId": <id>, "reason": "<one short line>"}]}. ` +
    `Write "understood" and every "reason" in ${language}. Use only ids from the list.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-5-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.content?.find?.((c) => c.type === 'text')?.text || '';
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const ids = new Set(offers.map((o) => o.offerId));
    const picks = (json.picks || [])
      .filter((p) => ids.has(Number(p.offerId)) && typeof p.reason === 'string')
      .slice(0, 3)
      .map((p) => ({ offerId: Number(p.offerId), reason: p.reason.slice(0, 160) }));
    return picks.length ? { picks, understood: String(json.understood || '').slice(0, 80) } : null;
  } catch {
    return null;
  }
}
