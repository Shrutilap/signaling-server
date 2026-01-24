# Call Gateway Deployment Guide

This guide will help you deploy the Call Gateway signaling server to make it publicly accessible.

## Prerequisites

Before deploying, ensure you have:
- [ ] Firebase service account JSON file
- [ ] Agent Server URL (if using AI agent integration)
- [ ] Domain name or willingness to use provider's domain

## Deployment Options

### Option 1: Railway (Recommended - Easiest)

Railway provides free tier and automatic HTTPS certificates.

#### Steps:

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub

2. **Deploy from GitHub**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `Shrutilap/signaling-server`
   - Railway will auto-detect as Node.js project

3. **Add Environment Variables**
   
   Go to Variables tab and add:
   ```
   PORT=3000
   LOG_LEVEL=info
   AGENT_SERVER_URL=wss://your-agent-server.com
   ```

4. **Add Firebase Credentials**
   
   Two options:
   
   **Option A: Upload file via Railway CLI**
   ```bash
   railway login
   railway link
   railway run --service call-gateway
   # Upload firebase-service-account.json to project root
   ```
   
   **Option B: Use environment variable**
   - Copy contents of `firebase-service-account.json`
   - Minify to single line: https://jsonformatter.org/json-minify
   - Add as env var: `FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}`
   - Update code to read from env var instead of file

5. **Deploy**
   - Railway auto-deploys on push
   - Get your public URL: `https://your-app.railway.app`

6. **Custom Domain (Optional)**
   - Go to Settings → Domains
   - Add custom domain and configure DNS

---

### Option 2: Render

Render offers free tier with automatic SSL.

#### Steps:

