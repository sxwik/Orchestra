# Orchestra

Orchestra is a plugin-first TypeScript framework for unified API integration.

## Installation

```bash
npm install orchestra
```

## Usage

```ts
import { Orchestra } from "orchestra";

const app = new Orchestra({
  providers: [
    {
      name: "gemini",
      apiKey: process.env.GEMINI_API_KEY
    }
  ]
});

const response = await app.ai.chat("Hello world");
console.log(response.text);
```
