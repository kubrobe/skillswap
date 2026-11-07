// MongoDB aggregation pipelines, kept in one file so the API, db/mongo_queries.js and the tests all use
// exactly the same code. (An aggregation pipeline is a list of stages; each stage transforms the documents.)

const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

// Average rating and number of reviews for one member
export const ratingSummary = (revieweeId) => [
  { $match: { reviewee_id: revieweeId } },
  { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
];

// How many events of each type in the last N days (search, profile_view, swap_request)
export const eventsByType = (days = 30) => [
  { $match: { ts: { $gte: daysAgo(days) } } },
  { $group: { _id: '$type', events: { $sum: 1 } } },
  { $sort: { events: -1 } },
];

// Share of activity per device
export const eventsByDevice = (days = 30) => [
  { $match: { ts: { $gte: daysAgo(days) } } },
  { $group: { _id: '$device', events: { $sum: 1 } } },
  { $sort: { events: -1 } },
];

// Cities where people search the most
export const topSearchCities = (days = 30, limit = 5) => [
  { $match: { type: 'search', ts: { $gte: daysAgo(days) } } },
  { $group: { _id: '$city', searches: { $sum: 1 } } },
  { $sort: { searches: -1 } },
  { $limit: limit },
];

// Events per day (a time series for a chart)
export const dailyEvents = (days = 14) => [
  { $match: { ts: { $gte: daysAgo(days) } } },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, events: { $sum: 1 } } },
  { $sort: { _id: 1 } },
];

// Best-rated skills (only skills with at least `minReviews` reviews, so one lucky review does not win)
export const topRatedSkills = (minReviews = 2) => [
  { $group: { _id: '$skill', average: { $avg: '$rating' }, reviews: { $sum: 1 } } },
  { $match: { reviews: { $gte: minReviews } } },
  { $sort: { average: -1, reviews: -1 } },
  { $limit: 5 },
];
