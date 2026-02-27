import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await client.connect();
    const db = client.db('arshia_gfx');
    const configCollection = db.collection('config');
    const dataCollection = db.collection('data');

    // GET - Load data
    if (req.method === 'GET') {
      const { password } = req.query;
      
      // Get stored password
      const config = await configCollection.findOne({ _id: 'config' });
      const correctPassword = config?.adminPassword || 'ARSHIA2024!';
      
      if (password !== correctPassword) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const data = await dataCollection.findOne({ _id: 'data' }) || {
        services: [],
        assetPackData: {
          showRibbon: true,
          ribbonText: 'COMING SOON',
          title: 'ALL-IN-ONE ASSET PACK',
          price: '',
          description: 'Complete GFX Asset Collection',
          features: ['Commercial License', '50+ Thumbnails', 'Stream Overlays', 'Transition Pack'],
          status: 'coming_soon'
        },
        orders: []
      };
      
      return res.status(200).json(data);
    }
    
    // POST - Save data
    if (req.method === 'POST') {
      const { password, newPassword, services, assetPackData, orders } = req.body;
      
      // Get stored password
      const config = await configCollection.findOne({ _id: 'config' });
      const correctPassword = config?.adminPassword || 'ARSHIA2024!';
      
      // Verify password
      if (password !== correctPassword) {
        return res.status(401).json({ error: 'Invalid password' });
      }
      
      // If newPassword is provided, update it first
      if (newPassword && newPassword.length >= 6) {
        await configCollection.updateOne(
          { _id: 'config' },
          { $set: { adminPassword: newPassword } },
          { upsert: true }
        );
      }
      
      // Build update object with only provided fields
      const updateData = {
        updatedAt: new Date()
      };
      
      if (services !== undefined) updateData.services = services;
      if (assetPackData !== undefined) updateData.assetPackData = assetPackData;
      if (orders !== undefined) updateData.orders = orders;
      
      // Update data
      await dataCollection.updateOne(
        { _id: 'data' },
        { $set: updateData },
        { upsert: true }
      );
      
      return res.status(200).json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}