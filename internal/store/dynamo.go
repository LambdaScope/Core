package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/schema"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Dynamo is the production Store.
//
// Single table, composite key, one global secondary index. Everything that is
// not learned state carries a TTL, so the table cleans itself up and cost does
// not creep between demos.
//
//	PK                    SK         GSI1PK   GSI1SK          ttl
//	--------------------------------------------------------------------
//	FUNC#<baselineKey>    BASELINE   -        -               none
//	SBX#<sandboxID>       STATE      -        -               6h
//	INV#<invocationID>    META       INV      start_ms        24h
//	ANOM#<anomalyID>      META       ANOM     detected_at_ms  7d
//	SIG#<signature>       EXPLAIN    -        -               1h
//	CONN#<connectionID>   META       CONN     connected_at    2h
//
// Domain objects are stored as a JSON string in `data` rather than as mapped
// attributes. Anomaly.Evidence is a map[string]any holding mixed types, and
// round-tripping that through attributevalue loses type fidelity in ways that
// only show up at render time. JSON round-trips exactly.
//
// The two fields that must be mutable after write - explanation and its status
// - are kept as top-level attributes so SetExplanation is a plain UpdateItem
// instead of a read-modify-write of the blob.
type Dynamo struct {
	db    DynamoAPI
	table string
	now   func() time.Time
}

var _ Store = (*Dynamo)(nil)

// DynamoAPI is the slice of the DynamoDB client this store actually calls.
// *dynamodb.Client satisfies it; tests substitute an in-memory table that
// enforces the same condition expressions, so the real store code is exercised
// without an AWS account.
type DynamoAPI interface {
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	DeleteItem(ctx context.Context, in *dynamodb.DeleteItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

var _ DynamoAPI = (*dynamodb.Client)(nil)

const (
	gsi1Name = "GSI1"

	ttlSandbox     = 6 * time.Hour
	ttlInvocation  = 24 * time.Hour
	ttlAnomaly     = 7 * 24 * time.Hour
	ttlExplanation = time.Hour
	ttlConnection  = 2 * time.Hour
)

// NewDynamo builds a client using the default AWS credential chain. Call it
// once at cold start and reuse it - constructing a client per invocation adds
// latency to every single request.
func NewDynamo(ctx context.Context, table string) (*Dynamo, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	return &Dynamo{
		db:    dynamodb.NewFromConfig(cfg),
		table: table,
		now:   time.Now,
	}, nil
}

// NewDynamoWithAPI wraps an existing client - a *dynamodb.Client in
// production, or the in-memory table from storetest in tests.
func NewDynamoWithAPI(db DynamoAPI, table string) *Dynamo {
	return &Dynamo{db: db, table: table, now: time.Now}
}

// --- key construction ------------------------------------------------------

func baselinePK(key string) string  { return "FUNC#" + key }
func sandboxPK(id string) string    { return "SBX#" + id }
func invocationPK(id string) string { return "INV#" + id }
func anomalyPK(id string) string    { return "ANOM#" + id }
func signaturePK(sig string) string { return "SIG#" + sig }
func connectionPK(id string) string { return "CONN#" + id }

func s(v string) ddbtypes.AttributeValue { return &ddbtypes.AttributeValueMemberS{Value: v} }
func n(v int64) ddbtypes.AttributeValue {
	return &ddbtypes.AttributeValueMemberN{Value: strconv.FormatInt(v, 10)}
}

func (d *Dynamo) key(pk, sk string) map[string]ddbtypes.AttributeValue {
	return map[string]ddbtypes.AttributeValue{"PK": s(pk), "SK": s(sk)}
}

func (d *Dynamo) expiresIn(after time.Duration) ddbtypes.AttributeValue {
	return n(d.now().Add(after).Unix()) // DynamoDB TTL is epoch SECONDS, not millis
}

// getJSON reads one item and decodes its `data` attribute into out.
// Returns false when the item does not exist, which is not an error.
func (d *Dynamo) getJSON(ctx context.Context, pk, sk string, out any) (bool, error) {
	res, err := d.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(d.table),
		Key:       d.key(pk, sk),
		// Consistent read: the baseline we just wrote for the previous record in
		// the same batch must be visible to this one. An eventually consistent
		// read can hand back a stale baseline and re-flag an endpoint we have
		// already learned.
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return false, err
	}
	if res.Item == nil {
		return false, nil
	}
	raw, ok := res.Item["data"].(*ddbtypes.AttributeValueMemberS)
	if !ok {
		return false, fmt.Errorf("item %s/%s has no data attribute", pk, sk)
	}
	if err := json.Unmarshal([]byte(raw.Value), out); err != nil {
		return false, fmt.Errorf("decode %s/%s: %w", pk, sk, err)
	}
	return true, nil
}

// --- learned state ---------------------------------------------------------

func (d *Dynamo) LoadBaseline(ctx context.Context, key string) (*anomaly.Baseline, error) {
	var b anomaly.Baseline
	found, err := d.getJSON(ctx, baselinePK(key), "BASELINE", &b)
	if err != nil {
		return nil, err
	}
	if !found {
		return anomaly.NewBaseline(key), nil
	}
	return &b, nil
}

func (d *Dynamo) SaveBaseline(ctx context.Context, b *anomaly.Baseline) error {
	blob, err := json.Marshal(b)
	if err != nil {
		return err
	}
	_, err = d.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.table),
		Item: map[string]ddbtypes.AttributeValue{
			"PK":   s(baselinePK(b.Key)),
			"SK":   s("BASELINE"),
			"data": s(string(blob)),
			// Learned behaviour is the one thing with no TTL. Losing it means
			// relearning from scratch and going quiet during the new window.
		},
	})
	return err
}

