// Optional MongoDB connection. SkillSwap works without it: if MONGODB_URI is not set,
// the Mongo features (reviews, activity statistics) are simply switched off.
//
// Why two databases? PostgreSQL holds the data with strict rules (users, skills, exchanges).
// MongoDB holds flexible, high-volume data: reviews and activity events (many documents, no joins needed).
import { MongoClient } from 'mongodb';

let client = null;
let db = null;

export const mongoEnabled = () => Boolean(process.env.MONGODB_URI);

export async function mongo() {
  if (!mongoEnabled()) return null;
  if (!db) {
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'skillswap');
  }
  return db;
}

export async function closeMongo() {
  if (client) await client.close();
  client = db = null;
}
