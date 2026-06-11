# Orchestra 

Orchestra is a high-performance, plugin-first TypeScript framework for **Unified AI Orchestration**. 

Instead of dealing with fragmented APIs, Orchestra gives you a single developer-friendly interface to route prompts, manage provider failovers, race models for speed, and run consensus evaluations.

---

##  Core Capabilities

- **Universal Provider Interface**: Talk to any model using the same interface (`app.chat(...)` and `app.stream(...)`).
- **Intelligent Prompt Router**: Automatically routes simple prompts to Gemini Flash, coding queries to Claude/GPT, and complex reasoning to larger models based on content heuristics.
- **Failover & Cooldowns**: Tracks provider health. If a provider fails (e.g. rate-limited), it is put on cooldown and subsequent queries bypass it automatically.
- **Provider Racing**: Invokes multiple models concurrently and returns the fastest successful response.
- **Provider Consensus**: Queries multiple models in parallel and feeds their outputs to a "Judge" model to synthesize a unified response.
- **Plugin Platform**: Register custom models, auth providers, or deployment scripts.

---

##  Installation

```bash
npm install @sxwik/orchestra
```

---

##  5-Minute Quick Start

Initialize Orchestra with your preferred providers. API keys can be specified inline or loaded via environment variables (`GEMINI_API_KEY`, `OPENAI_API_KEY`).

```typescript
import { Orchestra } from "@sxwik/orchestra";

const app = new Orchestra({
  providers: [
    { name: "gemini", apiKey: process.env.GEMINI_API_KEY },
    { name: "openai", apiKey: process.env.OPENAI_API_KEY }
  ]
});
```

### 1. Simple Chat & Streaming
```typescript
// Chat
const response = await app.chat("Tell me a space fact.");
console.log(response.text);

// Stream
const stream = app.stream("Write a short story about coding.");
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

### 2. Intelligent Provider Routing
Let Orchestra inspect your prompt properties (length, keywords, code blocks) and choose the best provider automatically.
```typescript
// Routes to OpenAI (since Claude isn't loaded, GPT is preferred for code)
const codeRes = await app.chat("Write a typescript sort function.", { provider: "auto" });

// Routes to Gemini Flash (simple chat)
const chatRes = await app.chat("Hi!", { provider: "auto" });
```

### 3. Provider Racing
Run prompts against multiple providers concurrently. Get the fastest response and track exactly who won and the latency in milliseconds.
```typescript
const result = await app.race(
  ["gemini", "openai"],
  "Explain quantum physics in one sentence."
);

console.log(`Winner: ${result.winner} (${result.latency}ms)`);
console.log(`Response: ${result.response.text}`);
```

### 4. Provider Consensus
Query multiple models concurrently and use a designated model as a "Judge" to synthesize a final, unified response.
```typescript
const consensus = await app.consensus(
  ["gemini", "openai"],
  "What is the capital of Brazil?"
);

console.log(`Judge: ${consensus.judge}`);
console.log(`Synthesized Consensus: ${consensus.text}`);
```

---

##  Testing & Provider Compliance Suite

You don't need real API keys to test Orchestra. We provide a helper to validate that any custom provider you write complies with the Orchestra spec.

```typescript
import { validateProvider } from "@sxwik/orchestra";

const myProvider = {
  name: "my-custom-model",
  async chat(prompt: string) {
    return {
      text: `Custom: ${prompt}`,
      model: "custom-v1",
      provider: "my-custom-model"
    };
  }
};

const result = await validateProvider(myProvider);
if (result.passed) {
  console.log("Your custom provider is fully Orchestra-compliant!");
} else {
  console.error("Compliance failures:", result.errors);
}
```
