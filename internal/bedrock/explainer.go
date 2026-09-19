// Package bedrock turns a structured anomaly into a short explanation a human
// can act on, using Claude on Amazon Bedrock.
//
// It only ever runs on a confirmed anomaly, never per invocation, and the
// processor caches its output by anomaly signature - so the same problem seen
// a thousand times costs one call.
package bedrock

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/LambdaScope/Core/internal/schema"
	"github.com/anthropics/anthropic-sdk-go"
	anthropicbedrock "github.com/anthropics/anthropic-sdk-go/bedrock"
)

// DefaultModel is Claude Opus 5 as addressed on Bedrock. Model access has to be
// enabled for the account in the Bedrock console before calls succeed.
const DefaultModel = "anthropic.claude-opus-5"

// systemPrompt is fixed text - nothing per-request goes in here.
//
// The key instruction is to describe the pattern rather than the instance.
// One explanation is cached and shown for every recurrence of the same
// anomaly, so a sentence like "after 14 invocations" would be wrong the second
// time it is displayed.
const systemPrompt = `You are the analysis layer of LambdaScope, a runtime security monitor for AWS Lambda functions. You receive one anomaly that the detector has already confirmed, as JSON, and you write the explanation an on-call engineer reads on the dashboard.

How the detector works, so you can reason about the evidence:
- unknown_endpoint: the function opened a network connection to an ip:port that is not in its learned baseline. "inside_aws" says whether the address is within Amazon's published IP ranges. "known_endpoints" is everything the function normally contacts.
- fd_leak: inside one warm container, open file descriptors grew on every one of several consecutive invocations. "growth" is the total increase across the window and "limit" is the process's descriptor limit.
- syscall_outlier: a syscall was made that this function has never made before, or at a count far outside its running statistics.

Write two or three plain sentences: what happened, why it matters for this function, and the first thing to check. Describe the pattern, not the specific occurrence - this text is cached and shown for every repeat of the same anomaly, so do not mention invocation counts, timestamps, or request ids. Only state what the evidence supports; if a cause is a possibility rather than a fact, say so. No markdown, no headings, no bullet points.`

type Explainer struct {
	messages *anthropic.MessageService
	model    string
}

// New builds an explainer on the Bedrock Messages API. Credentials come from
// the Lambda execution role through the default AWS chain. Build it once at
// cold start and reuse it.
func New(ctx context.Context, region, model string) (*Explainer, error) {
	if model == "" {
		model = DefaultModel
	}
	client, err := anthropicbedrock.NewMantleClient(ctx, anthropicbedrock.MantleClientConfig{AWSRegion: region})
	if err != nil {
		return nil, fmt.Errorf("bedrock client: %w", err)
	}
	return &Explainer{messages: &client.Messages, model: model}, nil
}

// NewWithService wraps an existing message service. Used by tests to point the
// real SDK at a local server.
func NewWithService(messages *anthropic.MessageService, model string) *Explainer {
	if model == "" {
		model = DefaultModel
	}
	return &Explainer{messages: messages, model: model}
}

// ErrRefused is returned when the model declines to answer. The processor
// treats every error the same way - it falls back to deterministic local text -
// so a refusal degrades the alert's prose, never the alert itself.
var ErrRefused = errors.New("model declined to explain this anomaly")

// Explain implements processor.Explainer.
func (e *Explainer) Explain(ctx context.Context, a schema.Anomaly) (string, error) {
	payload, err := json.Marshal(promptView(a))
	if err != nil {
		return "", err
	}

	resp, err := e.messages.New(ctx, anthropic.MessageNewParams{
		Model: anthropic.Model(e.model),
		// Room for adaptive thinking plus a few sentences.
		MaxTokens: 2048,
		System:    []anthropic.TextBlockParam{{Text: systemPrompt}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(string(payload))),
		},
		// A short explanation of already-structured evidence does not need
		// deep deliberation, and this call sits between the alert and the
		// engineer reading it.
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortLow},
	})
	if err != nil {
		return "", fmt.Errorf("bedrock: %w", err)
	}

	if resp.StopReason == anthropic.StopReasonRefusal {
		return "", ErrRefused
	}

	var b strings.Builder
	for _, block := range resp.Content {
		if text, ok := block.AsAny().(anthropic.TextBlock); ok {
			b.WriteString(text.Text)
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		return "", fmt.Errorf("bedrock: empty response (stop_reason %q)", resp.StopReason)
	}
	return out, nil
}

// volatileEvidence are fields that differ between recurrences of the same
// anomaly. They are withheld from the model so the cached text stays true for
// every repeat it is shown for.
var volatileEvidence = map[string]bool{
	"invocations_seen": true,
	"current":          true,
	"headroom":         true,
}

// promptView is the subset of the anomaly the model sees.
func promptView(a schema.Anomaly) map[string]any {
	evidence := make(map[string]any, len(a.Evidence))
	for k, v := range a.Evidence {
		if !volatileEvidence[k] {
			evidence[k] = v
		}
	}
	return map[string]any{
		"kind":     a.Kind,
		"severity": a.Severity,
		"function": a.FunctionName,
		"evidence": evidence,
	}
}
