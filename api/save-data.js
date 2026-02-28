import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const sessions = new Map();

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { searchParams } = url;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    await client.connect();
    const database = client.db('arshia_gfx');
    const collection = database.collection('site_data');
    
    if (req.method === 'GET') {
      const token = searchParams.get('token');
      let authenticated = false;
      if (token && sessions.has(token)) {
        const session = sessions.get(token);
        if (session.expires > Date.now()) {
          authenticated = true;
        } else {
          sessions.delete(token);
        }
      }
      
      const data = await collection.findOne({ _id: 'main' }) || {
        assetPackData: {
          showRibbon: true, ribbonText: 'COMING SOON', title: 'ALL-IN-ONE ASSET PACK',
          price: '', description: 'Complete GFX Asset Collection',
          features: ['Commercial License', '50+ Thumbnails', 'Stream Overlays', 'Transition Pack'],
          status: 'coming_soon'
        },
        orders: [], portfolio: [], reviews: [],
        servicePrices: { logo: 20, pfp: 15, banner: 30, banner_pfp: 40, poster: 30, thumbnails: 20, bundle: 45 }
      };
      
      return res.status(200).json({ ...data, authenticated });
    }
    
    if (req.method === 'POST') {
      const body = req.body;
      
      if (body.action === 'login') {
        if (body.password === ADMIN_PASSWORD) {
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(token, { created: Date.now(), expires: Date.now() + (24 * 60 * 60 * 1000) });
          return res.status(200).json({ success: true, token });
        } else {
          return res.status(401).json({ success: false, error: 'Incorrect password' });
        }
      }
      
      if (body.action === 'logout') {
        if (body.token) sessions.delete(body.token);
        return res.status(200).json({ success: true });
      }
      
      if (body.action === 'changePassword') {
        if (!body.token || !sessions.has(body.token)) return res.status(401).json({ success: false, error: 'Not authenticated' });
        if (body.currentPassword !== ADMIN_PASSWORD) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        ADMIN_PASSWORD = body.newPassword;
        const currentToken = body.token;
        for (const [token, session] of sessions.entries()) {
          if (token !== currentToken) sessions.delete(token);
        }
        return res.status(200).json({ success: true });
      }
      
      if (!body.token || !sessions.has(body.token)) return res.status(401).json({ error: 'Unauthorized' });
      
      if (body.action === 'saveData') {
        const data = {
          _id: 'main',
          assetPackData: body.assetPackData,
          orders: body.orders,
          portfolio: body.portfolio || [],
          reviews: body.reviews || [], // Added reviews support
          servicePrices: body.servicePrices,
          lastUpdated: new Date().toISOString()
        };
        
        await collection.updateOne({ _id: 'main' }, { $set: data }, { upsert: true });
        return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    await client.close();
  }
}