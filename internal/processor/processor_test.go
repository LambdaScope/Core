package processor

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/fake"
	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store"
	"github.com/LambdaScope/Core/internal/store/storetest"
	"github.com/aws/aws-lambda-go/events"
)

// --- fixtures --------------------------------------------------------------

type countingExplainer struct {
	calls int
	text  string
	err   error
}

func (c *countingExplainer) Explain(context.Context, schema.Anomaly) (string, error) {
	c.calls++
	if c.err != nil {
		return "", c.err
	}
	return c.text, nil
}

type countingAlerter struct{ calls int }

func (c *countingAlerter) Alert(context.Context, schema.Anomaly) error {
	c.calls++
	return nil
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type harness struct {
	p     *Processor
	store *store.Memory
	notif *CollectingNotifier
	expl  *countingExplainer
	alert *countingAlerter
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	mem := store.NewMemory()
	notif := &CollectingNotifier{}
	expl := &countingExplainer{text: "Claude would say something useful here."}
	alert := &countingAlerter{}

	det := anomaly.New(anomaly.DefaultConfig(), anomaly.DevAWSRanges())
	det.SetClock(func() int64 { return 1_700_000_000_000 })

	return &harness{
		p: New(Options{
			Store: mem, Detector: det, Notifier: notif,
			Explain: expl, Alerter: alert, Log: quietLogger(),
		}),
		store: mem, notif: notif, expl: expl, alert: alert,
	}
}

func event(invID, sandbox, ip string, port int) *schema.InvocationEvent {
	return &schema.InvocationEvent{
		V:            schema.Version,
		Type:         "invocation",
		InvocationID: invID,
		SandboxID:    sandbox,
		FunctionARN:  "arn:aws:lambda:ap-south-1:123456789012:function:demo",
		FunctionName: "demo",
		Tier:         schema.TierProcFallback,
		FD:           schema.FD{Start: 12, End: 12, Delta: 0, Limit: 1024},
		Connections: []schema.Connection{
			{RemoteIP: ip, RemotePort: port, Proto: "tcp"},
		},
	}
}

// teach walks the learning window using an in-AWS endpoint.
func (h *harness) teach(t *testing.T) {
	t.Helper()
	for i := 0; i < anomaly.DefaultConfig().LearningWindow; i++ {
		ev := event("learn-"+string(rune('a'+i)), "sbx-1", "52.94.236.248", 443)
		if err := h.p.HandleEvent(context.Background(), ev); err != nil {
			t.Fatalf("learning event %d: %v", i, err)
		}
	}
	h.notif.Messages = nil // discard the learning traffic
}

// --- tests -----------------------------------------------------------------

func TestPipelineEndToEnd(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	h.teach(t)

	ev := event("inv-bad", "sbx-1", "185.220.101.47", 8443)
	if err := h.p.HandleEvent(ctx, ev); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}

	// The dashboard must see the invocation, then the alert, then the prose -
	// in that order. The alert must not wait for the explanation.
	want := []string{schema.MsgInvocation, schema.MsgAnomaly, schema.MsgAnomalyUpdate}
	got := h.notif.TypesSeen()
	if len(got) != len(want) {
		t.Fatalf("broadcast types = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("broadcast types = %v, want %v", got, want)
		}
	}

	// The alert itself goes out with nothing filled in yet.
	first := h.notif.Messages[1].Data.(schema.Anomaly)
	if first.ExplanationStatus != schema.ExplanationPending {
		t.Errorf("first alert status = %q, want pending", first.ExplanationStatus)
	}

	// The update carries the same id and the finished text.
	upd := h.notif.Messages[2].Data.(schema.AnomalyUpdate)
	if upd.AnomalyID != first.AnomalyID {
		t.Errorf("update id %q does not match alert id %q", upd.AnomalyID, first.AnomalyID)
	}
	if upd.ExplanationStatus != schema.ExplanationReady {
		t.Errorf("update status = %q, want ready", upd.ExplanationStatus)
	}

	// And it was persisted, not just broadcast.
	stored, err := h.store.RecentAnomalies(ctx, 10)
	if err != nil || len(stored) != 1 {
		t.Fatalf("RecentAnomalies = %d, %v", len(stored), err)
	}
	if stored[0].Explanation == nil || *stored[0].Explanation != h.expl.text {
		t.Errorf("explanation not persisted: %+v", stored[0].Explanation)
	}
}

