import { parseConfig } from '../src/config/env.js';

try {
  const config = parseConfig();
  console.log('Config OK:');
  console.log(
    JSON.stringify(
      {
        ...config,
        anthropicApiKey: config.anthropicApiKey && '(set)',
        openaiApiKey: config.openaiApiKey && '(set)',
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
