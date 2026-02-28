import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

// Admin password from environment variable (set in Vercel dashboard)
// If not set, defaults to a temporary password (change immediately in production)
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Store active sessions (in production, use Redis or database)
const sessions = new Map();

export default async function handler(req, res) {
  // FIX: Use WHATWG URL API instead of url.parse()
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { searchParams } = url;
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    await client.connect();
    const database = client.db('arshia_gfx');
    const collection = database.collection('site_data');
    
    // GET request - load data
    if (req.method === 'GET') {
      const token = searchParams.get('token');
      
      // Check if token is valid
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
          showRibbon: true,
          ribbonText: 'COMING SOON',
          title: 'ALL-IN-ONE ASSET PACK',
          price: '',
          description: 'Complete GFX Asset Collection',
          features: ['Commercial License', '50+ Thumbnails', 'Stream Overlays', 'Transition Pack'],
          status: 'coming_soon'
        },
        orders: [],
        portfolio: [],
        servicePrices: {
          logo: 20,
          pfp: 15,
          banner: 30,
          banner_pfp: 40,
          poster: 30,
          thumbnails: 20,
          bundle: 45
        }
      };
      
      return res.status(200).json({
        ...data,
        authenticated
      });
    }
    
    // POST request - save data or login
    if (req.method === 'POST') {
      const body = req.body;
      
      // Handle login
      if (body.action === 'login') {
        if (body.password === ADMIN_PASSWORD) {
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(token, {
            created: Date.now(),
            expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
          });
          
          return res.status(200).json({
            success: true,
            token
          });
        } else {
          return res.status(401).json({
            success: false,
            error: 'Incorrect password'
          });
        }
      }
      
      // Handle logout
      if (body.action === 'logout') {
        if (body.token) {
          sessions.delete(body.token);
        }
        return res.status(200).json({ success: true });
      }
      
      // Handle password change
      if (body.action === 'changePassword') {
        // Verify current session
        if (!body.token || !sessions.has(body.token)) {
          return res.status(401).json({ success: false, error: 'Not authenticated' });
        }
        
        // Verify current password
        if (body.currentPassword !== ADMIN_PASSWORD) {
          return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }
        
        // Update password (in memory - will reset on server restart)
        // For permanent storage, save to database or update environment variable
        ADMIN_PASSWORD = body.newPassword;
        
        // Invalidate all existing sessions except current
        const currentToken = body.token;
        for (const [token, session] of sessions.entries()) {
          if (token !== currentToken) {
            sessions.delete(token);
          }
        }
        
        return res.status(200).json({ success: true });
      }
      
      // Verify token for data modification
      if (!body.token || !sessions.has(body.token)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      // Save data
      if (body.action === 'saveData') {
        const data = {
          _id: 'main',
          assetPackData: body.assetPackData,
          orders: body.orders,
          portfolio: body.portfolio || [],
          servicePrices: body.servicePrices,
          lastUpdated: new Date().toISOString()
        };
        
        await collection.updateOne(
          { _id: 'main' },
          { $set: data },
          { upsert: true }
        );
        
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