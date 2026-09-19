// Command api is the Lambda behind the WebSocket API's $connect, $disconnect
// and $default routes.
//
// Build for Lambda (provided.al2023 expects the binary to be named bootstrap):
//
//	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap ./cmd/api
//
// Environment:
//
//	TABLE_NAME          required - the same table the processor writes
//	WEBSOCKET_ENDPOINT  optional - management endpoint override, only needed
//	                    behind a custom domain; otherwise derived per request
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/LambdaScope/Core/internal/store"
	"github.com/LambdaScope/Core/internal/websocket"
	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)

	table := os.Getenv("TABLE_NAME")
	if table == "" {
		log.Error("configuration", "err", "TABLE_NAME is required")
		os.Exit(1)
	}

	ctx := context.Background()
	st, err := store.NewDynamo(ctx, table)
	if err != nil {
		log.Error("dynamodb", "err", err)
		os.Exit(1)
	}

	h := websocket.NewHandler(st, func(ctx context.Context, endpoint string) (websocket.Poster, error) {
		p, err := websocket.NewPoster(ctx, endpoint)
		if err != nil {
			return nil, err // not p: a nil *Client in a Poster is a non-nil interface
		}
		return p, nil
	}, log)
	h.Endpoint = os.Getenv("WEBSOCKET_ENDPOINT")

	log.Info("websocket api ready", "table", table)
	lambda.Start(h.Handle)
}
