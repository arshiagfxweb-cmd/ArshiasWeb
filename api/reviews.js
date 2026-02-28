import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const JWT_SECRET = process.env.JWT_SECRET;

// Basic negative word filter - if these are found, it gets flagged and hidden from public
const badWords = ['scam', 'terrible', 'awful', 'trash', 'garbage', 'fake', 'worst', 'stole', 'bad'];

export default async function handler(req, res) {
  try {
    await client.connect();
    const db = client.db('arshia_gfx');
    const collection = db.collection('site_data');

    // GET: Fetch reviews
    if (req.method === 'GET') {
      const data = await collection.findOne({ _id: 'main' });
      const reviews = data?.reviews || [];
      // Only return reviews that aren't flagged as negative
      const publicReviews = reviews.filter(r => !r.flagged);
      return res.status(200).json(publicReviews);
    }

    // POST: Add a new review
    if (req.method === 'POST') {
      const cookie = req.headers.cookie || '';
      const tokenMatch = cookie.match(/auth_token=([^;]+)/);
      if (!tokenMatch) return res.status(401).json({ error: 'Must be logged in to review' });

      let user;
      try {
        user = jwt.verify(tokenMatch[1], JWT_SECRET);
      } catch (e) {
        return res.status(401).json({ error: 'Invalid session' });
      }

      const { rating, text } = req.body;
      if (!rating || !text) return res.status(400).json({ error: 'Missing rating or text' });

      // Check for negative words
      const lowerText = text.toLowerCase();
      const isFlagged = badWords.some(word => lowerText.includes(word));

      const newReview = {
        id: Date.now().toString(),
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        rating: Number(rating),
        text: text,
        date: new Date().toISOString(),
        flagged: isFlagged // If flagged, only admin sees it
      };

      await collection.updateOne(
        { _id: 'main' },
        { $push: { reviews: newReview } },
        { upsert: true }
      );

      return res.status(200).json({ success: true, review: newReview, flagged: isFlagged });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    await client.close();
  }
}