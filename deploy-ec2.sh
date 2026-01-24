#!/bin/bash

# EC2 Deployment Script for Call Gateway Signaling Server
# Run this script on your EC2 instance after SSH'ing in

set -e  # Exit on any error

echo "========================================="
echo "Call Gateway EC2 Deployment Script"
echo "========================================="
echo ""

# Update system
echo "[1/8] Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Node.js 20
echo "[2/8] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"

# Install PM2 globally
echo "[3/8] Installing PM2 process manager..."
sudo npm install -g pm2

# Clone repository
echo "[4/8] Cloning repository..."
cd /home/ubuntu
if [ -d "signaling-server" ]; then
    echo "Repository already exists, pulling latest changes..."
    cd signaling-server
    git pull origin main
else
    git clone https://github.com/Shrutilap/signaling-server.git
    cd signaling-server
fi

# Install dependencies
echo "[5/8] Installing dependencies..."
npm install

# Build TypeScript
echo "[6/8] Building TypeScript..."
npm run build

# Setup environment file
echo "[7/8] Setting up environment variables..."
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << EOF
PORT=3000
LOG_LEVEL=info
AGENT_SERVER_URL=
EOF
    echo "✅ .env created. Please edit it to add your AGENT_SERVER_URL"
else
    echo "✅ .env already exists"
fi

# Note about Firebase credentials
echo ""
echo "⚠️  IMPORTANT: Upload firebase-service-account.json"
echo "   From your local machine, run:"
echo "   scp -i your-key.pem firebase-service-account.json ubuntu@YOUR-EC2-IP:/home/ubuntu/signaling-server/"
echo ""

# Start with PM2
echo "[8/8] Starting application with PM2..."
pm2 delete call-gateway 2>/dev/null || true
pm2 start dist/server.js --name call-gateway
pm2 startup | grep "sudo" | bash || true
pm2 save

echo ""
echo "========================================="
echo "✅ Deployment Complete!"
echo "========================================="
echo ""
echo "Server is running on port 3000"
echo ""
echo "Next steps:"
echo "1. Upload firebase-service-account.json to this directory"
echo "2. Edit .env file: nano .env"
echo "3. Restart server: pm2 restart call-gateway"
echo "4. Setup Nginx reverse proxy (see DEPLOYMENT.md)"
echo "5. Setup SSL with Let's Encrypt (see DEPLOYMENT.md)"
echo ""
echo "View logs: pm2 logs call-gateway"
echo "Stop server: pm2 stop call-gateway"
echo "Restart server: pm2 restart call-gateway"
echo ""
