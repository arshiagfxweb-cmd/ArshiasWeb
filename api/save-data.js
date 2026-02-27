import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const uri = process.env.MONGODB_URI;

// DEBUG: Log URI status
console.log('MONGODB_URI exists:', !!uri);
console.log('MONGODB_URI length:', uri ? uri.length : 0);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

const DEFAULT_PASSWORD_HASH = hashPassword('ArshiaGFX2024!');

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000;

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

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
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

    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (req.method === 'GET') {
      const { token } = req.query;
      
      let authenticated = false;
      if (token) {
        const session = await config.findOne({ key: 'session', token });
        if (session && new Date(session.expiresAt) > new Date() && !session.revoked) {
          authenticated = true;
        }
      }
      
      const siteData = await data.findOne({ key: 'site_data' }) || {};
      
      // DEBUG: Log what we're sending
      console.log('GET request - portfolio items count:', (siteData.portfolio || []).length);
      
      return res.json({
        authenticated,
        orders: siteData.orders || [],
        portfolio: siteData.portfolio || [],
        assetPackData: siteData.assetPackData || null,
        servicePrices: siteData.servicePrices || null
      });
    }

    if (req.method === 'POST') {
      const { action, password, token, currentPassword, newPassword, assetPackData, orders, portfolio, servicePrices } = req.body;
      
      // DEBUG: Log incoming data
      console.log('POST request - action:', action);
      console.log('POST request - portfolio received:', portfolio ? portfolio.length : 'undefined');
      if (portfolio && portfolio.length > 0) {
        console.log('First portfolio item:', JSON.stringify(portfolio[0]));
      }
      
      if (action === 'login') {
        const attempts = loginAttempts.get(clientIp);
        if (attempts && attempts.count >= MAX_ATTEMPTS) {
          if (Date.now() - attempts.lastAttempt < LOCKOUT_TIME) {
            const remaining = Math.ceil((LOCKOUT_TIME - (Date.now() - attempts.lastAttempt)) / 60000);
            return res.status(429).json({ success: false, error: `Too many attempts. Try again in ${remaining} minutes.` });
          } else {
            loginAttempts.delete(clientIp);
          }
        }

        const stored = await config.findOne({ key: 'admin_password' });
        const validHash = stored ? stored.value : DEFAULT_PASSWORD_HASH;
        const inputHash = hashPassword(password);
        
        if (inputHash !== validHash) {
          const currentAttempts = loginAttempts.get(clientIp) || { count: 0, lastAttempt: Date.now() };
          currentAttempts.count++;
          currentAttempts.lastAttempt = Date.now();
          loginAttempts.set(clientIp, currentAttempts);
          
          const remaining = MAX_ATTEMPTS - currentAttempts.count;
          return res.status(401).json({ success: false, error: `Wrong password. ${remaining} attempts remaining.` });
        }
        
        loginAttempts.delete(clientIp);
        
        const newToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        await config.updateOne(
          { key: 'session' },
          { $set: { token: newToken, expiresAt, createdAt: new Date(), revoked: false } },
          { upsert: true }
        );
        
        return res.json({ success: true, token: newToken });
      }
      
      if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
      }
      
      const session = await config.findOne({ key: 'session', token });
      if (!session || new Date(session.expiresAt) < new Date() || session.revoked) {
        return res.status(401).json({ success: false, error: 'Session expired' });
      }
      
      if (action === 'changePassword') {
        const stored = await config.findOne({ key: 'admin_password' });
        const currentHash = stored ? stored.value : DEFAULT_PASSWORD_HASH;
        
        if (hashPassword(currentPassword) !== currentHash) {
          return res.status(401).json({ success: false, error: 'Current password incorrect' });
        }
        
        if (!newPassword || newPassword.length < 6) {
          return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }
        
        await config.updateOne(
          { key: 'admin_password' },
          { $set: { value: hashPassword(newPassword), updatedAt: new Date() } },
          { upsert: true }
        );
        
        await config.updateMany(
          { key: 'session', token: { $ne: token } },
          { $set: { revoked: true } }
        );
        
        return res.json({ success: true });
      }
      
      if (action === 'saveData') {
        // DEBUG: Log what we're saving
        console.log('Saving data...');
        console.log('Orders count:', orders ? orders.length : 0);
        console.log('Portfolio count:', portfolio ? portfolio.length : 0);
        
        const sanitizedOrders = (orders || []).map(order => ({
          ...order,
          discord: sanitize(order.discord),
          email: sanitize(order.email),
          description: sanitize(order.description),
          references: sanitize(order.references || '')
        }));

        const sanitizedPortfolio = (portfolio || []).map(item => ({
          url: sanitize(item.url),
          category: sanitize(item.category),
          title: sanitize(item.title || 'New Work'),
          id: item.id || Date.now() + Math.random()
        }));

        // DEBUG: Log after sanitization
        console.log('Sanitized portfolio:', sanitizedPortfolio.length, 'items');

        const result = await data.updateOne(
          { key: 'site_data' },
          { 
            $set: { 
              assetPackData, 
              orders: sanitizedOrders, 
              portfolio: sanitizedPortfolio,
              servicePrices, 
              updatedAt: new Date() 
            } 
          },
          { upsert: true }
        );
        
        // DEBUG: Log MongoDB result
        console.log('MongoDB update result:', result.modifiedCount, 'modified');
        
        return res.json({ success: true });
      }
      
      if (action === 'logout') {
        await config.updateOne(
          { key: 'session', token },
          { $set: { revoked: true } }
        );
        return res.json({ success: true });
      }
      
      return res.status(400).json({ success: false, error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error.message);
    console.error('Stack:', error.stack);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}