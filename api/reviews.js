import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const JWT_SECRET = process.env.JWT_SECRET;

const REVIEW_WEBHOOK_URL = "https://discord.com/api/webhooks/1477448069610995885/TmI4TUl7e8rR19KAFRqI95U4i58Sn5GaKTbo7yIu1EZe36MfhhRQqMr0KE5VLRI0vSTO";
const badWords = ['scam', 'terrible', 'awful', 'trash', 'garbage', 'fake', 'worst', 'stole', 'bad'];

export default async function handler(req, res) {
  try {
    await client.connect();
    const db = client.db('arshia_gfx');
    const collection = db.collection('site_data');

    if (req.method === 'GET') {
      const data = await collection.findOne({ _id: 'main' });
      const reviews = data?.reviews || [];
      const publicReviews = reviews.filter(r => !r.flagged);
      return res.status(200).json(publicReviews);
    }

    if (req.method === 'POST') {
      const cookie = req.headers.cookie || '';
      const tokenMatch = cookie.match(/auth_token=([^;]+)/);
      if (!tokenMatch) return res.status(401).json({ error: 'Must be logged in to review' });

      let user;
      try {
        user = jwt.verify(tokenMatch[1], JWT_SECRET);
      } catch (e) { return res.status(401).json({ error: 'Invalid session' }); }

      const { rating, text } = req.body;
      if (!rating || !text) return res.status(400).json({ error: 'Missing rating or text' });

      const lowerText = text.toLowerCase();
      const isFlagged = badWords.some(word => lowerText.includes(word));

      const newReview = {
        id: Date.now().toString(),
        userId: user.id, username: user.username, avatar: user.avatar,
        rating: Number(rating), text: text, date: new Date().toISOString(), flagged: isFlagged
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