func (d *Dynamo) LoadSandbox(ctx context.Context, id string) (*anomaly.SandboxState, error) {
	var st anomaly.SandboxState
	found, err := d.getJSON(ctx, sandboxPK(id), "STATE", &st)
	if err != nil {
		return nil, err
	}
	if !found {
		return anomaly.NewSandboxState(id), nil
	}
	return &st, nil
}

func (d *Dynamo) SaveSandbox(ctx context.Context, st *anomaly.SandboxState) error {
	blob, err := json.Marshal(st)
	if err != nil {
		return err
	}
	_, err = d.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.table),
		Item: map[string]ddbtypes.AttributeValue{
			"PK":   s(sandboxPK(st.SandboxID)),
			"SK":   s("STATE"),
			"data": s(string(blob)),
			// A warm container is reclaimed within minutes to hours; keeping its
			// descriptor history longer than that serves no purpose.
			"ttl": d.expiresIn(ttlSandbox),
		},
	})
	return err
}

// --- records ---------------------------------------------------------------

// isConditionalCheckFailed reports whether the error is DynamoDB telling us the
// item already existed. That is the success path for an idempotent write, not a
// failure, so it must be distinguished from a real error.
func isConditionalCheckFailed(err error) bool {
	var cc *ddbtypes.ConditionalCheckFailedException
	return errors.As(err, &cc)
}

func (d *Dynamo) PutInvocation(ctx context.Context, ev *schema.InvocationEvent) (bool, error) {
	blob, err := json.Marshal(ev)
	if err != nil {
		return false, err
	}
	_, err = d.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.table),
		Item: map[string]ddbtypes.AttributeValue{
			"PK":     s(invocationPK(ev.InvocationID)),
			"SK":     s("META"),
			"GSI1PK": s("INV"),
			"GSI1SK": n(ev.StartMS),
			"data":   s(string(blob)),
			"ttl":    d.expiresIn(ttlInvocation),
		},
		// This is the idempotency gate. Kinesis delivers at least once; without
		// it a retried batch reprocesses everything and re-alerts.
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	if isConditionalCheckFailed(err) {
		return false, nil
	}
	return err == nil, err
}

func (d *Dynamo) PutAnomaly(ctx context.Context, a *schema.Anomaly) (bool, error) {
	blob, err := json.Marshal(a)
	if err != nil {
		return false, err
	}
	_, err = d.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.table),
		Item: map[string]ddbtypes.AttributeValue{
			"PK":     s(anomalyPK(a.AnomalyID)),
			"SK":     s("META"),
			"GSI1PK": s("ANOM"),
			"GSI1SK": n(a.DetectedAtMS),
			"data":   s(string(blob)),
			"ttl":    d.expiresIn(ttlAnomaly),
			// Kept outside the blob so they can be updated in place when the
			// explanation arrives.
			"explanation_status": s(string(a.ExplanationStatus)),
		},
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	if isConditionalCheckFailed(err) {
		return false, nil
	}
	return err == nil, err
}

func (d *Dynamo) SetExplanation(ctx context.Context, anomalyID string, explanation *string, status schema.ExplanationStatus) error {
	values := map[string]ddbtypes.AttributeValue{
		":st": s(string(status)),
	}
	expr := "SET explanation_status = :st"
	if explanation != nil {
		values[":ex"] = s(*explanation)
		expr += ", explanation = :ex"
	}

	_, err := d.db.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(d.table),
		Key:                       d.key(anomalyPK(anomalyID), "META"),
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeValues: values,
		// Do not resurrect an anomaly that has already aged out via TTL.
		ConditionExpression: aws.String("attribute_exists(PK)"),
	})
	if isConditionalCheckFailed(err) {
		return nil
	}
	return err
}

// --- explanation cache -----------------------------------------------------

func (d *Dynamo) GetExplanation(ctx context.Context, signature string) (string, bool, error) {
	res, err := d.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(d.table),
		Key:       d.key(signaturePK(signature), "EXPLAIN"),
	})
	if err != nil {
		return "", false, err
	}
	if res.Item == nil {
		return "", false, nil
	}
	v, ok := res.Item["text"].(*ddbtypes.AttributeValueMemberS)
	if !ok {
		return "", false, nil
	}
	return v.Value, true, nil
}

