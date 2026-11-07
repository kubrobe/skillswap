// 12 MongoDB queries: 5 CRUD, 5 aggregations, 2 index/explain.   Run: npm run mongo:queries
// Every query has a comment with the business question it answers.
import 'dotenv/config';
import { mongo, closeMongo } from '../src/mongo.js';
import * as P from '../src/mongo-pipelines.js';

const db = await mongo();
if (!db) { console.error('MONGODB_URI is not set. Add it to .env first.'); process.exit(1); }
const reviews = db.collection('reviews');
const events = db.collection('activity_events');
const show = (title, data) => console.log(`\n--- ${title}\n`, JSON.stringify(data, null, 1));

// ===== CRUD (5)
// C1 CREATE. Question: a member leaves a review after a completed swap.
const r = await reviews.insertOne({ exchange_id: 999999, reviewer_id: 1, reviewee_id: 2, skill: 'JavaScript', rating: 5,
  comment: 'Test review', tags: ['clear'], created_at: new Date() });
show('C1 insertOne', { insertedId: r.insertedId });

// C2 READ. Question: what are the latest 3 reviews of member 2?
show('C2 find', await reviews.find({ reviewee_id: 2 }).sort({ created_at: -1 }).limit(3).project({ _id: 0, skill: 1, rating: 1, comment: 1 }).toArray());

// C3 UPDATE. Question: the reviewer edits their comment.
show('C3 updateOne', await reviews.updateOne({ exchange_id: 999999, reviewer_id: 1 }, { $set: { comment: 'Edited comment', edited: true } }));

// C4 READ with filter. Question: how many 5-star reviews are about mobile-friendly ("fast") teachers?
show('C4 countDocuments', await reviews.countDocuments({ rating: 5, tags: 'clear' }));

// C5 DELETE. Question: remove the test review again.
show('C5 deleteOne', await reviews.deleteOne({ exchange_id: 999999 }));

// ===== Aggregations (5)
show('A1 average rating of member 2', await reviews.aggregate(P.ratingSummary(2)).toArray());           // Question: how good is member 2?
show('A2 events by type, 30 days', await events.aggregate(P.eventsByType(30)).toArray());               // Question: what do members do most?
show('A3 events by device', await events.aggregate(P.eventsByDevice(30)).toArray());                    // Question: phones or laptops?
show('A4 top search cities', await events.aggregate(P.topSearchCities(30, 5)).toArray());               // Question: where is demand?
show('A5 best-rated skills', await reviews.aggregate(P.topRatedSkills(2)).toArray());                   // Question: which skills get the best reviews?

// ===== Index / explain (2)
const stats = async () => (await events.find({ type: 'search', ts: { $gte: new Date(Date.now() - 7 * 864e5) } }).explain('executionStats')).executionStats;
await events.dropIndex('type_1_ts_-1').catch(() => {});
const before = await stats();
show('I1 BEFORE index (COLLSCAN expected)', { docsExamined: before.totalDocsExamined, ms: before.executionTimeMillis });
await events.createIndex({ type: 1, ts: -1 });
const after = await stats();
show('I2 AFTER index (IXSCAN expected)', { docsExamined: after.totalDocsExamined, ms: after.executionTimeMillis });

await closeMongo();