// Kinesis is at-least-once. The same record arriving twice must not produce a
// second alert or a second model call.
func TestDuplicateRecordIsIgnored(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	h.teach(t)

	ev := event("inv-dup", "sbx-1", "185.220.101.47", 8443)
	for i := 0; i < 3; i++ {
		if err := h.p.HandleEvent(ctx, ev); err != nil {
			t.Fatalf("delivery %d: %v", i, err)
		}
	}

	stored, _ := h.store.RecentAnomalies(ctx, 10)
	if len(stored) != 1 {
		t.Errorf("got %d anomalies from 3 deliveries of one record, want 1", len(stored))
	}
	if h.expl.calls != 1 {
		t.Errorf("explainer called %d times, want 1", h.expl.calls)
	}
}

// The signature cache is what keeps the model bill survivable.
func TestExplanationCacheAvoidsRepeatCalls(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	h.teach(t)

	// Same bad endpoint, three different invocations.
	for _, id := range []string{"inv-1", "inv-2", "inv-3"} {
		if err := h.p.HandleEvent(ctx, event(id, "sbx-1", "185.220.101.47", 8443)); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
	}

	stored, _ := h.store.RecentAnomalies(ctx, 10)
	if len(stored) != 3 {
		t.Errorf("got %d anomalies, want 3 distinct alerts", len(stored))
	}
	if h.expl.calls != 1 {
		t.Errorf("explainer called %d times for one repeated problem, want 1", h.expl.calls)
	}
	for _, a := range stored {
		if a.ExplanationStatus != schema.ExplanationReady {
			t.Errorf("cached alert %s left as %q", a.AnomalyID, a.ExplanationStatus)
		}
	}
}

// A model outage must degrade the alert, never lose it.
func TestExplainerFailureStillDelivers(t *testing.T) {
	h := newHarness(t)
	h.expl.err = errors.New("bedrock unavailable")
	ctx := context.Background()
	h.teach(t)

	if err := h.p.HandleEvent(ctx, event("inv-x", "sbx-1", "185.220.101.47", 8443)); err != nil {
		t.Fatalf("a failing explainer must not fail the record: %v", err)
	}

	stored, _ := h.store.RecentAnomalies(ctx, 10)
	if len(stored) != 1 {
		t.Fatalf("alert was lost, got %d", len(stored))
	}
	if stored[0].ExplanationStatus != schema.ExplanationFailed {
		t.Errorf("status = %q, want failed", stored[0].ExplanationStatus)
	}
	if stored[0].Explanation == nil || *stored[0].Explanation == "" {
		t.Error("no fallback text - the dashboard would show an empty alert")
	}
}

func TestOnlySevereAnomaliesPageOutOfBand(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	h.teach(t)

	// A new endpoint that is still inside AWS ranks low - dashboard only.
	if err := h.p.HandleEvent(ctx, event("inv-low", "sbx-1", "54.239.28.85", 443)); err != nil {
		t.Fatal(err)
	}
	if h.alert.calls != 0 {
		t.Errorf("low severity paged out of band %d times, want 0", h.alert.calls)
	}

	// First-ever egress outside AWS is critical - this one should page.
	if err := h.p.HandleEvent(ctx, event("inv-crit", "sbx-1", "185.220.101.47", 443)); err != nil {
		t.Fatal(err)
	}
	if h.alert.calls != 1 {
		t.Errorf("critical paged %d times, want 1", h.alert.calls)
	}
}

// --- Kinesis batch semantics ----------------------------------------------

type failingStore struct{ *store.Memory }

func (f failingStore) PutInvocation(context.Context, *schema.InvocationEvent) (bool, error) {
	return false, errors.New("dynamodb throttled")
}

func kinesisRecord(t *testing.T, seq string, payload any) events.KinesisEventRecord {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return events.KinesisEventRecord{
		Kinesis: events.KinesisRecord{SequenceNumber: seq, Data: b},
	}
}

// A record that can never parse must be dropped, not retried - otherwise one
// bad message blocks the shard forever.
func TestMalformedRecordIsDroppedNotRetried(t *testing.T) {
	h := newHarness(t)

	batch := events.KinesisEvent{Records: []events.KinesisEventRecord{
		{Kinesis: events.KinesisRecord{SequenceNumber: "seq-1", Data: []byte("{not json")}},
		kinesisRecord(t, "seq-2", map[string]any{"v": 1, "type": "invocation"}), // missing required fields
		kinesisRecord(t, "seq-3", event("inv-ok", "sbx-1", "52.94.236.248", 443)),
	}}

	resp, err := h.p.HandleKinesis(context.Background(), batch)
	if err != nil {
		t.Fatalf("HandleKinesis must never return an error: %v", err)
	}
	if len(resp.BatchItemFailures) != 0 {
		t.Errorf("malformed records were queued for retry: %+v", resp.BatchItemFailures)
	}

	stored, _ := h.store.RecentInvocations(context.Background(), 10)
	if len(stored) != 1 {
		t.Errorf("the good record in the batch was not processed (got %d)", len(stored))
	}
}

