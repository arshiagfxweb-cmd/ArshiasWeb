import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const JWT_SECRET = process.env.JWT_SECRET;

const REVIEW_WEBHOOK_URL = "https://discord.com/api/webhooks/1477448069610995885/TmI4TUl7e8rR19KAFRqI95U4i58Sn5GaKTbo7yIu1EZe36MfhhRQqMr0KE5VLRI0vSTO";
const badWords = ['scam', 'terrible', 'awful', 'trash', 'garbage', 'fake', 'worst', 'stole', 'bad', 'horrible', 'begs', 'slop', 'shit', 'fuck', 'nigger', 'nigga', 'bitch', 'cunt', 'asshole', 'dick', 'pussy', 'slut', 'whore', 'bastard', 'retard', 'faggot'];

export default async function handler(req, res) {
  try {
    await client.connect();
    const db = client.db('arshia_gfx');
    const collection = db.collection('site_data');

    if (req.method === 'POST' || req.method === 'DELETE') {
        if (typeof req.body === 'string') {
            try { req.body = JSON.parse(req.body); } catch(e) {}
        }
    }

    if (req.method === 'GET') {
      const data = await collection.findOne({ _id: 'main' });
      const reviews = data?.reviews || [];
      const publicReviews = reviews.filter(r => !r.flagged);
      return res.status(200).json(publicReviews);
    }

    if (req.method === 'DELETE') {
      const cookie = req.headers.cookie || '';
      const tokenMatch = cookie.match(/auth_token=([^;]+)/);
      if (!tokenMatch) return res.status(401).json({ error: 'Must be logged in to delete' });

      let user;
      try {
        user = jwt.verify(tokenMatch[1], JWT_SECRET);
      } catch (e) { return res.status(401).json({ error: 'Invalid session' }); }

      const { reviewId } = req.body;
      if (!reviewId) return res.status(400).json({ error: 'Missing review ID' });

      const data = await collection.findOne({ _id: 'main' });
      if (!data || !data.reviews) return res.status(404).json({ error: 'No reviews found' });

      const review = data.reviews.find(r => String(r.id) === String(reviewId));
      if (!review) return res.status(404).json({ error: 'Review not found' });
      
      if (review.userId !== user.id) return res.status(403).json({ error: 'Not authorized to delete this review' });

      await collection.updateOne({ _id: 'main' }, { $pull: { reviews: { id: reviewId } } });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST') {
      const cookie = req.headers.cookie || '';
      const tokenMatch = cookie.match(/auth_token=([^;]+)/);
      if (!tokenMatch) return res.status(401).json({ error: 'Must be logged in to interact' });

      let user;
      try {
        user = jwt.verify(tokenMatch[1], JWT_SECRET);
      } catch (e) { return res.status(401).json({ error: 'Invalid session' }); }

      const { action, reviewId, rating, text } = req.body;

      if (action === 'like') {
        if (!reviewId) return res.status(400).json({ error: 'Missing review ID' });
        
        const data = await collection.findOne({ _id: 'main' });
        if (!data || !data.reviews) return res.status(404).json({ error: 'Database empty' });
        
        const reviewIndex = data.reviews.findIndex(r => String(r.id) === String(reviewId));
        if (reviewIndex === -1) return res.status(404).json({ error: 'Review not found' });
        
        const review = data.reviews[reviewIndex];
        let likes = review.likes || [];
        
        if (likes.includes(user.id)) {
          likes = likes.filter(id => id !== user.id);
        } else {
          likes.push(user.id);
        }

        await collection.updateOne({ _id: 'main' }, { $set: { [`reviews.${reviewIndex}.likes`]: likes } });
        return res.status(200).json({ success: true, likes });
      }

      if (action === 'comment') {
        if (!reviewId || !text || text.length > 500) return res.status(400).json({ error: 'Invalid comment' });
        
        const lowerText = text.toLowerCase();
        if (badWords.some(word => lowerText.includes(word))) {
            return res.status(400).json({ error: 'Comment contains flagged words' });
        }

        const data = await collection.findOne({ _id: 'main' });
        if (!data || !data.reviews) return res.status(404).json({ error: 'Database empty' });

        const reviewIndex = data.reviews.findIndex(r => String(r.id) === String(reviewId));
        if (reviewIndex === -1) return res.status(404).json({ error: 'Review not found' });

        const newComment = {
          id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
          userId: user.id, username: user.username, avatar: user.avatar,
          text: text, date: new Date().toISOString()
        };

        await collection.updateOne({ _id: 'main' }, { $push: { [`reviews.${reviewIndex}.comments`]: newComment } });
        return res.status(200).json({ success: true, comment: newComment });
      }

      // CREATE NEW REVIEW
      if (!rating || !text || text.length > 2000) return res.status(400).json({ error: 'Invalid review format' });

      const lowerText = text.toLowerCase();
      const isFlagged = badWords.some(word => lowerText.includes(word));

      const newReview = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
        userId: user.id, username: user.username, avatar: user.avatar,
        rating: Number(rating), text: text, date: new Date().toISOString(), flagged: isFlagged,
        likes: [], comments: []
      };

      await collection.updateOne({ _id: 'main' }, { $push: { reviews: newReview } }, { upsert: true });

      try {
        const starDisplay = '★'.repeat(Number(rating)) + '☆'.repeat(5 - Number(rating));
        await fetch(REVIEW_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '@everyone 🌟 **NEW CLIENT REVIEW SUBMITTED!**',
            embeds: [{
              title: '📝 Feedback Logged',
              color: isFlagged ? 0xDC2626 : 0xFFD700,
              thumbnail: { url: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png' },
              fields: [
                { name: '👤 Client', value: `\`${user.username}\``, inline: true },
                { name: '⭐ Rating', value: starDisplay, inline: true },
                { name: '🛡️ Status', value: isFlagged ? '⚠️ **FLAGGED (Hidden)**' : '✅ **PUBLIC**', inline: true },
                { name: '💬 Review Text', value: `>>> ${text.substring(0, 1024)}` }
              ],
              footer: { text: "Arshia GFX Automated System" },
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch (webhookErr) { console.error('Discord webhook failed', webhookErr); }

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