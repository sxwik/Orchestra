const { Orchestra } = require("./dist");

async function main() {
  const ai = new Orchestra({
    strategy: "fallback",
    providers: [
      {
        name: "gemini",
        apiKey: process.env.GEMINI_API_KEY
      },
      {
        name: "openai",
        apiKey: process.env.OPENAI_API_KEY
      }
    ]
  });

  console.log("--- Testing standard chat() ---");
  try {
    const result = await ai.chat("Say hello in one word.");
    console.log("Response:", result);
  } catch (err) {
    console.error("Chat Error:", err);
  }

  console.log("\n--- Testing stream() ---");
  try {
    const stream = ai.stream("Write a short sentence about coding.");
    for await (const chunk of stream) {
      process.stdout.write(chunk);
    }
    console.log();
  } catch (err) {
    console.error("Stream Error:", err);
  }
}

main();
