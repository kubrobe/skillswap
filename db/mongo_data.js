// Generates SYNTHETIC documents for MongoDB (random, not real people). Used by mongo_setup.js and the tests.
const CITIES = ['Tashkent', 'Samarkand', 'Bukhara', 'Khiva', 'Fergana', 'Namangan', 'Andijan', 'Nukus'];
const SKILLS = ['Python basics', 'Web development (HTML/CSS)', 'SQL and databases', 'JavaScript', 'English conversation',
  'Korean for beginners', 'Guitar', 'Chess', 'Public speaking', 'UI design in Figma', 'Cooking plov', 'IELTS writing'];
const COMMENTS = ['Clear explanations, very patient.', 'Great session, learned a lot.', 'Well prepared and friendly.',
  'Good, but we ran out of time.', 'Helpful examples.', 'Would swap again.', 'A bit fast for a beginner.'];
const TAGS = ['patient', 'clear', 'friendly', 'on-time', 'well-prepared', 'fast'];

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

// Simple seeded random generator so results are repeatable (same seed -> same documents)
export function seeded(seed = 42) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export function makeActivityEvents(n = 12000, now = Date.now(), rnd = seeded(7)) {
  const types = ['search', 'search', 'search', 'profile_view', 'profile_view', 'swap_request'];
  const devices = ['mobile', 'mobile', 'mobile', 'desktop', 'tablet'];
  return Array.from({ length: n }, () => ({
    user_id: 1 + Math.floor(rnd() * 10),
    type: pick(types, rnd),
    skill: pick(SKILLS, rnd),
    city: pick(CITIES, rnd),
    device: pick(devices, rnd),
    ts: new Date(now - rnd() * 60 * 24 * 3600 * 1000),
    synthetic: true,
  }));
}

export function makeReviews(n = 40, now = Date.now(), rnd = seeded(11)) {
  return Array.from({ length: n }, (_, i) => {
    const reviewer = 1 + Math.floor(rnd() * 10);
    let reviewee = 1 + Math.floor(rnd() * 10);
    if (reviewee === reviewer) reviewee = (reviewee % 10) + 1;
    return {
      exchange_id: 100000 + i,                   // fake ids so the unique index (exchange, reviewer) holds
      reviewer_id: reviewer,
      reviewee_id: reviewee,
      skill: pick(SKILLS, rnd),
      rating: 3 + Math.floor(rnd() * 3),         // 3..5
      comment: pick(COMMENTS, rnd),
      tags: [pick(TAGS, rnd), pick(TAGS, rnd)].filter((t, k, a) => a.indexOf(t) === k),
      created_at: new Date(now - rnd() * 45 * 24 * 3600 * 1000),
      synthetic: true,
    };
  });
}
