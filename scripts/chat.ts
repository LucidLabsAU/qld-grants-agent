/**
 * Chats with the grants agent from the terminal.
 *
 *   npm run chat                                          # interactive (type 'exit' to quit)
 *   npm run chat -- "I run a small cafe, what grants can I get?"   # single question
 *   npm run chat -- --agent <name> --debug "..."          # other agent / show tool calls
 */
import { DefaultAzureCredential } from '@azure/identity';
import { createInterface } from 'node:readline';
import { argValue, loadScriptEnv, positionalArgs, requireEnv } from './env.js';
import { FoundryProjectClient, outputText } from './foundry.js';

const env = loadScriptEnv();
const client = new FoundryProjectClient(requireEnv(env, 'FOUNDRY_PROJECT_ENDPOINT'), new DefaultAzureCredential());
const agentName = argValue('--agent') ?? env.AGENT_NAME ?? 'qld-grants-agent';
const debug = process.argv.includes('--debug');

const question = positionalArgs(['--agent']).join(' ');

const conversation = await client.createConversation();

async function ask(input: string): Promise<void> {
  const started = Date.now();
  const response = await client.respond(agentName, conversation.id, input);
  const calls = response.output.filter((o) => o.type === 'mcp_call');
  for (const call of calls) {
    const args = debug ? ` ${call.arguments}` : '';
    console.log(`  🔎 ${call.name}${args}${call.error ? ` ❌ ${JSON.stringify(call.error)}` : ''}`);
  }
  console.log(`\n${outputText(response) || '(no text output)'}\n`);
  const usage = response.usage ? `, ${response.usage.input_tokens}→${response.usage.output_tokens} tokens` : '';
  console.log(`  (${response.status}, ${((Date.now() - started) / 1000).toFixed(1)}s${usage})\n`);
  if (debug) console.log(JSON.stringify(response.output, null, 2));
}

if (question) {
  await ask(question);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  console.log(`Chatting with ${agentName}. Type 'exit' to quit.\n`);
  rl.prompt();
  // Async iteration (not rl.question) so piped input works as well as an interactive terminal.
  for await (const raw of rl) {
    const line = raw.trim();
    if (/^(exit|quit)$/i.test(line)) break;
    if (line) await ask(line);
    rl.prompt();
  }
  rl.close();
}
