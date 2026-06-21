import { env } from './env';
import pino, { type Logger } from 'pino';

// D15: unset NODE_ENV is treated as production (stricter). Fails safe.
const isProd = env.nodeEnv !== 'development';

// Redact secrets from logs (D9 defense in depth). `*.password` catches nested.
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  '*.password',
  'req.body.token',
  '*.token',
];

export const logger: Logger = pino({
  level: isProd ? 'info' : 'debug',
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'ISO' },
      },
});

export { isProd };
