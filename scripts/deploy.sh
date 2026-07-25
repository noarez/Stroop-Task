#!/bin/bash
# Stroop Effect App — AWS Deploy Script
set -e
BUCKET="stroop-task-app-462355913922"
CF_DIST="E2CMN4DB120036"
echo "🚀 Deploying static files to S3..."
aws s3 cp index.html  s3://$BUCKET/index.html  --content-type "text/html; charset=utf-8"
aws s3 cp app.js      s3://$BUCKET/app.js      --content-type "application/javascript"
aws s3 cp style.css   s3://$BUCKET/style.css   --content-type "text/css"
echo "🔄 Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id $CF_DIST --paths "/*" --query "Invalidation.Id" --output text
echo "✅ Deploy complete! Changes live in ~1 minute."
