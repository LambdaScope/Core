// Package websocket pushes live updates to dashboards connected through an API
// Gateway WebSocket API, and handles the connection lifecycle routes.
package websocket

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi/types"
)

// MaxFrameBytes is API Gateway's WebSocket frame limit. A larger payload is
// rejected by the service, so we refuse it before spending a call on it.
const MaxFrameBytes = 128 * 1024

// fanOut bounds concurrent PostToConnection calls. Serial fan-out is one round
// trip per viewer; unbounded fan-out can hit the management API's throttle.
const fanOut = 10

// Poster is the one management-API call we make. The SDK client satisfies it.
type Poster interface {
	PostToConnection(ctx context.Context, in *apigatewaymanagementapi.PostToConnectionInput,
		opts ...func(*apigatewaymanagementapi.Options)) (*apigatewaymanagementapi.PostToConnectionOutput, error)
}

var _ Poster = (*apigatewaymanagementapi.Client)(nil)

// NewPoster builds a management-API client for one WebSocket stage.
//
// The endpoint is the https form of the stage, e.g.
// https://abc123.execute-api.ap-south-1.amazonaws.com/prod - NOT the wss://
// URL the browser uses. Pointing the client at the default service endpoint is
// the classic mistake here, and it fails with an unhelpful 403.
func NewPoster(ctx context.Context, endpoint string) (*apigatewaymanagementapi.Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	return apigatewaymanagementapi.NewFromConfig(cfg, func(o *apigatewaymanagementapi.Options) {
		o.BaseEndpoint = aws.String(endpoint)
	}), nil
}

// Notifier broadcasts messages to every connected dashboard. It implements
// processor.Notifier.
type Notifier struct {
	poster Poster
	store  store.Store
}

func NewNotifier(poster Poster, st store.Store) *Notifier {
	return &Notifier{poster: poster, store: st}
}

// ErrFrameTooLarge is returned instead of sending a frame the service would reject.
var ErrFrameTooLarge = errors.New("websocket frame exceeds 128 KB")

func encode(msg schema.WSMessage) ([]byte, error) {
	b, err := json.Marshal(msg)
	if err != nil {
		return nil, err
	}
	if len(b) > MaxFrameBytes {
		return nil, fmt.Errorf("%w: %s is %d bytes", ErrFrameTooLarge, msg.Type, len(b))
	}
	return b, nil
}

// isGone reports whether a connection has already closed. That is routine -
// tabs close without a clean $disconnect all the time - so it is handled by
// forgetting the connection, not reported as a failure.
func isGone(err error) bool {
	var gone *types.GoneException
	return errors.As(err, &gone)
}

// SendTo delivers one message to one connection.
func (n *Notifier) SendTo(ctx context.Context, connectionID string, msg schema.WSMessage) error {
	data, err := encode(msg)
	if err != nil {
		return err
	}
	return n.post(ctx, connectionID, data)
}

func (n *Notifier) post(ctx context.Context, connectionID string, data []byte) error {
	_, err := n.poster.PostToConnection(ctx, &apigatewaymanagementapi.PostToConnectionInput{
		ConnectionId: aws.String(connectionID),
		Data:         data,
	})
	if isGone(err) {
		// Without this, stale connections accumulate and every broadcast gets
		// slower until the processor starts timing out.
		if rmErr := n.store.RemoveConnection(ctx, connectionID); rmErr != nil {
			return fmt.Errorf("remove stale connection %s: %w", connectionID, rmErr)
		}
		return nil
	}
	return err
}

// Broadcast sends msg to every connection. A connection that has gone away is
// removed and is not an error. Other failures are collected and returned
// together, but never stop delivery to the remaining viewers.
func (n *Notifier) Broadcast(ctx context.Context, msg schema.WSMessage) error {
	data, err := encode(msg)
	if err != nil {
		return err
	}

	conns, err := n.store.ListConnections(ctx)
	if err != nil {
		return fmt.Errorf("list connections: %w", err)
	}
	if len(conns) == 0 {
		return nil
	}

	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		errs []error
		sem  = make(chan struct{}, fanOut)
	)
	for _, id := range conns {
		wg.Add(1)
		sem <- struct{}{}
		go func(id string) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := n.post(ctx, id, data); err != nil {
				mu.Lock()
				errs = append(errs, fmt.Errorf("connection %s: %w", id, err))
				mu.Unlock()
			}
		}(id)
	}
	wg.Wait()
	return errors.Join(errs...)
}
