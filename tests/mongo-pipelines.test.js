// Tests the MongoDB aggregation pipelines WITHOUT a MongoDB server, using `mingo`
// (a JavaScript implementation of MongoDB's aggregation engine) on the generated synthetic documents.
// This checks the pipeline logic. It does NOT check the connection to a real MongoDB server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from 'mingo';
import * as P from '../src/mongo-pipelines.js';
import { makeActivityEvents, makeReviews } from '../db/mongo_data.js';

const events = makeActivityEvents(12000);
const reviews = makeReviews(40);

test('generated data matches the course minimum (>= 10,000 documents)', () => {
  assert.ok(events.length >= 10000);
  assert.ok(reviews.length > 0);
});

test('events by type: counts add up to the events in the window', () => {
  const rows = aggregate(events, P.eventsByType(60));
  assert.equal(rows.reduce((s, r) => s + r.events, 0), events.length);   // generator spreads events over 60 days
  assert.deepEqual(rows.map((r) => r._id).sort(), ['profile_view', 'search', 'swap_request']);
  assert.ok(rows[0].events >= rows[1].events);                           // sorted, biggest first
});

test('events by device and top cities', () => {
  const dev = aggregate(events, P.eventsByDevice(60));
  assert.equal(dev[0]._id, 'mobile');                                    // phones dominate by design
  const cities = aggregate(events, P.topSearchCities(60, 5));
  assert.equal(cities.length, 5);
  assert.ok(cities.every((c, i) => i === 0 || cities[i - 1].searches >= c.searches));
});

test('rating summary equals a hand calculation', () => {
  const mine = reviews.filter((r) => r.reviewee_id === 3);
  const [row] = aggregate(reviews, P.ratingSummary(3));
  const expected = mine.reduce((s, r) => s + r.rating, 0) / mine.length;
  assert.equal(row.count, mine.length);
  assert.ok(Math.abs(row.average - expected) < 1e-9);
});

test('top rated skills only include skills with enough reviews', () => {
  const rows = aggregate(reviews, P.topRatedSkills(2));
  assert.ok(rows.length > 0 && rows.every((r) => r.reviews >= 2));
});

test('daily events: one row per day, dates sorted', () => {
  const rows = aggregate(events, P.dailyEvents(14));
  assert.ok(rows.length >= 13 && rows.length <= 15);
  assert.deepEqual(rows.map((r) => r._id), rows.map((r) => r._id).sort());
});
