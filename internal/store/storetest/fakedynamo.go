// Package storetest provides an in-memory stand-in for the DynamoDB API.
//
// It is not a general DynamoDB emulator. It models exactly the expressions the
// store issues - attribute_not_exists / attribute_exists conditions, SET update
// expressions, and newest-first queries on GSI1 - and it returns an error for
// anything else. That way, if the store starts using an expression this fake
// does not understand, the tests fail loudly instead of passing on behaviour
// that production would not reproduce.
package storetest

import (
	"context"
	"fmt"
	"maps"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type item = map[string]types.AttributeValue

type FakeDynamo struct {
	mu    sync.Mutex
	items map[string]item

	// PageSize, when positive, caps every Query page so callers that must
	// paginate can be tested. Zero means unlimited.
	PageSize int

	// LastGet records the most recent GetItem input, so tests can assert on
	// read options such as ConsistentRead.
	LastGet *dynamodb.GetItemInput
}

func NewFakeDynamo() *FakeDynamo {
	return &FakeDynamo{items: make(map[string]item)}
}

// Item returns a copy of one stored item, or nil. For assertions only.
func (f *FakeDynamo) Item(pk, sk string) map[string]types.AttributeValue {
	f.mu.Lock()
	defer f.mu.Unlock()
	it, ok := f.items[pk+"\x00"+sk]
	if !ok {
		return nil
	}
	return maps.Clone(it)
}

// Len returns how many items are stored.
func (f *FakeDynamo) Len() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.items)
}

func str(av types.AttributeValue) string {
	if v, ok := av.(*types.AttributeValueMemberS); ok {
		return v.Value
	}
	return ""
}

func num(av types.AttributeValue) int64 {
	if v, ok := av.(*types.AttributeValueMemberN); ok {
		i, _ := strconv.ParseInt(v.Value, 10, 64)
		return i
	}
	return 0
}

func keyOf(m item) (string, error) {
	pk, sk := str(m["PK"]), str(m["SK"])
	if pk == "" || sk == "" {
		return "", fmt.Errorf("item is missing PK or SK")
	}
	return pk + "\x00" + sk, nil
}

func conditionFailed() error {
	return &types.ConditionalCheckFailedException{Message: aws.String("The conditional request failed")}
}

// checkCondition evaluates the only two conditions the store uses.
func checkCondition(expr *string, exists bool) error {
	if expr == nil {
		return nil
	}
	switch *expr {
	case "attribute_not_exists(PK)":
		if exists {
			return conditionFailed()
		}
	case "attribute_exists(PK)":
		if !exists {
			return conditionFailed()
		}
	default:
		return fmt.Errorf("storetest: unsupported condition expression %q", *expr)
	}
	return nil
}

func (f *FakeDynamo) GetItem(_ context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.LastGet = in

	k, err := keyOf(in.Key)
	if err != nil {
		return nil, err
	}
	it, ok := f.items[k]
	if !ok {
		return &dynamodb.GetItemOutput{}, nil
	}
	return &dynamodb.GetItemOutput{Item: maps.Clone(it)}, nil
}

func (f *FakeDynamo) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	k, err := keyOf(in.Item)
	if err != nil {
		return nil, err
	}
	_, exists := f.items[k]
	if err := checkCondition(in.ConditionExpression, exists); err != nil {
		return nil, err
	}
	f.items[k] = maps.Clone(in.Item)
	return &dynamodb.PutItemOutput{}, nil
}

func (f *FakeDynamo) UpdateItem(_ context.Context, in *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	k, err := keyOf(in.Key)
	if err != nil {
		return nil, err
	}
	existing, exists := f.items[k]
	if err := checkCondition(in.ConditionExpression, exists); err != nil {
		return nil, err
	}

	expr := aws.ToString(in.UpdateExpression)
	if !strings.HasPrefix(expr, "SET ") {
		return nil, fmt.Errorf("storetest: unsupported update expression %q", expr)
	}

	updated := maps.Clone(existing)
	if updated == nil {
		updated = maps.Clone(in.Key)
	}
	for _, clause := range strings.Split(strings.TrimPrefix(expr, "SET "), ",") {
		parts := strings.SplitN(clause, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("storetest: cannot parse SET clause %q", clause)
		}
		name, placeholder := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		val, ok := in.ExpressionAttributeValues[placeholder]
		if !ok {
			return nil, fmt.Errorf("storetest: missing value for %s", placeholder)
		}
		updated[name] = val
	}
	f.items[k] = updated
	return &dynamodb.UpdateItemOutput{}, nil
}

func (f *FakeDynamo) DeleteItem(_ context.Context, in *dynamodb.DeleteItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	k, err := keyOf(in.Key)
	if err != nil {
		return nil, err
	}
	delete(f.items, k)
	return &dynamodb.DeleteItemOutput{}, nil
}

func (f *FakeDynamo) Query(_ context.Context, in *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if aws.ToString(in.IndexName) != "GSI1" || aws.ToString(in.KeyConditionExpression) != "GSI1PK = :pk" {
		return nil, fmt.Errorf("storetest: unsupported query index=%q condition=%q",
			aws.ToString(in.IndexName), aws.ToString(in.KeyConditionExpression))
	}
	want := str(in.ExpressionAttributeValues[":pk"])

	var matches []item
	for _, it := range f.items {
		if str(it["GSI1PK"]) == want {
			matches = append(matches, it)
		}
	}

	ascending := in.ScanIndexForward == nil || *in.ScanIndexForward
	sort.Slice(matches, func(i, j int) bool {
		a, b := num(matches[i]["GSI1SK"]), num(matches[j]["GSI1SK"])
		if a == b {
			// Stable tie-break so pagination is deterministic.
			if ascending {
				return str(matches[i]["PK"]) < str(matches[j]["PK"])
			}
			return str(matches[i]["PK"]) > str(matches[j]["PK"])
		}
		if ascending {
			return a < b
		}
		return a > b
	})

	// Resume after the ExclusiveStartKey, as DynamoDB does.
	if len(in.ExclusiveStartKey) > 0 {
		startPK := str(in.ExclusiveStartKey["PK"])
		for i, it := range matches {
			if str(it["PK"]) == startPK {
				matches = matches[i+1:]
				break
			}
		}
	}

	pageCap := len(matches)
	if in.Limit != nil && int(*in.Limit) < pageCap {
		pageCap = int(*in.Limit)
	}
	if f.PageSize > 0 && f.PageSize < pageCap {
		pageCap = f.PageSize
	}

	out := &dynamodb.QueryOutput{}
	for _, it := range matches[:pageCap] {
		out.Items = append(out.Items, maps.Clone(it))
	}
	if pageCap < len(matches) && pageCap > 0 {
		last := matches[pageCap-1]
		out.LastEvaluatedKey = item{
			"PK": last["PK"], "SK": last["SK"],
			"GSI1PK": last["GSI1PK"], "GSI1SK": last["GSI1SK"],
		}
	}
	return out, nil
}
