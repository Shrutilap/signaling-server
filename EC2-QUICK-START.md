not # EC2 Quick Deployment Guide

Follow these steps to deploy the Call Gateway on AWS EC2 and make `/escalate-to-human` publicly accessible.

## Prerequisites

- [ ] AWS Account
- [ ] `firebase-service-account.json` file locally
- [ ] Agent Server URL (if using AI agent)

---

## Step 1: Launch EC2 Instance

1. **Go to EC2 Dashboard** in AWS Console
2. **Click "Launch Instance"**
3. **Configure:**
   - **Name:** `call-gateway-server`
   - **AMI:** Ubuntu Server 22.04 LTS (Free tier eligible)
   - **Instance type:** `t3.small` or `t2.small` (t2.micro may be too small)
   - **Key pair:** Create new or select existing
   - **Network settings:**
     - ✅ Allow SSH (port 22) from your IP
     - ✅ Allow HTTP (port 80) from anywhere (0.0.0.0/0)
     - ✅ Allow HTTPS (port 443) from anywhere (0.0.0.0/0)
     - ✅ Add custom TCP rule: Port 3000 from anywhere (0.0.0.0/0)
4. **Launch Instance**

**Save your EC2 public IP:** `xx.xx.xx.xx`

---

## Step 2: SSH into EC2

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@YOUR-EC2-PUBLIC-IP
```

Replace `YOUR-EC2-PUBLIC-IP` with your actual EC2 public IP.

---

## Step 3: Run Automated Deployment Script

On the EC2 instance:

```bash
# Download and run the deployment script
curl -O https://raw.githubusercontent.com/Shrutilap/signaling-server/main/deploy-ec2.sh
chmod +x deploy-ec2.sh
./deploy-ec2.sh
```

This will:
- Install Node.js 20
- Install PM2
- Clone the repository
- Install dependencies
- Build the app
- Start the server

---

## Step 4: Upload Firebase Credentials

**From your LOCAL machine** (not EC2), run:

```bash
scp -i your-key.pem firebase-service-account.json ubuntu@YOUR-EC2-IP:/home/ubuntu/signaling-server/
```

---

## Step 5: Configure Environment Variables

Back on the EC2 instance:

```bash
cd /home/ubuntu/signaling-server
nano .env
```

Update:
```bash
PORT=3000
LOG_LEVEL=info
AGENT_SERVER_URL=wss://your-agent-server.com
```

Save: `Ctrl+X`, then `Y`, then `Enter`

Restart server:
```bash
pm2 restart call-gateway
```

---

## Step 6: Test the Server

### Test basic endpoint:
```bash
curl http://YOUR-EC2-IP:3000
```

Should return: `Call Gateway Server is running`

### Test escalate endpoint:
```bash
curl -X POST http://YOUR-EC2-IP:3000/escalate-to-human \
  -H "Content-Type: application/json" \
  -d '{"callId":"test123","recipientId":"user456","recipientName":"Test User"}'
```

---

## Step 7: Setup Nginx (Production - Optional but Recommended)

### Install Nginx:
```bash
sudo apt install nginx -y
```

### Create Nginx config:
```bash
sudo nano /etc/nginx/sites-available/call-gateway
```

Paste:
```nginx
server {
    listen 80;
    server_name YOUR-EC2-IP;  # Or your domain if you have one

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Enable config:
```bash
sudo ln -s /etc/nginx/sites-available/call-gateway /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Now you can access via port 80:
```bash
curl http://YOUR-EC2-IP/escalate-to-human
```

---

## Step 8: Setup SSL (If using a domain)

Only if you have a domain pointed to your EC2:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

Follow prompts, Certbot will auto-configure SSL.

---

## ✅ Your Endpoints are Now Public!

### Available endpoints:

| Method | Endpoint | Access URL |
|--------|----------|------------|
| GET | `/` | `http://YOUR-EC2-IP:3000/` |
| POST | `/escalate-to-human` | `http://YOUR-EC2-IP:3000/escalate-to-human` |
| WebSocket | `/socket.io` | `ws://YOUR-EC2-IP:3000` |

**With Nginx (port 80):**
- `http://YOUR-EC2-IP/escalate-to-human`

**With SSL (if configured):**
- `https://yourdomain.com/escalate-to-human`

---

## Managing the Server

### View logs:
```bash
pm2 logs call-gateway
```

### Restart server:
```bash
pm2 restart call-gateway
```

### Stop server:
```bash
pm2 stop call-gateway
```

### Update code:
```bash
cd /home/ubuntu/signaling-server
git pull origin main
npm install
npm run build
pm2 restart call-gateway
```

### Check server status:
```bash
pm2 status
```

---

## Security Recommendations

1. **Restrict SSH Access**
   - Only allow SSH from your IP in EC2 Security Group
   - Don't allow 0.0.0.0/0 for SSH

2. **Use Environment Variables**
   - Never commit `.env` or Firebase credentials
   - Keep sensitive data secure

3. **Setup HTTPS**
   - Use SSL certificate for production
   - Force HTTPS redirect

4. **Monitor Resources**
   - Set up CloudWatch alarms for CPU/Memory
   - Monitor PM2 logs regularly

---

## Troubleshooting

### Server won't start
```bash
pm2 logs call-gateway --lines 50
```
Check for missing Firebase credentials or env vars.

### Port 3000 not accessible
- Check EC2 Security Group allows port 3000
- Check if firewall (ufw) is blocking: `sudo ufw status`

### WebSocket connection fails
- Ensure Security Group allows inbound on port 3000
- Verify Nginx WebSocket proxy settings

---

## Share with Your Team

**Public API endpoint:**
```
http://YOUR-EC2-IP:3000/escalate-to-human
```

**WebSocket endpoint:**
```
http://YOUR-EC2-IP:3000
```

Update your mobile app and agent server to use these URLs!