1. **Sign up at [render.com](https://render.com)**

2. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Connect GitHub: `Shrutilap/signaling-server`

3. **Configure Service**
   ```
   Name: call-gateway
   Environment: Node
   Build Command: npm install && npm run build
   Start Command: npm start
   ```

4. **Add Environment Variables**
   ```
   PORT=3000
   LOG_LEVEL=info
   AGENT_SERVER_URL=wss://your-agent-server.com
   ```

5. **Upload Firebase JSON**
   - Use Render's Dashboard to upload `firebase-service-account.json` as a secret file
   - Path: `/etc/secrets/firebase-service-account.json`
   - Update `firebaseService.ts` to read from this path

6. **Deploy**
   - Click "Create Web Service"
   - Get URL: `https://call-gateway.onrender.com`

---

### Option 3: AWS EC2 (Production Grade)

For full control and scalability.

#### Steps:

1. **Launch EC2 Instance**
   - Ubuntu 22.04 LTS
   - t3.small or larger
   - Open ports: 22 (SSH), 80 (HTTP), 443 (HTTPS), 3000 (App)

2. **SSH into Instance**
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   ```

3. **Install Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```

4. **Clone Repository**
   ```bash
   cd /home/ubuntu
   git clone https://github.com/Shrutilap/signaling-server.git
   cd signaling-server
   npm install
   npm run build
   ```

5. **Setup Environment**
   ```bash
   nano .env
   ```
   
   Add:
   ```
   PORT=3000
   LOG_LEVEL=info
   AGENT_SERVER_URL=wss://your-agent-server.com
   ```

6. **Upload Firebase Credentials**
   ```bash
   # From local machine
   scp -i your-key.pem firebase-service-account.json ubuntu@your-ec2-ip:/home/ubuntu/signaling-server/
   ```

7. **Start with PM2**
   ```bash
   pm2 start dist/server.js --name call-gateway
   pm2 startup
   pm2 save
   ```

8. **Setup Nginx as Reverse Proxy**
   ```bash
   sudo apt install nginx
   sudo nano /etc/nginx/sites-available/call-gateway
   ```
   
   Add:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
   
   Enable:
   ```bash
   sudo ln -s /etc/nginx/sites-available/call-gateway /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

9. **Add SSL with Let's Encrypt**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

---

### Option 4: DigitalOcean App Platform

Similar to Railway/Render with good free tier.

#### Steps:

1. **Create DigitalOcean Account**
   - Go to [digitalocean.com](https://www.digitalocean.com)

2. **Create App**
   - Apps → Create App
   - Connect GitHub: `Shrutilap/signaling-server`

3. **Configure**
   - Detected as Node.js
   - Build: `npm install && npm run build`
   - Run: `npm start`

4. **Add Environment Variables**
   ```
   PORT=8080
   LOG_LEVEL=info
   AGENT_SERVER_URL=wss://your-agent-server.com
   ```

5. **Deploy**
   - Auto-deploys on git push
   - Get URL: `https://call-gateway-xxxxx.ondigitalocean.app`

---

## Testing Deployment

After deployment, test the endpoints:

### 1. Health Check
```bash
curl https://your-deployed-url.com
```
Should return: `Call Gateway Server is running`

### 2. WebSocket Connection Test

Create a simple test HTML file:

```html
<!DOCTYPE html>
<html>
<head><title>Socket Test</title></head>
<body>
<script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
<script>
  const socket = io('https://your-deployed-url.com');
  
  socket.on('connect', () => {
    console.log('✅ Connected to server!');
    socket.emit('register', {
      userId: 'test123',
      name: 'Test User'
    });
  });

  socket.on('registered', (data) => {
    console.log('✅ Registration successful:', data);
  });

  socket.on('error', (error) => {
    console.error('❌ Error:', error);
  });
</script>
</body>
</html>
```

Open in browser and check console.

---

## Firewall & Security

### Required Ports
- **3000** (or configured PORT) - Application
- **80** - HTTP (redirects to HTTPS)
- **443** - HTTPS

### Security Best Practices

1. **Always use HTTPS** for production
2. **Enable CORS** only for your mobile app domains
3. **Set environment variables securely** - never commit to git
4. **Rotate Firebase credentials** periodically
5. **Monitor logs** for suspicious activity
6. **Rate limit** connections to prevent DDoS

---

## Monitoring & Logs

### Railway
- Built-in logs in dashboard
- Click "View Logs" in deployment

### Render
- Logs tab in service dashboard
- Real-time log streaming

### AWS EC2
```bash
# View PM2 logs
pm2 logs call-gateway

# View last 100 lines
pm2 logs call-gateway --lines 100
```

---

## Updating Deployment

### Railway/Render/DigitalOcean
- Just push to GitHub
- Auto-deploys on push to `main` branch

### AWS EC2
```bash
ssh ubuntu@your-ec2-ip
cd /home/ubuntu/signaling-server
git pull origin main
npm install
npm run build
pm2 restart call-gateway
```

---

## Getting Your Public URL

After deployment, you'll have a public URL like:
- Railway: `https://call-gateway-production.up.railway.app`
- Render: `https://call-gateway.onrender.com`
- AWS: `https://your-domain.com`

**Share this URL with:**
- Mobile app developers (update `CALL_GATEWAY_URL` in mobile app config)
- Frontend developers
- Anyone who needs to connect to the signaling server

---

## Troubleshooting

### Server won't start
- Check environment variables are set correctly
- Ensure Firebase credentials file exists
- Check logs for detailed error messages

### WebSocket connection fails
- Verify firewall allows WebSocket connections
- Ensure using `wss://` (not `ws://`) for HTTPS deployments
- Check CORS settings in server configuration

### Push notifications not working
- Verify Firebase credentials are valid
- Check FCM tokens are being sent from mobile app
- Review Firebase console for errors

---

## Cost Estimates

| Platform | Free Tier | Paid Tier |
|----------|-----------|-----------|
| **Railway** | 500 hours/month | $5/month (Starter) |
| **Render** | 750 hours/month | $7/month (Starter) |
| **DigitalOcean** | $0 (limited) | $5/month (Basic) |
| **AWS EC2** | Free 1st year (t2.micro) | ~$10-30/month |

**Recommendation:** Start with Railway or Render free tier, upgrade as needed.

---

## Support

For deployment issues:
- Check server logs first
- Review this guide
- Contact your development team

**Repository:** https://github.com/Shrutilap/signaling-server
