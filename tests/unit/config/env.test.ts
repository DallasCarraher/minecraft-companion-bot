import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../../src/config/env.js';

const baseEnv = {
  botUsername: 'bot@example.com',
  minecraftVersion: '1.21.4',
  connectionMode: 'direct',
  serverHost: 'localhost',
  msAuthProfilesFolder: './.minecraft-auth',
  llmProvider: 'anthropic',
  anthropicApiKey: 'sk-test',
};

describe('parseConfig', () => {
  it('accepts a minimal valid direct-mode config', () => {
    const config = parseConfig(baseEnv);
    expect(config.botUsername).toBe('bot@example.com');
    expect(config.serverPort).toBe(25565); // default applied
    expect(config.chatTriggerMode).toBe('mention'); // default applied
  });

  it('reports every missing required field at once, not just the first', () => {
    expect(() => parseConfig({})).toThrowError(
      /botUsername.*minecraftVersion.*connectionMode.*msAuthProfilesFolder.*llmProvider/s,
    );
  });

  it('requires serverHost when connectionMode is direct', () => {
    const { serverHost: _serverHost, ...withoutHost } = baseEnv;
    expect(() => parseConfig(withoutHost)).toThrowError(/serverHost/);
  });

  it('requires realmName when connectionMode is realm', () => {
    expect(() =>
      parseConfig({ ...baseEnv, connectionMode: 'realm', serverHost: undefined }),
    ).toThrowError(/realmName/);
  });

  it('requires anthropicApiKey when llmProvider is anthropic', () => {
    const { anthropicApiKey: _key, ...withoutKey } = baseEnv;
    expect(() => parseConfig(withoutKey)).toThrowError(/anthropicApiKey/);
  });

  it('requires openaiApiKey when llmProvider is openai', () => {
    expect(() => parseConfig({ ...baseEnv, llmProvider: 'openai' })).toThrowError(/openaiApiKey/);
  });

  it('parses a comma-separated chatAllowlist into a trimmed array', () => {
    const config = parseConfig({ ...baseEnv, chatAllowlist: ' alice ,bob ,,carol' });
    expect(config.chatAllowlist).toEqual(['alice', 'bob', 'carol']);
  });
});
