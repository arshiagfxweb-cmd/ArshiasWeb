import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const sessions = new Map();

// The webhook URL you provided for Admin Alerts
const ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/1477448297026158723/MXsdQW3CE7CKwSyAZqL0MeGSqPdDMQwxCoXy-_ly3rhC21g6JozC6SsWeK30RCaTphCs";

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
      
      // ADMIN LOGIN WITH WEBHOOK ALERTS
      if (body.action === 'login') {
        const discordUser = body.discordUser || 'Unknown User';

        if (body.password === ADMIN_PASSWORD) {
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(token, { created: Date.now(), expires: Date.now() + (24 * 60 * 60 * 1000) });
          
          // SUCCESS WEBHOOK
          try {
            await fetch(ALERT_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                embeds: [{
                  title: '🔓 SYSTEM UNLOCKED: ADMIN ACCESS',
                  description: 'A user has successfully authenticated into the Master Admin Panel.',
                  color: 0x22C55E, // Green
                  fields: [
                    { name: '👤 Discord Account', value: `\`${discordUser}\``, inline: true },
                    { name: '⚡ Action', value: 'Master Panel Granted', inline: true }
                  ],
                  timestamp: new Date().toISOString()
                }]
              })
            });
          } catch(e) {}

          return res.status(200).json({ success: true, token });
        } else {
          // FAILURE WEBHOOK (Someone guessed wrong!)
          try {
            await fetch(ALERT_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                embeds: [{
                  title: '🚨 SECURITY ALERT: UNAUTHORIZED ACCESS ATTEMPT',
                  description: 'Someone attempted to log into the Admin Panel with an **incorrect password**.',
                  color: 0xDC2626, // Red
                  fields: [
                    { name: '👤 Suspect Discord Account', value: `\`${discordUser}\``, inline: true },
                    { name: '⚠️ Status', value: 'Access Denied', inline: true }
                  ],
                  timestamp: new Date().toISOString()
                }]
              })
            });
          } catch(e) {}

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
          reviews: body.reviews || [],
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