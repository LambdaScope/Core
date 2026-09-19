// Command processor is the Lambda that consumes the Kinesis stream of
// invocation events, detects anomalies, and raises alerts.
//
// Build for Lambda (provided.al2023 expects the binary to be named bootstrap):
//
//	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap ./cmd/processor
//
// Environment: see config.go.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/bedrock"
	"github.com/LambdaScope/Core/internal/processor"
	"github.com/LambdaScope/Core/internal/sns"
	"github.com/LambdaScope/Core/internal/store"
	"github.com/LambdaScope/Core/internal/websocket"
	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	// JSON logs so CloudWatch Logs Insights can filter on fields.
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)

	cfg, err := loadConfig(os.Getenv)
	if err != nil {
		log.Error("configuration", "err", err)
		os.Exit(1)
	}

	// Everything below runs once per cold start and is reused by every
	// invocation. Building clients inside the handler would add that cost to
	// every single batch.
	ctx := context.Background()

	st, err := store.NewDynamo(ctx, cfg.TableName)
	if err != nil {
		log.Error("dynamodb", "err", err)
		os.Exit(1)
	}

	ranges, err := loadAWSRanges(ctx, &http.Client{Timeout: 5 * time.Second}, cfg.IPRangesURL)
	if err != nil {
		log.Warn("aws ip ranges unavailable; severity will rank on port only", "err", err)
	}

	opts := processor.Options{
		Store:    st,
		Detector: anomaly.New(anomaly.DefaultConfig(), ranges),
		Log:      log,
	}

	if cfg.WebSocketEndpoint != "" {
		poster, err := websocket.NewPoster(ctx, cfg.WebSocketEndpoint)
		if err != nil {
			log.Error("websocket client", "err", err)
			os.Exit(1)
		}
		opts.Notifier = websocket.NewNotifier(poster, st)
	} else {
		log.Warn("WEBSOCKET_ENDPOINT not set; anomalies are stored but not pushed live")
	}

	if cfg.SNSTopicARN != "" {
		alerter, err := sns.New(ctx, cfg.SNSTopicARN)
		if err != nil {
			log.Error("sns client", "err", err)
			os.Exit(1)
		}
		opts.Alerter = alerter
	}

	if !cfg.ExplainOff {
		explainer, err := bedrock.New(ctx, cfg.BedrockRegion, cfg.BedrockModelID)
		if err != nil {
			// Not fatal: alerts still go out with the local summary.
			log.Warn("bedrock unavailable; alerts will use the local summary", "err", err)
		} else {
			opts.Explain = explainer
		}
	}

	p := processor.New(opts)
	log.Info("processor ready",
		"table", cfg.TableName,
		"websocket", cfg.WebSocketEndpoint != "",
		"sns", cfg.SNSTopicARN != "",
		"explainer", opts.Explain != nil,
		"aws_ranges", ranges.Loaded())

	lambda.Start(p.HandleKinesis)
}
