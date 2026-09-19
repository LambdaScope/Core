package websocket

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi"
	"github.com/aws/aws-sdk-go-v2/service/apigatewaymanagementapi/types"
)

// fakePoster records every frame and can simulate closed or failing connections.
type fakePoster struct {
	mu      sync.Mutex
	sent    map[string][][]byte
	gone    map[string]bool
	failing map[string]bool
	delay   time.Duration

	inFlight, maxInFlight atomic.Int32
}

func newFakePoster() *fakePoster {
	return &fakePoster{sent: map[string][][]byte{}, gone: map[string]bool{}, failing: map[string]bool{}}
}

func (f *fakePoster) PostToConnection(_ context.Context, in *apigatewaymanagementapi.PostToConnectionInput,
	_ ...func(*apigatewaymanagementapi.Options)) (*apigatewaymanagementapi.PostToConnectionOutput, error) {

	cur := f.inFlight.Add(1)
	defer f.inFlight.Add(-1)
	for {
		m := f.maxInFlight.Load()
		if cur <= m || f.maxInFlight.CompareAndSwap(m, cur) {
			break
		}
	}
	if f.delay > 0 {
		time.Sleep(f.delay)
	}

	id := aws.ToString(in.ConnectionId)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.gone[id] {
		return nil, &types.GoneException{Message: aws.String("gone")}
	}
	if f.failing[id] {
		return nil, errors.New("throttled")
	}
	f.sent[id] = append(f.sent[id], in.Data)
	return &apigatewaymanagementapi.PostToConnectionOutput{}, nil
}

func (f *fakePoster) framesFor(id string) [][]byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sent[id]
}

func connected(t *testing.T, ids ...string) *store.Memory {
	t.Helper()
	st := store.NewMemory()
	for _, id := range ids {
		if err := st.AddConnection(context.Background(), id); err != nil {
			t.Fatal(err)
		}
	}
	return st
}

// --- Notifier --------------------------------------------------------------

func TestBroadcastReachesEveryViewer(t *testing.T) {
	st := connected(t, "a", "b", "c")
	p := newFakePoster()

	msg := schema.NewWSMessage(schema.MsgAnomaly, map[string]string{"anomaly_id": "an-1"})
	if err := NewNotifier(p, st).Broadcast(context.Background(), msg); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b", "c"} {
		frames := p.framesFor(id)
		if len(frames) != 1 {
			t.Fatalf("%s received %d frames, want 1", id, len(frames))
		}
		var got schema.WSMessage
		if err := json.Unmarshal(frames[0], &got); err != nil || got.Type != schema.MsgAnomaly || got.V != schema.Version {
			t.Errorf("%s got %s", id, frames[0])
		}
	}
}

// A closed tab is routine. It must be forgotten, not reported, and must not
// stop anyone else receiving the frame.
func TestGoneConnectionIsRemovedSilently(t *testing.T) {
	st := connected(t, "alive", "closed")
	p := newFakePoster()
	p.gone["closed"] = true

	err := NewNotifier(p, st).Broadcast(context.Background(), schema.NewWSMessage(schema.MsgInvocation, nil))
	if err != nil {
		t.Errorf("a gone connection must not be an error: %v", err)
	}
	if len(p.framesFor("alive")) != 1 {
		t.Error("the live viewer did not receive the frame")
	}
	left, _ := st.ListConnections(context.Background())
	if len(left) != 1 || left[0] != "alive" {
		t.Errorf("connections after broadcast = %v, want [alive]", left)
	}
}

// A real failure is reported, but the connection is kept - it may recover.
func TestOtherFailuresAreReportedAndKept(t *testing.T) {
	st := connected(t, "ok", "flaky")
	p := newFakePoster()
	p.failing["flaky"] = true

	err := NewNotifier(p, st).Broadcast(context.Background(), schema.NewWSMessage(schema.MsgInvocation, nil))
	if err == nil || !strings.Contains(err.Error(), "flaky") {
		t.Errorf("err = %v, want it to name the failing connection", err)
	}
	if len(p.framesFor("ok")) != 1 {
		t.Error("one failing viewer blocked delivery to the others")
	}
	left, _ := st.ListConnections(context.Background())
	sort.Strings(left)
	if len(left) != 2 {
		t.Errorf("a transient failure removed a connection: %v", left)
	}
}

