import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');
  const code = url.searchParams.get('code');

  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
  const JWT_SECRET = process.env.JWT_SECRET;

  if (action === 'login') {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20email`;
    return res.redirect(discordAuthUrl);
  }

  if (code) {
    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: REDIRECT_URI
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const tokenData = await tokenResponse.json();
      if (!tokenData.access_token) throw new Error('Failed to get Discord token');

      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = await userResponse.json();

      const userToken = jwt.sign(
        { id: userData.id, username: userData.username, avatar: userData.avatar },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.setHeader('Set-Cookie', `auth_token=${userToken}; Path=/; HttpOnly; Max-Age=604800; SameSite=Lax`);
      return res.redirect('/?login=success#reviews');
    } catch (error) {
      console.error(error);
      return res.redirect('/?error=auth_failed');
    }
  }

  if (action === 'me') {
    const cookie = req.headers.cookie || '';
    const tokenMatch = cookie.match(/auth_token=([^;]+)/);
    
    if (!tokenMatch) return res.status(401).json({ authenticated: false });

    try {
      const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
      return res.status(200).json({ authenticated: true, user: decoded });
    } catch (err) {
      return res.status(401).json({ authenticated: false });
    }
  }

  if (req.method === 'POST' && req.body.action === 'logout') {
    res.setHeader('Set-Cookie', `auth_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid auth request' });
}