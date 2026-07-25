#!/bin/bash
# Stroop Effect App — Lambda Deploy Script
set -e
echo "📦 Packaging Lambda..."
cd lambda && zip -r ../lambda.zip . && cd ..
echo "🚀 Updating Lambda function..."
aws lambda update-function-code --function-name stroop-task-api --zip-file fileb://lambda.zip --query "LastModified" --output text
echo "✅ Lambda updated!"
rm -f lambda.zip