func TestOversizedFrameIsRefusedBeforeSending(t *testing.T) {
	st := connected(t, "a")
	p := newFakePoster()

	huge := strings.Repeat("x", MaxFrameBytes)
	err := NewNotifier(p, st).Broadcast(context.Background(), schema.NewWSMessage(schema.MsgInvocation, huge))
	if !errors.Is(err, ErrFrameTooLarge) {
		t.Errorf("err = %v, want ErrFrameTooLarge", err)
	}
	if len(p.framesFor("a")) != 0 {
		t.Error("an oversized frame was sent anyway")
	}
}

func TestFanOutIsBounded(t *testing.T) {
	ids := make([]string, 40)
	for i := range ids {
		ids[i] = "c" + string(rune('A'+i))
	}
	st := connected(t, ids...)
	p := newFakePoster()
	p.delay = 5 * time.Millisecond

	if err := NewNotifier(p, st).Broadcast(context.Background(), schema.NewWSMessage(schema.MsgInvocation, nil)); err != nil {
		t.Fatal(err)
	}
	if got := p.maxInFlight.Load(); got > fanOut {
		t.Errorf("max concurrent posts = %d, want <= %d", got, fanOut)
	}
	if got := p.maxInFlight.Load(); got < 2 {
		t.Errorf("max concurrent posts = %d - broadcast is serial", got)
	}
}

func TestNoViewersIsNotAnError(t *testing.T) {
	err := NewNotifier(newFakePoster(), store.NewMemory()).Broadcast(context.Background(), schema.NewWSMessage(schema.MsgInvocation, nil))
	if err != nil {
		t.Error(err)
	}
}

// --- Handler ---------------------------------------------------------------

func request(route, connID, body string) events.APIGatewayWebsocketProxyRequest {
	return events.APIGatewayWebsocketProxyRequest{
		Body: body,
		RequestContext: events.APIGatewayWebsocketProxyRequestContext{
			RouteKey:     route,
			ConnectionID: connID,
			DomainName:   "abc123.execute-api.ap-south-1.amazonaws.com",
			Stage:        "prod",
		},
	}
}

func newTestHandler(st store.Store, p *fakePoster) (*Handler, *[]string) {
	var endpoints []string
	h := NewHandler(st, func(_ context.Context, endpoint string) (Poster, error) {
		endpoints = append(endpoints, endpoint)
		return p, nil
	}, nil)
	return h, &endpoints
}

func TestConnectAndDisconnect(t *testing.T) {
	st := store.NewMemory()
	h, _ := newTestHandler(st, newFakePoster())
	ctx := context.Background()

	resp, _ := h.Handle(ctx, request("$connect", "c1", ""))
	if resp.StatusCode != 200 {
		t.Fatalf("$connect = %d", resp.StatusCode)
	}
	if ids, _ := st.ListConnections(ctx); len(ids) != 1 || ids[0] != "c1" {
		t.Fatalf("after connect: %v", ids)
	}

	resp, _ = h.Handle(ctx, request("$disconnect", "c1", ""))
	if resp.StatusCode != 200 {
		t.Fatalf("$disconnect = %d", resp.StatusCode)
	}
	if ids, _ := st.ListConnections(ctx); len(ids) != 0 {
		t.Errorf("after disconnect: %v", ids)
	}
}

