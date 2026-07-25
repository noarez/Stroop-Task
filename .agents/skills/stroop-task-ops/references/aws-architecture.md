# AWS Infrastructure Reference — Stroop Task

## AWS Resource Specifications

- **AWS Region:** `us-east-1`
- **AWS Account ID:** `462355913922`
- **Domain:** `https://stroop-effect.com` / `https://www.stroop-effect.com`

### Infrastructure Components
1. **S3 Static Website Bucket:** `stroop-task-app-462355913922`
2. **S3 Participant Data Bucket:** `stroop-task-data-462355913922`
3. **AWS Lambda API Function:** `stroop-task-api` (Runtime: Node.js 20.x, Memory: 256MB)
4. **AWS IAM Execution Role:** `stroop-lambda-role`
5. **AWS API Gateway (HTTP API):** `stroop-http-api` (`ppyv3l1a6e.execute-api.us-east-1.amazonaws.com`)
6. **AWS CloudFront Distribution:** `E2CMN4DB120036` (`dnevq0ofwfz0l.cloudfront.net`)
7. **AWS ACM Certificate:** `arn:aws:acm:us-east-1:462355913922:certificate/b2a29f42-8605-44fc-850a-88e46f1c497c`
8. **Route 53 Hosted Zone ID:** `Z08391463K61SYZ9CNNXB`

### Routing Rules (CloudFront Distribution)
- `/*` (Default) → S3 static website (`index.html`, `app.js`, `style.css`)
- `/api/*` → API Gateway → Lambda function
- `/admin*` → API Gateway → Lambda function
