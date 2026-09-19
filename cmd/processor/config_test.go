package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestConfigRequiresTable(t *testing.T) {
	if _, err := loadConfig(env(nil)); err == nil {
		t.Error("missing TABLE_NAME must be an error")
	}
}

func TestConfigDefaults(t *testing.T) {
	c, err := loadConfig(env(map[string]string{
		"TABLE_NAME": "lambdascope",
		"AWS_REGION": "ap-south-1",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.BedrockRegion != "ap-south-1" {
		t.Errorf("bedrock region = %q, want the Lambda's own region", c.BedrockRegion)
	}
	if c.IPRangesURL != defaultIPRangesURL {
		t.Errorf("ip ranges url = %q", c.IPRangesURL)
	}
	if c.ExplainOff {
		t.Error("explainer should be on by default")
	}
}

func TestConfigOverrides(t *testing.T) {
	c, _ := loadConfig(env(map[string]string{
		"TABLE_NAME":         "t",
		"AWS_REGION":         "ap-south-1",
		"BEDROCK_REGION":     "us-east-1",
		"EXPLAIN":            "off",
		"WEBSOCKET_ENDPOINT": "https://x.execute-api.ap-south-1.amazonaws.com/prod",
	}))
	if c.BedrockRegion != "us-east-1" || !c.ExplainOff || c.WebSocketEndpoint == "" {
		t.Errorf("overrides not applied: %+v", c)
	}
}

func TestLoadAWSRanges(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"prefixes":[{"ip_prefix":"52.94.0.0/16"}],"ipv6_prefixes":[]}`))
	}))
	defer srv.Close()

	r, err := loadAWSRanges(context.Background(), srv.Client(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Contains("52.94.236.248") || r.Contains("185.220.101.47") {
		t.Error("ranges not applied")
	}
}

// A failed fetch must yield ranges that admit they are not loaded, so the
// detector does not claim addresses are external on no evidence.
func TestLoadAWSRangesFailureIsHonest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	r, err := loadAWSRanges(context.Background(), srv.Client(), srv.URL)
	if err == nil {
		t.Error("expected an error")
	}
	if r == nil || r.Loaded() {
		t.Error("a failed fetch must return unloaded ranges, not nil and not a guess")
	}
}
