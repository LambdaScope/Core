package store_test

import (
	"context"
	"sort"
	"testing"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store"
	"github.com/LambdaScope/Core/internal/store/storetest"
)

// Every Store implementation must pass this same suite. Memory is what the
// processor tests run against; Dynamo is what runs in production. If the two
// ever disagree, a test that passes locally would lie about production.

func TestMemoryContract(t *testing.T) {
	runContract(t, func() store.Store { return store.NewMemory() })
}

func TestDynamoContract(t *testing.T) {
	runContract(t, func() store.Store {
		return store.NewDynamoWithAPI(storetest.NewFakeDynamo(), "lambdascope-test")
	})
}

func runContract(t *testing.T, newStore func() store.Store) {
	ctx := context.Background()

	t.Run("missing baseline is fresh, not an error", func(t *testing.T) {
		b, err := newStore().LoadBaseline(ctx, "fn-a")
		if err != nil {
			t.Fatal(err)
		}
		if b.Key != "fn-a" || b.InvocationCount != 0 || b.Knows("1.2.3.4:443") {
			t.Errorf("unexpected fresh baseline: %+v", b)
		}
	})

	t.Run("baseline round trip keeps learned state", func(t *testing.T) {
		st := newStore()
		b := anomaly.NewBaseline("fn-a")
		b.InvocationCount = 42
		b.KnownEndpoints["52.94.236.248:443"] = true
		b.SeenExternalEgress = true
		stat := &anomaly.SyscallStat{}
		stat.Update(10)
		stat.Update(14)
		b.Syscalls["openat"] = stat

		if err := st.SaveBaseline(ctx, b); err != nil {
			t.Fatal(err)
		}
		got, err := st.LoadBaseline(ctx, "fn-a")
		if err != nil {
			t.Fatal(err)
		}
		if got.InvocationCount != 42 || !got.Knows("52.94.236.248:443") || !got.SeenExternalEgress {
			t.Errorf("baseline lost fields: %+v", got)
		}
		if got.Syscalls["openat"] == nil || got.Syscalls["openat"].Count != 2 ||
			got.Syscalls["openat"].Mean != stat.Mean {
			t.Errorf("EWMA stats not preserved: %+v", got.Syscalls["openat"])
		}
	})

	t.Run("loaded baseline is a copy", func(t *testing.T) {
		st := newStore()
		b := anomaly.NewBaseline("fn-a")
		_ = st.SaveBaseline(ctx, b)

		got, _ := st.LoadBaseline(ctx, "fn-a")
		got.KnownEndpoints["6.6.6.6:22"] = true // mutate without saving

		again, _ := st.LoadBaseline(ctx, "fn-a")
		if again.Knows("6.6.6.6:22") {
			t.Error("mutating a loaded baseline changed stored state without a save")
		}
	})

	t.Run("sandbox round trip", func(t *testing.T) {
		st := newStore()
		s := anomaly.NewSandboxState("sbx-1")
		s.RecentDeltas = []int{2, 2, 3}
		s.LeakReported = true
		_ = st.SaveSandbox(ctx, s)

		got, err := st.LoadSandbox(ctx, "sbx-1")
		if err != nil {
			t.Fatal(err)
		}
		if len(got.RecentDeltas) != 3 || got.RecentDeltas[2] != 3 || !got.LeakReported {
			t.Errorf("sandbox state lost: %+v", got)
		}
	})

	t.Run("invocation write is idempotent", func(t *testing.T) {
		st := newStore()
		ev := &schema.InvocationEvent{InvocationID: "inv-1", StartMS: 100}

		first, err := st.PutInvocation(ctx, ev)
		if err != nil || !first {
			t.Fatalf("first write: new=%v err=%v", first, err)
		}
		second, err := st.PutInvocation(ctx, ev)
		if err != nil {
			t.Fatalf("duplicate write must not be an error: %v", err)
		}
		if second {
			t.Error("duplicate write reported as new - a Kinesis retry would re-alert")
		}
	})

	t.Run("anomaly write is idempotent", func(t *testing.T) {
		st := newStore()
		a := &schema.Anomaly{AnomalyID: "an-1", DetectedAtMS: 1, ExplanationStatus: schema.ExplanationPending}

		if ok, err := st.PutAnomaly(ctx, a); err != nil || !ok {
			t.Fatalf("first write: new=%v err=%v", ok, err)
		}
		if ok, err := st.PutAnomaly(ctx, a); err != nil || ok {
			t.Fatalf("duplicate write: new=%v err=%v", ok, err)
		}
	})

	// The dashboard snapshot reads anomalies back. If the explanation written
	// after the fact is not visible there, every alert shows "pending" forever.
	t.Run("explanation is visible when anomalies are read back", func(t *testing.T) {
		st := newStore()
		a := &schema.Anomaly{AnomalyID: "an-1", DetectedAtMS: 1, ExplanationStatus: schema.ExplanationPending}
		_, _ = st.PutAnomaly(ctx, a)

		text := "This function contacted an address outside AWS."
		if err := st.SetExplanation(ctx, "an-1", &text, schema.ExplanationReady); err != nil {
			t.Fatal(err)
		}

		got, err := st.RecentAnomalies(ctx, 10)
		if err != nil || len(got) != 1 {
			t.Fatalf("RecentAnomalies = %d, %v", len(got), err)
		}
		if got[0].ExplanationStatus != schema.ExplanationReady {
			t.Errorf("status = %q, want ready", got[0].ExplanationStatus)
		}
		if got[0].Explanation == nil || *got[0].Explanation != text {
			t.Errorf("explanation = %v, want %q", got[0].Explanation, text)
		}
	})

	t.Run("explaining an unknown anomaly is a no-op", func(t *testing.T) {
		st := newStore()
		text := "x"
		if err := st.SetExplanation(ctx, "does-not-exist", &text, schema.ExplanationReady); err != nil {
			t.Errorf("expected no error, got %v", err)
		}
		if got, _ := st.RecentAnomalies(ctx, 10); len(got) != 0 {
			t.Errorf("SetExplanation created an anomaly out of nothing: %+v", got)
		}
	})

	t.Run("explanation cache", func(t *testing.T) {
		st := newStore()
		if _, ok, err := st.GetExplanation(ctx, "sig-1"); err != nil || ok {
			t.Fatalf("empty cache: ok=%v err=%v", ok, err)
		}
		_ = st.PutExplanation(ctx, "sig-1", "cached text")
		got, ok, err := st.GetExplanation(ctx, "sig-1")
		if err != nil || !ok || got != "cached text" {
			t.Errorf("cache hit = %q, %v, %v", got, ok, err)
		}
	})

	t.Run("recent invocations are newest first and limited", func(t *testing.T) {
		st := newStore()
		for i, id := range []string{"inv-1", "inv-2", "inv-3", "inv-4"} {
			_, _ = st.PutInvocation(ctx, &schema.InvocationEvent{InvocationID: id, StartMS: int64(100 * (i + 1))})
		}
		got, err := st.RecentInvocations(ctx, 2)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 2 || got[0].InvocationID != "inv-4" || got[1].InvocationID != "inv-3" {
			t.Errorf("got %v, want [inv-4 inv-3]", ids(got))
		}
	})

	t.Run("recent anomalies are newest first and limited", func(t *testing.T) {
		st := newStore()
		for i, id := range []string{"an-1", "an-2", "an-3"} {
			_, _ = st.PutAnomaly(ctx, &schema.Anomaly{AnomalyID: id, DetectedAtMS: int64(i + 1)})
		}
		got, _ := st.RecentAnomalies(ctx, 2)
		if len(got) != 2 || got[0].AnomalyID != "an-3" || got[1].AnomalyID != "an-2" {
			t.Errorf("got %+v", got)
		}
	})

	t.Run("anomaly evidence survives storage", func(t *testing.T) {
		st := newStore()
		a := &schema.Anomaly{
			AnomalyID: "an-1", DetectedAtMS: 1,
			Evidence: map[string]any{"endpoint": "185.220.101.47:8443", "remote_port": 8443, "inside_aws": false},
		}
		_, _ = st.PutAnomaly(ctx, a)
		got, _ := st.RecentAnomalies(ctx, 1)
		if len(got) != 1 || got[0].Evidence["endpoint"] != "185.220.101.47:8443" || got[0].Evidence["inside_aws"] != false {
			t.Errorf("evidence mangled: %+v", got)
		}
	})

	t.Run("connections", func(t *testing.T) {
		st := newStore()
		for _, id := range []string{"c-b", "c-a", "c-c"} {
			if err := st.AddConnection(ctx, id); err != nil {
				t.Fatal(err)
			}
		}
		_ = st.RemoveConnection(ctx, "c-b")

		got, err := st.ListConnections(ctx)
		if err != nil {
			t.Fatal(err)
		}
		sort.Strings(got)
		if len(got) != 2 || got[0] != "c-a" || got[1] != "c-c" {
			t.Errorf("connections = %v, want [c-a c-c]", got)
		}
	})
}

func ids(evs []schema.InvocationEvent) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.InvocationID
	}
	return out
}