func (d *Dynamo) PutExplanation(ctx context.Context, signature, explanation string) error {
	_, err := d.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.table),
		Item: map[string]ddbtypes.AttributeValue{
			"PK":   s(signaturePK(signature)),
			"SK":   s("EXPLAIN"),
			"text": s(explanation),
			// An hour is long enough to absorb a burst of the same finding and
			// short enough that a genuinely changed situation gets re-described.
			"ttl": d.expiresIn(ttlExplanation),
		},
	})
	return err
}

// --- reads for the dashboard -----------------------------------------------

// queryRecent walks GSI1 newest-first for one partition.
func (d *Dynamo) queryRecent(ctx context.Context, gsiPK string, limit int) ([]map[string]ddbtypes.AttributeValue, error) {
	res, err := d.db.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(d.table),
		IndexName:              aws.String(gsi1Name),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": s(gsiPK),
		},
		ScanIndexForward: aws.Bool(false), // newest first
		Limit:            aws.Int32(int32(limit)),
	})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

// blobOf returns the JSON `data` attribute of an item.
func blobOf(item map[string]ddbtypes.AttributeValue) ([]byte, bool) {
	v, ok := item["data"].(*ddbtypes.AttributeValueMemberS)
	if !ok {
		return nil, false
	}
	return []byte(v.Value), true
}

func (d *Dynamo) RecentInvocations(ctx context.Context, limit int) ([]schema.InvocationEvent, error) {
	items, err := d.queryRecent(ctx, "INV", limit)
	if err != nil {
		return nil, err
	}
	out := make([]schema.InvocationEvent, 0, len(items))
	for _, item := range items {
		var ev schema.InvocationEvent
		if b, ok := blobOf(item); ok && json.Unmarshal(b, &ev) == nil {
			out = append(out, ev)
		}
	}
	return out, nil
}

func (d *Dynamo) RecentAnomalies(ctx context.Context, limit int) ([]schema.Anomaly, error) {
	items, err := d.queryRecent(ctx, "ANOM", limit)
	if err != nil {
		return nil, err
	}
	out := make([]schema.Anomaly, 0, len(items))
	for _, item := range items {
		var a schema.Anomaly
		b, ok := blobOf(item)
		if !ok || json.Unmarshal(b, &a) != nil {
			continue
		}
		// The blob is the anomaly as first written, still pending. The
		// explanation arrives later and is written to top-level attributes, so
		// it has to be laid back over the blob here - otherwise every alert in
		// the dashboard snapshot would show "pending" forever.
		if st, ok := item["explanation_status"].(*ddbtypes.AttributeValueMemberS); ok {
			a.ExplanationStatus = schema.ExplanationStatus(st.Value)
		}
		if ex, ok := item["explanation"].(*ddbtypes.AttributeValueMemberS); ok {
			text := ex.Value
			a.Explanation = &text
		}
		out = append(out, a)
	}
	return out, nil
}

// --- websocket connections -------------------------------------------------

func (d *Dynamo) AddConnection(ctx context.Context, connectionID string) error {
	_, err := d.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(d.table),
		Item: map[string]ddbtypes.AttributeValue{
			"PK":     s(connectionPK(connectionID)),
			"SK":     s("META"),
			"GSI1PK": s("CONN"),
			"GSI1SK": n(d.now().UnixMilli()),
			// API Gateway closes idle sockets well before this. The TTL is a
			// backstop against rows that never got a $disconnect.
			"ttl": d.expiresIn(ttlConnection),
		},
	})
	return err
}

func (d *Dynamo) RemoveConnection(ctx context.Context, connectionID string) error {
	_, err := d.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(d.table),
		Key:       d.key(connectionPK(connectionID), "META"),
	})
	return err
}

func (d *Dynamo) ListConnections(ctx context.Context) ([]string, error) {
	var out []string
	var startKey map[string]ddbtypes.AttributeValue

	for {
		res, err := d.db.Query(ctx, &dynamodb.QueryInput{
			TableName:              aws.String(d.table),
			IndexName:              aws.String(gsi1Name),
			KeyConditionExpression: aws.String("GSI1PK = :pk"),
			ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
				":pk": s("CONN"),
			},
			ExclusiveStartKey: startKey,
		})
		if err != nil {
			return nil, err
		}
		for _, item := range res.Items {
			pk, ok := item["PK"].(*ddbtypes.AttributeValueMemberS)
			if !ok {
				continue
			}
			out = append(out, pk.Value[len("CONN#"):])
		}
		// Every connected browser must receive every frame, so unlike the
		// dashboard queries this one has to page to the end.
		if len(res.LastEvaluatedKey) == 0 {
			return out, nil
		}
		startKey = res.LastEvaluatedKey
	}
}
