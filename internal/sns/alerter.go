// Package sns publishes severe anomalies out of band, so someone finds out
// without having the dashboard open. The processor decides which severities
// qualify; this package only delivers.
package sns

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/LambdaScope/Core/internal/anomaly"
	"github.com/LambdaScope/Core/internal/schema"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	awssns "github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/service/sns/types"
)

// Publisher is the one SNS call we make. The SDK client satisfies it.
type Publisher interface {
	Publish(ctx context.Context, in *awssns.PublishInput, opts ...func(*awssns.Options)) (*awssns.PublishOutput, error)
}

var _ Publisher = (*awssns.Client)(nil)

// maxSubject is SNS's limit for email subjects. Longer subjects are rejected.
const maxSubject = 100

type Alerter struct {
	pub   Publisher
	topic string
}

// New builds an alerter using the default AWS credential chain.
func New(ctx context.Context, topicARN string) (*Alerter, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	return &Alerter{pub: awssns.NewFromConfig(cfg), topic: topicARN}, nil
}

func NewWithPublisher(pub Publisher, topicARN string) *Alerter {
	return &Alerter{pub: pub, topic: topicARN}
}

// Alert implements processor.Alerter.
func (a *Alerter) Alert(ctx context.Context, an schema.Anomaly) error {
	_, err := a.pub.Publish(ctx, &awssns.PublishInput{
		TopicArn: aws.String(a.topic),
		Subject:  aws.String(subject(an)),
		Message:  aws.String(body(an)),
		// Attributes let subscribers filter - e.g. an SMS subscription that
		// only wants critical - without a second topic.
		MessageAttributes: map[string]types.MessageAttributeValue{
			"severity": {DataType: aws.String("String"), StringValue: aws.String(string(an.Severity))},
			"kind":     {DataType: aws.String("String"), StringValue: aws.String(string(an.Kind))},
			"function": {DataType: aws.String("String"), StringValue: aws.String(nonEmpty(an.FunctionName))},
		},
	})
	if err != nil {
		return fmt.Errorf("sns publish: %w", err)
	}
	return nil
}

// subject must be ASCII, single-line and at most 100 characters, or SNS
// rejects the whole message.
func subject(an schema.Anomaly) string {
	s := fmt.Sprintf("[LambdaScope] %s %s in %s",
		strings.ToUpper(string(an.Severity)), an.Kind, nonEmpty(an.FunctionName))

	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			b.WriteByte(' ')
		case r < 0x20 || r > 0x7e:
			b.WriteByte('?')
		default:
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len(out) > maxSubject {
		out = out[:maxSubject-3] + "..."
	}
	return out
}

// body is plain text for humans reading an email, followed by the raw evidence
// for anyone who needs the detail.
func body(an schema.Anomaly) string {
	explanation := anomaly.Describe(an)
	if an.Explanation != nil && *an.Explanation != "" {
		explanation = *an.Explanation
	}

	evidence, _ := json.MarshalIndent(an.Evidence, "", "  ")

	var b strings.Builder
	fmt.Fprintf(&b, "%s\n\n", explanation)
	fmt.Fprintf(&b, "Severity:   %s\n", an.Severity)
	fmt.Fprintf(&b, "Kind:       %s\n", an.Kind)
	fmt.Fprintf(&b, "Function:   %s\n", an.FunctionARN)
	fmt.Fprintf(&b, "Invocation: %s\n", an.InvocationID)
	if an.SandboxID != "" {
		fmt.Fprintf(&b, "Sandbox:    %s\n", an.SandboxID)
	}
	fmt.Fprintf(&b, "Anomaly ID: %s\n\nEvidence:\n%s\n", an.AnomalyID, evidence)
	return b.String()
}

func nonEmpty(s string) string {
	if s == "" {
		return "unknown-function"
	}
	return s
}
