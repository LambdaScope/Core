// Command localrun executes the entire processor pipeline on a laptop.
//
// No AWS account, no deployed stack, no Kinesis, no DynamoDB, no Bedrock, and
// no dependency on the Rust extension existing yet. It swaps in the in-memory
// store and a stub explainer, feeds a generated scenario through the real
// detector, and prints exactly what the dashboard would have received.
//
//	go run ./cmd/localrun
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/fake"
	"github.com/LambdaScope/Core/internal/processor"
	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store"
)

// printingNotifier stands in for the WebSocket API: instead of pushing frames
// to a browser, it prints them.
type printingNotifier struct{ verbose bool }

func (p printingNotifier) Broadcast(_ context.Context, msg schema.WSMessage) error {
	switch msg.Type {
	case schema.MsgAnomaly:
		a := msg.Data.(schema.Anomaly)
		fmt.Printf("    >> ws anomaly         %s  severity=%s  status=%s\n",
			a.Kind, a.Severity, a.ExplanationStatus)
	case schema.MsgAnomalyUpdate:
		u := msg.Data.(schema.AnomalyUpdate)
		fmt.Printf("    >> ws anomaly_update  %s  status=%s\n", u.AnomalyID, u.ExplanationStatus)
		if u.Explanation != nil {
			fmt.Printf("       %s\n", *u.Explanation)
		}
	case schema.MsgInvocation:
		if p.verbose {
			b, _ := json.Marshal(msg.Data)
			fmt.Printf("    >> ws invocation      %s\n", b)
		}
	}
	return nil
}

// stubExplainer is what Bedrock will replace. Writing it as a stub first proves
// the two-phase alert flow works before a single model call is billed.
type stubExplainer struct{}

func (stubExplainer) Explain(_ context.Context, a schema.Anomaly) (string, error) {
	switch a.Kind {
	case schema.KindUnknownEndpoint:
		return fmt.Sprintf(
			"This function has contacted only %v across %v prior invocations. It has now opened a connection to %v, which is outside those. [stub - Bedrock will write this]",
			a.Evidence["known_endpoints"], a.Evidence["invocations_seen"], a.Evidence["endpoint"]), nil
	case schema.KindFDLeak:
		return fmt.Sprintf(
			"Container %v has gained %v file descriptors over %v consecutive invocations without releasing any. At this rate it will hit its limit of %v. [stub - Bedrock will write this]",
			a.Evidence["sandbox_id"], a.Evidence["growth"], a.Evidence["window"], a.Evidence["limit"]), nil
	}
	return anomaly.Describe(a) + " [stub]", nil
}

func main() {
	verbose := len(os.Args) > 1 && os.Args[1] == "-v"
	ctx := context.Background()

	mem := store.NewMemory()
	det := anomaly.New(anomaly.DefaultConfig(), anomaly.DevAWSRanges())

	p := processor.New(processor.Options{
		Store:    mem,
		Detector: det,
		Notifier: printingNotifier{verbose: verbose},
		Explain:  stubExplainer{},
		// Logs are suppressed so the output reads as a story. Drop the handler
		// to see the structured logs the Lambda would emit.
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	events := fake.Scenario()

	fmt.Println("LambdaScope - full pipeline, locally, no AWS")
	fmt.Println(strings.Repeat("=", 78))
	fmt.Printf("%d synthetic invocations of %s\n", len(events), fake.FunctionName)
	fmt.Println(strings.Repeat("=", 78))

	for i := range events {
		ev := &events[i]
		fmt.Printf("\n[%s] sandbox=%s  fd %d->%d  %dms  tier=%s\n",
			ev.InvocationID, ev.SandboxID, ev.FD.Start, ev.FD.End, ev.DurationMS, ev.Tier)
		for _, c := range ev.Connections {
			fmt.Printf("    -> %s\n", c.Endpoint())
		}
		if err := p.HandleEvent(ctx, ev); err != nil {
			fmt.Printf("    !! %v\n", err)
		}
	}

	anomalies, _ := mem.RecentAnomalies(ctx, 100)
	invocations, _ := mem.RecentInvocations(ctx, 100)

	fmt.Println()
	fmt.Println(strings.Repeat("=", 78))
	fmt.Printf("stored: %d invocations, %d anomalies\n", len(invocations), len(anomalies))
	for i := len(anomalies) - 1; i >= 0; i-- {
		a := anomalies[i]
		fmt.Printf("  [%-8s] %-17s %s\n", a.Severity, a.Kind, anomaly.Describe(a))
	}
}
