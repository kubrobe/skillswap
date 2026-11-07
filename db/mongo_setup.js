// Creates the MongoDB collections and fills them with synthetic data.
//   1. Put MONGODB_URI in .env (local: mongodb://127.0.0.1:27017  or an Atlas connection string)
//   2. npm run mongo:setup
// Collections: reviews (40 documents) and activity_events (12,000 documents).
import 'dotenv/config';
import { mongo, closeMongo } from '../src/mongo.js';
import { makeActivityEvents, makeReviews } from './mongo_data.js';

const db = await mongo();
if (!db) { console.error('MONGODB_URI is not set. Add it to .env first.'); process.exit(1); }

await db.collection('reviews').drop().catch(() => {});
await db.collection('activity_events').drop().catch(() => {});

await db.collection('reviews').insertMany(makeReviews(40));
await db.collection('activity_events').insertMany(makeActivityEvents(12000));

// One review per person per exchange; fast lookup of a member's reviews
await db.collection('reviews').createIndex({ exchange_id: 1, reviewer_id: 1 }, { unique: true });
await db.collection('reviews').createIndex({ reviewee_id: 1, created_at: -1 });

console.log('reviews:         ', await db.collection('reviews').countDocuments());
console.log('activity_events: ', await db.collection('activity_events').countDocuments());
await closeMongo();
