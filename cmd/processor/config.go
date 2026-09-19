package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/LambdaScope/Core/internal/anomaly"
)

// config is everything the processor Lambda reads from its environment. These
// names are the contract with the SAM template.
type config struct {
	// TableName is the single DynamoDB table. Required.
	TableName string

	// WebSocketEndpoint is the https management endpoint of the WebSocket stage,
	// e.g. https://abc123.execute-api.ap-south-1.amazonaws.com/prod. Optional:
	// without it nothing is pushed live, but everything is still stored.
	WebSocketEndpoint string

	// SNSTopicARN receives severe anomalies. Optional.
	SNSTopicARN string

	// BedrockModelID and BedrockRegion select the explainer. Setting
	// EXPLAIN=off disables it and every alert uses the local summary instead.
	BedrockModelID string
	BedrockRegion  string
	ExplainOff     bool

	// IPRangesURL is where the published AWS address ranges are fetched from
	// at cold start.
	IPRangesURL string
}

const defaultIPRangesURL = "https://ip-ranges.amazonaws.com/ip-ranges.json"

func loadConfig(getenv func(string) string) (config, error) {
	c := config{
		TableName:         getenv("TABLE_NAME"),
		WebSocketEndpoint: getenv("WEBSOCKET_ENDPOINT"),
		SNSTopicARN:       getenv("SNS_TOPIC_ARN"),
		BedrockModelID:    getenv("BEDROCK_MODEL_ID"),
		BedrockRegion:     getenv("BEDROCK_REGION"),
		ExplainOff:        getenv("EXPLAIN") == "off",
		IPRangesURL:       getenv("AWS_IP_RANGES_URL"),
	}
	if c.TableName == "" {
		return c, errors.New("TABLE_NAME is required")
	}
	if c.BedrockRegion == "" {
		c.BedrockRegion = getenv("AWS_REGION") // always set inside Lambda
	}
	if c.IPRangesURL == "" {
		c.IPRangesURL = defaultIPRangesURL
	}
	return c, nil
}

// loadAWSRanges fetches Amazon's published address ranges once per cold start.
//
// If the fetch fails - no internet route from a VPC, a slow response - we
// return ranges that report themselves as not loaded rather than falling back
// to a hard-coded approximation. The detector then ranks on port alone and
// records in the evidence that range data was unavailable, instead of
// confidently calling an AWS address external.
func loadAWSRanges(ctx context.Context, client *http.Client, url string) (*anomaly.AWSRanges, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return &anomaly.AWSRanges{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return &anomaly.AWSRanges{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &anomaly.AWSRanges{}, fmt.Errorf("fetch %s: status %d", url, resp.StatusCode)
	}

	ranges, err := anomaly.LoadAWSRanges(resp.Body)
	if err != nil {
		return &anomaly.AWSRanges{}, err
	}
	if !ranges.Loaded() {
		return ranges, errors.New("ip ranges file contained no prefixes")
	}
	return ranges, nil
}