// A transient failure must come back as a per-record failure, so Lambda retries
// only that record and not the whole batch.
func TestTransientFailureReportsOnlyThatRecord(t *testing.T) {
	mem := store.NewMemory()
	det := anomaly.New(anomaly.DefaultConfig(), anomaly.DevAWSRanges())
	p := New(Options{Store: failingStore{mem}, Detector: det, Log: quietLogger()})

	batch := events.KinesisEvent{Records: []events.KinesisEventRecord{
		kinesisRecord(t, "seq-A", event("inv-1", "sbx-1", "52.94.236.248", 443)),
		kinesisRecord(t, "seq-B", event("inv-2", "sbx-1", "52.94.236.248", 443)),
	}}

	resp, err := p.HandleKinesis(context.Background(), batch)
	if err != nil {
		t.Fatalf("HandleKinesis must never return an error: %v", err)
	}
	if len(resp.BatchItemFailures) != 2 {
		t.Fatalf("got %d failures, want 2", len(resp.BatchItemFailures))
	}
	if resp.BatchItemFailures[0].ItemIdentifier != "seq-A" {
		t.Errorf("failure identifier = %q, want the Kinesis sequence number",
			resp.BatchItemFailures[0].ItemIdentifier)
	}
}

// The browser must not be sent a 400-entry syscall map.
func TestSyscallMapIsTrimmedForTheWire(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	ev := event("inv-sys", "sbx-1", "52.94.236.248", 443)
	ev.Tier = schema.TierKernelEBPF
	ev.Syscalls = map[string]int{}
	for i := 0; i < 50; i++ {
		ev.Syscalls[string(rune('a'+i%26))+string(rune('a'+i/26))] = i
	}

	if err := h.p.HandleEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}

	sent := h.notif.Messages[0].Data.(schema.InvocationEvent)
	if len(sent.Syscalls) != maxSyscallsOnWire {
		t.Errorf("sent %d syscalls to the dashboard, want %d", len(sent.Syscalls), maxSyscallsOnWire)
	}
	if len(ev.Syscalls) != 50 {
		t.Error("trimming mutated the original event")
	}
}

// --- the same scenario, both stores ----------------------------------------

// runScenario pushes the full generated story through a processor backed by st
// and returns what ended up stored.
func runScenario(t *testing.T, st store.Store) []schema.Anomaly {
	t.Helper()
	det := anomaly.New(anomaly.DefaultConfig(), anomaly.DevAWSRanges())
	det.SetClock(func() int64 { return 1_700_000_000_000 })
	p := New(Options{
		Store: st, Detector: det, Explain: &countingExplainer{text: "explained"},
		Log: quietLogger(),
	})
	for _, ev := range fake.Scenario() {
		ev := ev
		if err := p.HandleEvent(context.Background(), &ev); err != nil {
			t.Fatalf("%s: %v", ev.InvocationID, err)
		}
	}
	got, err := st.RecentAnomalies(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// The production store must reach exactly the same conclusions as the one the
// rest of the tests use. If these diverge, every other test is testing the
// wrong thing.
func TestScenarioAgainstDynamoMatchesMemory(t *testing.T) {
	mem := runScenario(t, store.NewMemory())
	ddb := runScenario(t, store.NewDynamoWithAPI(storetest.NewFakeDynamo(), "lambdascope-test"))

	if len(mem) != 4 {
		t.Fatalf("memory store raised %d anomalies, want 4", len(mem))
	}
	if len(ddb) != len(mem) {
		t.Fatalf("dynamo store raised %d anomalies, memory raised %d", len(ddb), len(mem))
	}

	seen := make(map[string]schema.Anomaly, len(mem))
	for _, a := range mem {
		seen[a.AnomalyID] = a
	}
	for _, a := range ddb {
		m, ok := seen[a.AnomalyID]
		if !ok {
			t.Errorf("dynamo produced %s which memory did not", a.AnomalyID)
			continue
		}
		if a.Kind != m.Kind || a.Severity != m.Severity {
			t.Errorf("%s: dynamo=%s/%s memory=%s/%s", a.AnomalyID, a.Kind, a.Severity, m.Kind, m.Severity)
		}
		if a.ExplanationStatus != schema.ExplanationReady {
			t.Errorf("%s: explanation not persisted through dynamo (status %q)", a.AnomalyID, a.ExplanationStatus)
		}
	}
}
