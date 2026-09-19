package store

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/schema"
	"github.com/LambdaScope/Core/internal/store/storetest"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Behaviour specific to the DynamoDB layout that the shared contract cannot see.

func frozenDynamo(t *testing.T) (*Dynamo, *storetest.FakeDynamo, time.Time) {
	t.Helper()
	fake := storetest.NewFakeDynamo()
	d := NewDynamoWithAPI(fake, "lambdascope-test")
	now := time.Date(2026, 9, 19, 12, 0, 0, 0, time.UTC)
	d.now = func() time.Time { return now }
	return d, fake, now
}

func ttlOf(t *testing.T, it map[string]ddbtypes.AttributeValue) int64 {
	t.Helper()
	v, ok := it["ttl"].(*ddbtypes.AttributeValueMemberN)
	if !ok {
		t.Fatalf("item has no numeric ttl: %v", it)
	}
	i, _ := strconv.ParseInt(v.Value, 10, 64)
	return i
}

// DynamoDB TTL is epoch SECONDS. Writing milliseconds would schedule deletion
// roughly 50,000 years out, and the table would never clean itself up.
func TestTTLIsEpochSeconds(t *testing.T) {
	d, fake, now := frozenDynamo(t)
	ctx := context.Background()

	_, _ = d.PutInvocation(ctx, &schema.InvocationEvent{InvocationID: "inv-1", StartMS: 1})

	got := ttlOf(t, fake.Item("INV#inv-1", "META"))
	want := now.Add(24 * time.Hour).Unix()
	if got != want {
		t.Errorf("ttl = %d, want %d (epoch seconds, 24h out)", got, want)
	}
}

// Learned behaviour must never expire; losing it means a silent relearning window.
func TestBaselineHasNoTTL(t *testing.T) {
	d, fake, _ := frozenDynamo(t)
	_ = d.SaveBaseline(context.Background(), anomaly.NewBaseline("fn-a"))

	it := fake.Item("FUNC#fn-a", "BASELINE")
	if it == nil {
		t.Fatal("baseline not written")
	}
	if _, has := it["ttl"]; has {
		t.Error("baseline carries a ttl and would be deleted")
	}
}

// The baseline written for one record must be visible to the next record in the
// same batch. An eventually consistent read can return the previous version.
func TestBaselineReadIsConsistent(t *testing.T) {
	d, fake, _ := frozenDynamo(t)
	_, _ = d.LoadBaseline(context.Background(), "fn-a")

	if fake.LastGet == nil || fake.LastGet.ConsistentRead == nil || !*fake.LastGet.ConsistentRead {
		t.Error("baseline read is not strongly consistent")
	}
}

// Every connected browser must receive every frame, so the connection list has
// to page to the end rather than stop at the first page.
func TestListConnectionsPaginates(t *testing.T) {
	d, fake, _ := frozenDynamo(t)
	fake.PageSize = 2
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		_ = d.AddConnection(ctx, fmt.Sprintf("conn-%d", i))
	}
	got, err := d.ListConnections(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 5 {
		t.Errorf("got %d connections across pages, want 5: %v", len(got), got)
	}
}

// SetExplanation must not resurrect an anomaly that has already aged out.
func TestSetExplanationDoesNotCreateItems(t *testing.T) {
	d, fake, _ := frozenDynamo(t)
	text := "late explanation"
	if err := d.SetExplanation(context.Background(), "gone", &text, schema.ExplanationReady); err != nil {
		t.Fatal(err)
	}
	if fake.Len() != 0 {
		t.Errorf("update created %d item(s)", fake.Len())
	}
}
