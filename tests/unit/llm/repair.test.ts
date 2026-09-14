import { describe, expect, it } from 'vitest';
import { requestRepair } from '../../../src/llm/repair.js';
import { FakeLLMProvider, toolCallResponse } from '../../fakes/fakeLLMProvider.js';

describe('requestRepair', () => {
  it('returns the re-emitted tool call when the model corrects it', async () => {
    const provider = new FakeLLMProvider([
      toolCallResponse('goToPlayer', { playerName: 'Steve', maxDistance: 3 }),
    ]);

    const failedCall = { id: 'call_1', name: 'goToPlayer', argsRaw: '{"playerName": 123}' };
    const repaired = await requestRepair({
      provider,
      system: 'system prompt',
      tools: [],
      priorMessages: [{ role: 'user', text: 'go to Steve' }],
      failedCall,
      validationError: 'playerName must be a string',
    });

    expect(repaired?.name).toBe('goToPlayer');
    expect(JSON.parse(repaired?.argsRaw ?? '{}')).toEqual({ playerName: 'Steve', maxDistance: 3 });

    // The repair turn should include the prior conversation, the failed call, and the error.
    const call = provider.calls[0];
    expect(call.messages.at(0)?.text).toBe('go to Steve');
    expect(call.messages.at(-2)?.toolCalls?.[0]?.id).toBe('call_1');
    expect(call.messages.at(-1)?.toolResults?.[0]?.isError).toBe(true);
  });

  it('returns null when the model does not re-emit a call for the same skill', async () => {
    const provider = new FakeLLMProvider([
      { stopReason: 'end', toolCalls: [], text: 'never mind', raw: null },
    ]);

    const repaired = await requestRepair({
      provider,
      system: 'system prompt',
      tools: [],
      priorMessages: [],
      failedCall: { id: 'call_1', name: 'goToPlayer', argsRaw: '{}' },
      validationError: 'playerName is required',
    });

    expect(repaired).toBeNull();
  });
});
