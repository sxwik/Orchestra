const { Orchestra } = require("./dist");
require("dotenv").config(); // load environment variables if dotenv is present

async function main() {
  // Ensure you have GEMINI_API_KEY and OPENAI_API_KEY set in your environment
  const ai = new Orchestra({
    providers: [
      {
        name: "gemini",
        apiKey: process.env.GEMINI_API_KEY,
        model: "gemini-2.5-flash"
      },
      {
        name: "openai",
        apiKey: process.env.OPENAI_API_KEY,
        model: "gpt-4o-mini"
      }
    ]
  });

  console.log("=== Orchestra Advanced Capabilities Demo ===\n");

  console.log("1. --- Testing Intelligent Prompt Routing ---");
  try {
    console.log("Querying coding prompt (prefers OpenAI/Claude)...");
    const codingResult = await ai.chat(
      "Write a typescript function to binary search an array.",
      { provider: "auto" }
    );
    console.log(`Routed to: ${codingResult.provider} (${codingResult.model})`);
    console.log("Response snippet:", codingResult.text.split("\n").slice(0, 3).join("\n"), "...\n");

    console.log("Querying simple chat prompt (prefers Gemini Flash)...");
    const simpleResult = await ai.chat(
      "Hi there! Tell me one cool space fact in one short sentence.",
      { provider: "auto" }
    );
    console.log(`Routed to: ${simpleResult.provider} (${simpleResult.model})`);
    console.log("Response:", simpleResult.text, "\n");
  } catch (err) {
    console.error("Routing Error:", err);
  }

  console.log("2. --- Testing Provider Racing ---");
  try {
    console.log("Racing Gemini vs OpenAI on a prompt...");
    const raceResult = await ai.race("Explain quantum physics in a single sentence.");
    console.log(`Winner: ${raceResult.winner}`);
    console.log(`Latency: ${raceResult.latency}ms`);
    console.log(`Response: ${raceResult.response.text}\n`);
  } catch (err) {
    console.error("Racing Error:", err);
  }

  console.log("3. --- Testing Provider Consensus ---");
  try {
    console.log("Gathering consensus between Gemini and OpenAI...");
    const consensusResult = await ai.consensus("What is the primary language spoken in Brazil?");
    console.log(`Consensus Synthesized by Judge: ${consensusResult.judge}`);
    console.log("Final Consensus Output:", consensusResult.text);
    console.log("Individual Answers gathered:");
    consensusResult.responses.forEach(r => {
      console.log(` - [${r.provider}]: ${r.text.trim()}`);
    });
    console.log();
  } catch (err) {
    console.error("Consensus Error:", err);
  }

  console.log("4. --- Testing standard stream() fallback ---");
  try {
    const stream = ai.stream("Count from 1 to 3.");
    process.stdout.write("Stream: ");
    for await (const chunk of stream) {
      process.stdout.write(chunk);
    }
    console.log("\n");
  } catch (err) {
    console.error("Stream Error:", err);
  }
}

main().catch(console.error);
