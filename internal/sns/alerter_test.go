package sns

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/LambdaScope/Core/internal/schema"
	"github.com/aws/aws-sdk-go-v2/aws"
	awssns "github.com/aws/aws-sdk-go-v2/service/sns"
)

type fakePublisher struct {
	got *awssns.PublishInput
	err error
}

func (f *fakePublisher) Publish(_ context.Context, in *awssns.PublishInput, _ ...func(*awssns.Options)) (*awssns.PublishOutput, error) {
	f.got = in
	if f.err != nil {
		return nil, f.err
	}
	return &awssns.PublishOutput{MessageId: aws.String("m-1")}, nil
}

func critical() schema.Anomaly {
	text := "The function contacted an address outside AWS that it has never contacted before."
	return schema.Anomaly{
		AnomalyID:    "an-1",
		InvocationID: "inv-015",
		SandboxID:    "sbx-b2",
		FunctionARN:  "arn:aws:lambda:ap-south-1:123456789012:function:demo-checkout-api",
		FunctionName: "demo-checkout-api",
		Kind:         schema.KindUnknownEndpoint,
		Severity:     schema.SeverityCritical,
		Evidence:     map[string]any{"endpoint": "185.220.101.47:8443"},
		Explanation:  &text,
	}
}

func TestAlertPublishesToTopic(t *testing.T) {
	pub := &fakePublisher{}
	topic := "arn:aws:sns:ap-south-1:123456789012:lambdascope-alerts"

	if err := NewWithPublisher(pub, topic).Alert(context.Background(), critical()); err != nil {
		t.Fatal(err)
	}
	if aws.ToString(pub.got.TopicArn) != topic {
		t.Errorf("topic = %s", aws.ToString(pub.got.TopicArn))
	}
	if got := aws.ToString(pub.got.Subject); got != "[LambdaScope] CRITICAL unknown_endpoint in demo-checkout-api" {
		t.Errorf("subject = %q", got)
	}

	msg := aws.ToString(pub.got.Message)
	for _, want := range []string{"never contacted before", "185.220.101.47:8443", "inv-015", "sbx-b2"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message is missing %q:\n%s", want, msg)
		}
	}

	if v := pub.got.MessageAttributes["severity"].StringValue; aws.ToString(v) != "critical" {
		t.Errorf("severity attribute = %v", aws.ToString(v))
	}
}

// Without an explanation the email still says something useful.
func TestBodyFallsBackWithoutExplanation(t *testing.T) {
	a := critical()
	a.Explanation = nil
	if b := body(a); !strings.Contains(b, "185.220.101.47:8443") || strings.HasPrefix(b, "\n") {
		t.Errorf("fallback body is not useful:\n%s", b)
	}
}

// SNS rejects subjects that are long, multi-line or non-ASCII - and rejects
// the whole message with them.
func TestSubjectIsAlwaysAcceptable(t *testing.T) {
	a := critical()
	a.FunctionName = strings.Repeat("very-long-function-name-", 10) + "\nwith newline and emoji 🚨"

	s := subject(a)
	if len(s) > maxSubject {
		t.Errorf("subject is %d chars", len(s))
	}
	for _, r := range s {
		if r < 0x20 || r > 0x7e {
			t.Fatalf("subject contains %q", r)
		}
	}
}

func TestPublishErrorIsReturned(t *testing.T) {
	pub := &fakePublisher{err: errors.New("AuthorizationError")}
	if err := NewWithPublisher(pub, "arn").Alert(context.Background(), critical()); err == nil {
		t.Error("expected the publish error to surface")
	}
}
