#!/bin/bash
# infra/scripts/deploy.sh
#
# Deploys the entire LambdaScope infrastructure stack to AWS.
# Run from the monorepo root:
#
#   bash infra/scripts/deploy.sh
#
# Requires: aws CLI, sam CLI, jq, valid AWS credentials in environment.

set -e

REGION="ap-south-1"
STACK_NAME="lambdascope"

# ---------------------------------------------------------------------------
# Step 1 — Start banner
# ---------------------------------------------------------------------------
echo ""
echo "======================================================"
echo " [lambdascope] starting deployment..."
echo " stack  : ${STACK_NAME}"
echo " region : ${REGION}"
echo "======================================================"
echo ""

# ---------------------------------------------------------------------------
# Step 2 — Check AWS CLI is installed
# ---------------------------------------------------------------------------
echo "[lambdascope] checking dependencies..."
if ! command -v aws &> /dev/null; then
  echo ""
  echo "[lambdascope] ERROR: AWS CLI not found."
  echo "[lambdascope]        Install it from: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
  exit 1
fi
echo "[lambdascope] ✓ aws CLI found: $(aws --version 2>&1)"

# ---------------------------------------------------------------------------
# Step 3 — Check SAM CLI is installed
# ---------------------------------------------------------------------------
if ! command -v sam &> /dev/null; then
  echo ""
  echo "[lambdascope] ERROR: SAM CLI not found."
  echo "[lambdascope]        Install it from: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
  exit 1
fi
echo "[lambdascope] ✓ sam CLI found: $(sam --version 2>&1)"

# ---------------------------------------------------------------------------
# Step 4 — Verify AWS credentials are configured and active
# ---------------------------------------------------------------------------
echo "[lambdascope] verifying AWS credentials..."
CALLER_IDENTITY=$(aws sts get-caller-identity --region "${REGION}" 2>&1) || {
  echo ""
  echo "[lambdascope] ERROR: AWS credentials not configured or invalid."
  echo "[lambdascope]        Run 'aws configure' or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY."
  exit 1
}
ACCOUNT_ID=$(echo "${CALLER_IDENTITY}" | jq -r '.Account')
CALLER_ARN=$(echo "${CALLER_IDENTITY}" | jq -r '.Arn')
echo "[lambdascope] ✓ credentials valid."
echo "[lambdascope]   account : ${ACCOUNT_ID}"
echo "[lambdascope]   caller  : ${CALLER_ARN}"
echo ""

# ---------------------------------------------------------------------------
# Step 5 — sam build (must run from infra/ directory)
# ---------------------------------------------------------------------------
echo "[lambdascope] running sam build from infra/..."
cd infra/
sam build
echo "[lambdascope] ✓ sam build complete."
echo ""

# ---------------------------------------------------------------------------
# Step 6 — sam deploy (must also run from infra/ directory)
# ---------------------------------------------------------------------------
echo "[lambdascope] running sam deploy using infra/samconfig.toml..."
sam deploy --config-file samconfig.toml
echo "[lambdascope] ✓ sam deploy complete."
echo ""

# Return to monorepo root before running AWS CLI commands.
cd ..

# ---------------------------------------------------------------------------
# Step 7 — Fetch and print all stack outputs
# ---------------------------------------------------------------------------
echo "[lambdascope] fetching stack outputs from CloudFormation..."
STACK_OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs" \
  --output json)

# Helper: extract a specific output value by its OutputKey.
get_output() {
  echo "${STACK_OUTPUTS}" | jq -r --arg key "$1" '.[] | select(.OutputKey == $key) | .OutputValue'
}

KINESIS_STREAM_ARN=$(get_output "KinesisStreamArn")
KINESIS_STREAM_NAME=$(get_output "KinesisStreamName")
DYNAMODB_TABLE_NAME=$(get_output "DynamoDBTableName")
WEBSOCKET_URL=$(get_output "WebSocketURL")
SNS_TOPIC_ARN=$(get_output "SNSTopicArn")
EXTENSION_ROLE_ARN=$(get_output "ExtensionRoleArn")

echo ""
echo "======================================================"
echo " [lambdascope] STACK OUTPUTS — share with the team"
echo "======================================================"
echo ""
echo "  Kinesis Stream ARN   : ${KINESIS_STREAM_ARN}"
echo "  Kinesis Stream Name  : ${KINESIS_STREAM_NAME}"
echo "  DynamoDB Table Name  : ${DYNAMODB_TABLE_NAME}"
echo "  WebSocket URL        : ${WEBSOCKET_URL}"
echo "  SNS Topic ARN        : ${SNS_TOPIC_ARN}"
echo "  Extension Role ARN   : ${EXTENSION_ROLE_ARN}"
echo ""
echo "  → Sudhanshu needs : Kinesis Stream ARN + Extension Role ARN"
echo "  → Divyansh needs  : Kinesis Stream ARN + DynamoDB Table Name + SNS Topic ARN"
echo "  → Thushar needs   : WebSocket URL"
echo ""

# ---------------------------------------------------------------------------
# Step 8 — Final banner
# ---------------------------------------------------------------------------
echo "======================================================"
echo " [lambdascope] deployment complete."
echo " share the above ARNs with the team."
echo "======================================================"
echo ""
