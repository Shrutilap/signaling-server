#!/bin/bash

# Configuration
SERVICE_NAME="signal"
REGION="asia-south1"
PROJECT_ID="voicecalling-585e7"  # Replace with actual Project ID if different

# Ensure .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    exit 1
fi

echo "======================================"
echo "DEPLOYING TO CLOUD RUN: $SERVICE_NAME"
echo "======================================"

# 1. Build and push container image
echo "Building container image..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

# 2. Deploy to Cloud Run
# We need to format env vars for gcloud: KEY=VALUE,KEY2=VALUE2
echo "Formatting environment variables..."
ENV_VARS=""
while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim whitespace and remove Windows \r
    line=$(echo "$line" | tr -d '\r' | xargs)
    
    # Skip comments and empty lines
    if [[ "$line" =~ ^#.* ]] || [[ -z "$line" ]]; then
        continue
    fi
    
    if [ -z "$ENV_VARS" ]; then
        ENV_VARS="$line"
    else
        ENV_VARS="$ENV_VARS,$line"
    fi
done < .env

echo "Deploying service..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars "$ENV_VARS"

echo "======================================"
echo "Deployment Complete!"
echo "Service URL:"
gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)'
echo "======================================"
