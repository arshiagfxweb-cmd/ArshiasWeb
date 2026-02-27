import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('ERROR: MONGODB_URI not set!');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Default password: ArshiaGFX2024!
const DEFAULT_PASSWORD_HASH = hashPassword('ArshiaGFX2024!');

let cachedClient = null;
let cachedDb = null;

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
        if (session && new Date(session.expiresAt) > new Date()) {
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
      const { action, password, token, currentPassword, newPassword, assetPackData, orders, servicePrices } = req.body;
      
      if (action === 'login') {
        const stored = await config.findOne({ key: 'admin_password' });
        const validHash = stored ? stored.value : DEFAULT_PASSWORD_HASH;
        const inputHash = hashPassword(password);
        
        if (inputHash !== validHash) {
          return res.status(401).json({ success: false, error: 'Wrong password' });
        }
        
        const newToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        await config.updateOne(
          { key: 'session' },
          { $set: { token: newToken, expiresAt, createdAt: new Date() } },
          { upsert: true }
        );
        
        return res.json({ success: true, token: newToken });
      }
      
      if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
      }
      
      const session = await config.findOne({ key: 'session', token });
      if (!session || new Date(session.expiresAt) < new Date()) {
        return res.status(401).json({ success: false, error: 'Session expired' });
      }
      
      if (action === 'changePassword') {
        const stored = await config.findOne({ key: 'admin_password' });
        const currentHash = stored ? stored.value : DEFAULT_PASSWORD_HASH;
        
        if (hashPassword(currentPassword) !== currentHash) {
          return res.status(401).json({ success: false, error: 'Current password incorrect' });
        }
        
        await config.updateOne(
          { key: 'admin_password' },
          { $set: { value: hashPassword(newPassword), updatedAt: new Date() } },
          { upsert: true }
        );
        
        return res.json({ success: true });
      }
      
      if (action === 'saveData') {
        await data.updateOne(
          { key: 'site_data' },
          { $set: { assetPackData, orders, servicePrices, updatedAt: new Date() } },
          { upsert: true }
        );
        
        return res.json({ success: true });
      }
      
      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error.message);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}