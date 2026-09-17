package protocolcodec

// Probe: does vLLM Semantic Router's default (strict) protocol policy accept
// real OpenCode request bodies and MTPLX-shaped SSE streams?
//
// Copy into src/semantic-router/pkg/protocolcodec/ of a vllm-project/semantic-router
// checkout and run:
//   PROBE_BODIES=<dir with captured req*.json> go test -run TestProbe -v .
//
// Each stream case differs from the control by ONE feature, so a rejection
// names the feature responsible. MTPLX chunk shapes are transcribed from
// mtplx 2.11.1 mtplx/server/openai.py (see the research doc for line refs).

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/vllm-project/semantic-router/src/semantic-router/pkg/llmprotocol"
)

func TestProbeOpenCodeRequests(t *testing.T) {
	dir := os.Getenv("PROBE_BODIES")
	if dir == "" {
		t.Skip("PROBE_BODIES not set")
	}
	files, _ := filepath.Glob(filepath.Join(dir, "req*.json"))
	policy := llmprotocol.DefaultPolicy()
	for _, f := range files {
		body, _ := os.ReadFile(f)
		_, _, _, err := OpenAIChatCodec{}.DecodeRequest(body, policy)
		t.Logf("REQUEST %-12s accepted=%v err=%v", filepath.Base(f), err == nil, err)
	}
	// Control: prove the probe can observe a rejection.
	_, _, _, err := OpenAIChatCodec{}.DecodeRequest([]byte(`{"model":"m","messages":[{"role":"user","content":"hi"}],"x_unknown":1}`), policy)
	t.Logf("REQUEST %-12s accepted=%v err=%v", "unknown-fld", err == nil, err)
}

const (
	chunkPrefix     = `data: {"id":"r","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,`
	sseRole         = chunkPrefix + `"delta":{"role":"assistant"},"finish_reason":null}]}` + "\n\n"
	sseContent      = chunkPrefix + `"delta":{"content":"ok"},"finish_reason":null}]}` + "\n\n"
	sseReasoning    = chunkPrefix + `"delta":{"reasoning_content":"thinking"},"finish_reason":null}]}` + "\n\n"
	sseKeepalive    = ": keepalive\n\n"
	sseProgress     = chunkPrefix + `"delta":{},"finish_reason":null}],"mtplx_progress":{"completion_tokens":3}}` + "\n\n"
	sseFinal        = chunkPrefix + `"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}` + "\n\n"
	sseFinalDetails = chunkPrefix + `"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7,"prompt_tokens_details":{"cached_tokens":4},"completion_tokens_details":{"reasoning_tokens":1}}}` + "\n\n"
	sseFinalMTPLX   = chunkPrefix + `"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7},"mtplx_stats":{"accept_rate":0.6},"timings":{"prompt_n":5,"predicted_n":2}}` + "\n\n"
	sseDone         = "data: [DONE]\n\n"
)

func TestProbeMTPLXStreams(t *testing.T) {
	cases := []struct{ name, stream string }{
		{"control(standard)", sseRole + sseContent + sseFinal + sseDone},
		{"+reasoning_content", sseRole + sseReasoning + sseContent + sseFinal + sseDone},
		{"+sse_comment", sseRole + sseKeepalive + sseContent + sseFinal + sseDone},
		{"+usage_details", sseRole + sseContent + sseFinalDetails + sseDone},
		{"+mtplx_progress", sseRole + sseProgress + sseContent + sseFinal + sseDone},
		{"+mtplx_stats+timings", sseRole + sseContent + sseFinalMTPLX + sseDone},
	}
	engine := NewBuiltinEngine()
	for _, c := range cases {
		stream, err := engine.NewStream(llmprotocol.OpenAIChatV1, llmprotocol.OpenAIChatV1,
			llmprotocol.StreamContext{Context: context.Background(), PublicModel: "vllm-sr/auto", ProviderModel: "m"})
		if err != nil {
			t.Fatal(err)
		}
		_, _, _, err = stream.Push([]byte(c.stream))
		t.Logf("STREAM  %-22s accepted=%v err=%v", c.name, err == nil, err)
	}
}

// TestProbeCapturedResponses replays response bytes captured from a real
// backend (e.g. llama-server): *.sse files as streams, *.json as non-stream
// bodies. Pair each capture with a ".stripped" copy that removes one field, so
// a rejection can be attributed to that field.
//   PROBE_RESPONSES=<dir> go test -run TestProbeCapturedResponses -v .
func TestProbeCapturedResponses(t *testing.T) {
	dir := os.Getenv("PROBE_RESPONSES")
	if dir == "" {
		t.Skip("PROBE_RESPONSES not set")
	}
	engine := NewBuiltinEngine()
	streams, _ := filepath.Glob(filepath.Join(dir, "*.sse"))
	for _, f := range streams {
		body, _ := os.ReadFile(f)
		stream, err := engine.NewStream(llmprotocol.OpenAIChatV1, llmprotocol.OpenAIChatV1,
			llmprotocol.StreamContext{Context: context.Background(), PublicModel: "vllm-sr/auto", ProviderModel: "m"})
		if err != nil {
			t.Fatal(err)
		}
		_, _, _, err = stream.Push(body)
		if err == nil {
			_, _, _, err = stream.Finalize(nil)
		}
		t.Logf("CAPTURED-STREAM  %-32s accepted=%v err=%v", filepath.Base(f), err == nil, err)
	}
	bodies, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	for _, f := range bodies {
		body, _ := os.ReadFile(f)
		_, err := engine.TranslateResponse(llmprotocol.OpenAIChatV1, llmprotocol.OpenAIChatV1, body, nil)
		t.Logf("CAPTURED-BODY    %-32s accepted=%v err=%v", filepath.Base(f), err == nil, err)
	}
}

// TestProbeAnthropicRequests decodes captured Anthropic Messages request bodies.
//   PROBE_ANTHROPIC_BODIES=<dir with req*.json> go test -run TestProbeAnthropicRequests -v .
func TestProbeAnthropicRequests(t *testing.T) {
	dir := os.Getenv("PROBE_ANTHROPIC_BODIES")
	if dir == "" {
		t.Skip("PROBE_ANTHROPIC_BODIES not set")
	}
	files, _ := filepath.Glob(filepath.Join(dir, "req*.json"))
	policy := llmprotocol.DefaultPolicy()
	for _, f := range files {
		body, _ := os.ReadFile(f)
		_, _, _, err := AnthropicMessagesCodec{}.DecodeRequest(body, policy)
		t.Logf("ANTHROPIC-REQUEST %-28s accepted=%v err=%v", filepath.Base(f), err == nil, err)
	}
}
