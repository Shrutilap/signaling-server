#!/bin/bash

# Setup HTTPS with Nginx and Certbot on Ubuntu 20.04/22.04
# Usage: ./setup-https.sh <your-domain-or-ip>

DOMAIN=$1

if [ -z "$DOMAIN" ]; then
    echo "Error: Please provide your domain name or public IP."
    echo "Usage: ./setup-https.sh <your-domain.com>"
    exit 1
fi

echo "========================================="
echo "Setting up Nginx & SSL for: $DOMAIN"
echo "========================================="

# 1. Install Nginx
echo "[1/4] Installing Nginx..."
sudo apt update
sudo apt install -y nginx

# 2. Configure Nginx
echo "[2/4] Configuring Nginx..."
CONFIG_FILE="/etc/nginx/sites-available/call-gateway"

# 3. Create Nginx config
sudo bash -c "cat > $CONFIG_FILE" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

# Enable site
sudo ln -sf $CONFIG_FILE /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# 3. Install Certbot
echo "[3/4] Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# 4. Obtain SSL Certificate
echo "[4/4] Obtaining SSL Certificate..."
echo "Running certbot... Follow the prompts on screen."

# Only run certbot if it's a domain (not an IP)
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "⚠️  Warning: Let's Encrypt does not support IP addresses ($DOMAIN)."
    echo "   Nginx is set up for HTTP on port 80."
    echo "   You can access via http://$DOMAIN"
else
    sudo certbot --nginx -d $DOMAIN
fi

echo ""
echo "========================================="
echo "✅ Setup Complete!"
echo "========================================="
if [[ ! "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Your app should now be accessible at https://$DOMAIN"
else
    echo "Your app should now be accessible at http://$DOMAIN"
fi
