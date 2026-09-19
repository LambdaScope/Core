package processor

import (
	"context"

	"github.com/LambdaScope/Core/internal/schema"
)

// The three outbound dependencies, each behind an interface for the same
// reason as the Store: the processor must be fully runnable and testable with
// no AWS account attached.

// Notifier pushes a message to every connected dashboard.
type Notifier interface {
	Broadcast(ctx context.Context, msg schema.WSMessage) error
}

// Explainer turns a structured anomaly into a sentence a human can act on.
// In production this is Bedrock; in tests it is a stub.
type Explainer interface {
	Explain(ctx context.Context, a schema.Anomaly) (string, error)
}

// Alerter publishes an alert out of band - SNS, email, Slack.
type Alerter interface {
	Alert(ctx context.Context, a schema.Anomaly) error
}

// --- no-op implementations -------------------------------------------------
//
// These let the processor run end to end before any of the real services
// exist, which is the whole point: the pipeline is provable on a laptop.

type NoopNotifier struct{}

func (NoopNotifier) Broadcast(context.Context, schema.WSMessage) error { return nil }

type NoopAlerter struct{}

func (NoopAlerter) Alert(context.Context, schema.Anomaly) error { return nil }

// CollectingNotifier records everything it was asked to broadcast. Used by
// tests and by the local runner to show what the dashboard would have received.
type CollectingNotifier struct {
	Messages []schema.WSMessage
}

func (c *CollectingNotifier) Broadcast(_ context.Context, msg schema.WSMessage) error {
	c.Messages = append(c.Messages, msg)
	return nil
}

// TypesSeen returns the message types in the order they were broadcast.
func (c *CollectingNotifier) TypesSeen() []string {
	out := make([]string, 0, len(c.Messages))
	for _, m := range c.Messages {
		out = append(out, m.Type)
	}
	return out
}