func TestSnapshotIsSentToTheAskingViewer(t *testing.T) {
	st := connected(t, "asker", "bystander")
	ctx := context.Background()
	_, _ = st.PutInvocation(ctx, &schema.InvocationEvent{InvocationID: "inv-1", StartMS: 1})
	explained := "outside AWS"
	_, _ = st.PutAnomaly(ctx, &schema.Anomaly{AnomalyID: "an-1", DetectedAtMS: 1, ExplanationStatus: schema.ExplanationPending})
	_ = st.SetExplanation(ctx, "an-1", &explained, schema.ExplanationReady)

	p := newFakePoster()
	h, endpoints := newTestHandler(st, p)

	resp, _ := h.Handle(ctx, request("$default", "asker", `{"action":"snapshot"}`))
	if resp.StatusCode != 200 {
		t.Fatalf("snapshot = %d %s", resp.StatusCode, resp.Body)
	}
	if len(p.framesFor("bystander")) != 0 {
		t.Error("the snapshot was broadcast instead of sent to one viewer")
	}

	frames := p.framesFor("asker")
	if len(frames) != 1 {
		t.Fatalf("asker got %d frames", len(frames))
	}
	var got struct {
		V    int             `json:"v"`
		Type string          `json:"type"`
		Data schema.Snapshot `json:"data"`
	}
	if err := json.Unmarshal(frames[0], &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != schema.MsgSnapshot || len(got.Data.Invocations) != 1 || len(got.Data.Anomalies) != 1 {
		t.Errorf("snapshot = %+v", got)
	}
	if got.Data.Anomalies[0].ExplanationStatus != schema.ExplanationReady {
		t.Error("snapshot shows a stale explanation status")
	}

	want := "https://abc123.execute-api.ap-south-1.amazonaws.com/prod"
	if len(*endpoints) != 1 || (*endpoints)[0] != want {
		t.Errorf("management endpoint = %v, want %s", *endpoints, want)
	}
}

// A client is built once per endpoint and reused, not rebuilt per message.
func TestPosterIsReused(t *testing.T) {
	st := connected(t, "a")
	h, endpoints := newTestHandler(st, newFakePoster())
	for i := 0; i < 3; i++ {
		h.Handle(context.Background(), request("$default", "a", `{"action":"snapshot"}`))
	}
	if len(*endpoints) != 1 {
		t.Errorf("built %d management clients, want 1", len(*endpoints))
	}
}

func TestEndpointOverrideForCustomDomains(t *testing.T) {
	st := connected(t, "a")
	h, endpoints := newTestHandler(st, newFakePoster())
	h.Endpoint = "https://ws.example.com/prod"
	h.Handle(context.Background(), request("$default", "a", `{"action":"snapshot"}`))
	if len(*endpoints) != 1 || (*endpoints)[0] != "https://ws.example.com/prod" {
		t.Errorf("endpoints = %v", *endpoints)
	}
}

func TestBadMessagesAreRejected(t *testing.T) {
	h, _ := newTestHandler(connected(t, "a"), newFakePoster())
	for _, body := range []string{`not json`, `{"action":"delete_everything"}`, `{}`} {
		resp, _ := h.Handle(context.Background(), request("$default", "a", body))
		if resp.StatusCode != 400 {
			t.Errorf("body %q -> %d, want 400", body, resp.StatusCode)
		}
	}
}

// If history is too big for one frame, drop old invocations, never anomalies.
func TestOversizedSnapshotKeepsAnomalies(t *testing.T) {
	st := connected(t, "a")
	ctx := context.Background()
	pad := strings.Repeat("p", 4000)
	for i := 0; i < snapshotInvocations; i++ {
		_, _ = st.PutInvocation(ctx, &schema.InvocationEvent{
			InvocationID: "inv-" + string(rune('A'+i)), StartMS: int64(i), FunctionName: pad,
		})
	}
	_, _ = st.PutAnomaly(ctx, &schema.Anomaly{AnomalyID: "an-1", DetectedAtMS: 1})

	p := newFakePoster()
	h, _ := newTestHandler(st, p)
	resp, _ := h.Handle(ctx, request("$default", "a", `{"action":"snapshot"}`))
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}

	frame := p.framesFor("a")[0]
	if len(frame) > MaxFrameBytes {
		t.Fatalf("frame is %d bytes", len(frame))
	}
	var got struct {
		Data schema.Snapshot `json:"data"`
	}
	_ = json.Unmarshal(frame, &got)
	if len(got.Data.Anomalies) != 1 {
		t.Error("anomalies were dropped to make room")
	}
	if len(got.Data.Invocations) == 0 || len(got.Data.Invocations) >= snapshotInvocations {
		t.Errorf("kept %d invocations; expected some, but fewer than %d", len(got.Data.Invocations), snapshotInvocations)
	}
}
