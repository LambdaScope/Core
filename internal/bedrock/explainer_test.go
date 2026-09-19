package bedrock

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/LambdaScope/Core/internal/schema"
	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// These tests drive the real Anthropic SDK against a local HTTP server, so the
// request we build and the response parsing are both exercised for real. Only
// the network destination is fake.

type captured struct {
	path string
	body map[string]any
}

func serve(t *testing.T, status int, response string) (*Explainer, *captured) {
	t.Helper()
	got := &captured{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.path = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got.body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, response)
	}))
	t.Cleanup(srv.Close)

	client := anthropic.NewClient(
		option.WithBaseURL(srv.URL),
		option.WithAPIKey("test"),
		option.WithMaxRetries(0),
	)
	return NewWithService(&client.Messages, ""), got
}

func reply(stopReason string, blocks ...string) string {
	return `{"id":"msg_1","type":"message","role":"assistant","model":"anthropic.claude-opus-5",
		"content":[` + strings.Join(blocks, ",") + `],
		"stop_reason":"` + stopReason + `","stop_sequence":null,
		"usage":{"input_tokens":120,"output_tokens":40}}`
}

func textBlock(s string) string {
	b, _ := json.Marshal(map[string]string{"type": "text", "text": s})
	return string(b)
}

func sampleAnomaly() schema.Anomaly {
	return schema.Anomaly{
		AnomalyID:    "an-1",
		FunctionName: "demo-checkout-api",
		Kind:         schema.KindUnknownEndpoint,
		Severity:     schema.SeverityCritical,
		Evidence: map[string]any{
			"endpoint":         "185.220.101.47:8443",
			"inside_aws":       false,
			"known_endpoints":  []string{"52.216.153.51:443", "52.94.236.248:443"},
			"invocations_seen": 14,
		},
	}
}

func TestExplainReturnsModelText(t *testing.T) {
	want := "The function connected to an address outside AWS that it has never contacted."
	e, _ := serve(t, 200, reply("end_turn", textBlock("  "+want+"\n")))

	got, err := e.Explain(context.Background(), sampleAnomaly())
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRequestShape(t *testing.T) {
	e, req := serve(t, 200, reply("end_turn", textBlock("ok")))
	if _, err := e.Explain(context.Background(), sampleAnomaly()); err != nil {
		t.Fatal(err)
	}

	if req.path != "/v1/messages" {
		t.Errorf("path = %q", req.path)
	}
	if req.body["model"] != DefaultModel {
		t.Errorf("model = %v, want %s", req.body["model"], DefaultModel)
	}
	if oc, _ := req.body["output_config"].(map[string]any); oc["effort"] != "low" {
		t.Errorf("output_config = %v, want effort low", req.body["output_config"])
	}

	raw, _ := json.Marshal(req.body["messages"])
	user := string(raw)
	if !strings.Contains(user, "185.220.101.47:8443") {
		t.Error("the endpoint was not sent to the model")
	}
	// Volatile fields would make the cached text wrong on every repeat.
	if strings.Contains(user, "invocations_seen") {
		t.Error("invocations_seen leaked into the prompt")
	}

	sys, _ := json.Marshal(req.body["system"])
	if !strings.Contains(string(sys), "Describe the pattern, not the specific occurrence") {
		t.Error("system prompt lost the pattern-not-instance rule")
	}
}

// Thinking blocks precede the answer; only the text is the explanation.
func TestThinkingBlocksAreIgnored(t *testing.T) {
	thinking := `{"type":"thinking","thinking":"","signature":"sig"}`
	e, _ := serve(t, 200, reply("end_turn", thinking, textBlock("Only this.")))

	got, err := e.Explain(context.Background(), sampleAnomaly())
	if err != nil {
		t.Fatal(err)
	}
	if got != "Only this." {
		t.Errorf("got %q", got)
	}
}

func TestRefusalIsAnError(t *testing.T) {
	e, _ := serve(t, 200, reply("refusal"))
	_, err := e.Explain(context.Background(), sampleAnomaly())
	if !errors.Is(err, ErrRefused) {
		t.Errorf("err = %v, want ErrRefused", err)
	}
}

func TestEmptyAnswerIsAnError(t *testing.T) {
	e, _ := serve(t, 200, reply("end_turn", textBlock("   ")))
	if _, err := e.Explain(context.Background(), sampleAnomaly()); err == nil {
		t.Error("empty text must be an error so the processor uses its fallback")
	}
}

func TestServiceErrorIsAnError(t *testing.T) {
	e, _ := serve(t, 500, `{"type":"error","error":{"type":"api_error","message":"boom"}}`)
	if _, err := e.Explain(context.Background(), sampleAnomaly()); err == nil {
		t.Error("a 500 must surface as an error")
	}
}
