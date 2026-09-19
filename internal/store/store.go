// Package store is the persistence boundary.
//
// Everything above this package talks to the Store interface, never to
// DynamoDB directly. That is what lets the whole processor run and be tested
// with `go test ./...` on a laptop, with no AWS account, no deployed stack and
// no waiting for anyone else's work. Swapping Memory for DynamoDB at the top of
// main() is the only difference between a local run and production.
package store

import (
	"context"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/schema"
)

type Store interface {
	// --- learned state -----------------------------------------------------

	// LoadBaseline returns the function's learned "normal". A function that has
	// never been seen returns a fresh empty baseline, not an error.
	LoadBaseline(ctx context.Context, key string) (*anomaly.Baseline, error)
	SaveBaseline(ctx context.Context, b *anomaly.Baseline) error

	// LoadSandbox returns one warm container's file-descriptor history, or a
	// fresh empty one.
	LoadSandbox(ctx context.Context, id string) (*anomaly.SandboxState, error)
	SaveSandbox(ctx context.Context, s *anomaly.SandboxState) error

	// --- records -----------------------------------------------------------

	// PutInvocation writes the event and reports whether it was new.
	//
	// Kinesis delivers at least once, so the same record can arrive twice. The
	// implementation must make this a conditional write on invocation_id: a
	// duplicate returns isNew=false and the caller skips the rest of the work
	// rather than raising a second alert and paying for a second Bedrock call.
	PutInvocation(ctx context.Context, ev *schema.InvocationEvent) (isNew bool, err error)

	// PutAnomaly writes an alert. Same conditional-write rule, on anomaly_id.
	PutAnomaly(ctx context.Context, a *schema.Anomaly) (isNew bool, err error)

	// SetExplanation fills in the prose once Bedrock answers.
	SetExplanation(ctx context.Context, anomalyID string, explanation *string, status schema.ExplanationStatus) error

	// --- explanation cache -------------------------------------------------

	// GetExplanation looks up a cached explanation by anomaly signature.
	//
	// The same unknown endpoint hit five hundred times shares one signature and
	// therefore one Bedrock call. Without this, a demo function in a loop would
	// exhaust the budget and blow the Lambda timeout within minutes.
	GetExplanation(ctx context.Context, signature string) (string, bool, error)
	PutExplanation(ctx context.Context, signature, explanation string) error

	// --- reads for the dashboard -------------------------------------------

	RecentInvocations(ctx context.Context, limit int) ([]schema.InvocationEvent, error)
	RecentAnomalies(ctx context.Context, limit int) ([]schema.Anomaly, error)

	// --- websocket connections ---------------------------------------------

	AddConnection(ctx context.Context, connectionID string) error
	RemoveConnection(ctx context.Context, connectionID string) error
	ListConnections(ctx context.Context) ([]string, error)
}
