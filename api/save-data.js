import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const uri = process.env.MONGODB_URI;
let cachedClient = null;
let cachedDb = null;

// SECURE: Default strong password - CHANGE THIS AFTER FIRST LOGIN
const DEFAULT_PASSWORD = 'Arsh!aGFX#2024$Secure@Admin%9xQ7mK2pL5vN';

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }
  
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('arshia_gfx');
  
  cachedClient = client;
  cachedDb = db;
  
  return { client, db };
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { db } = await connectToDatabase();
    const config = db.collection('config');
    const data = db.collection('data');

    if (req.method === 'GET') {
      const { token } = req.query;
      
      let authenticated = false;
      if (token) {
        const session = await config.findOne({ key: 'session', token });
        if (session && session.expiresAt > new Date()) {
          authenticated = true;
        }
      }
      
      const siteData = await data.findOne({ key: 'site_data' }) || {};
      
      return res.json({
        authenticated,
        orders: siteData.orders || [],
        assetPackData: siteData.assetPackData || null,
        servicePrices: siteData.servicePrices || null
      });
    }

    if (req.method === 'POST') {
      const { action } = req.body;
      
      if (action === 'login') {
        const { password } = req.body;
        
        const stored = await config.findOne({ key: 'admin_password' });
        const currentPasswordHash = stored ? stored.value : hashPassword(DEFAULT_PASSWORD);
        
        if (hashPassword(password) !== currentPasswordHash) {
          return res.status(401).json({ success: false, error: 'Wrong password' });
        }
        
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        await config.updateOne(
          { key: 'session' },
          { $set: { token, expiresAt, createdAt: new Date() } },
          { upsert: true }
        );
        
        return res.json({ success: true, token });
      }
      
      if (action === 'changePassword') {
        const { currentPassword, newPassword, token } = req.body;
        
        const session = await config.findOne({ key: 'session', token });
        if (!session || session.expiresAt < new Date()) {
          return res.status(401).json({ success: false, error: 'Session expired' });
        }
        
        const stored = await config.findOne({ key: 'admin_password' });
        const currentPasswordHash = stored ? stored.value : hashPassword(DEFAULT_PASSWORD);
        
        if (hashPassword(currentPassword) !== currentPasswordHash) {
          return res.status(401).json({ success: false, error: 'Current password incorrect' });
        }
        
        if (newPassword.length < 12) {
          return res.status(400).json({ success: false, error: 'Password must be at least 12 characters' });
        }
        
        await config.updateOne(
          { key: 'admin_password' },
          { $set: { value: hashPassword(newPassword), updatedAt: new Date() } },
          { upsert: true }
        );
        
        return res.json({ success: true });
      }
      
      if (action === 'saveData') {
        const { token, assetPackData, orders, servicePrices } = req.body;
        
        const session = await config.findOne({ key: 'session', token });
        if (!session || session.expiresAt < new Date()) {
          return res.status(401).json({ success: false, error: 'Session expired' });
        }
        
        await data.updateOne(
          { key: 'site_data' },
          { 
            $set: { 
              assetPackData, 
              orders, 
              servicePrices,
              updatedAt: new Date() 
            } 
          },
          { upsert: true }
        );
        
        return res.json({ success: true });
      }
      
      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}