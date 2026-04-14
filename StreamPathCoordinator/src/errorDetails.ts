type SerializableErrorDetails = {
  name?: string;
  message: string;
  type?: string;
  code?: string;
  statusCode?: number;
  requestId?: string;
  stack?: string;
  cause?: unknown;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getErrorDetails(error: unknown): SerializableErrorDetails {
  if (error instanceof Error) {
    const details: SerializableErrorDetails = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    const candidate = error as unknown as Record<string, unknown>;
    const knownKeys = ['type', 'code', 'statusCode', 'requestId'];

    for (const key of knownKeys) {
      const value = candidate[key];

      if (value !== undefined) {
        details[key] = value;
      }
    }

    if (candidate.cause !== undefined) {
      details.cause = candidate.cause;
    }

    return details;
  }

  if (typeof error === 'string') {
    return {
      message: error,
    };
  }

  if (isRecord(error)) {
    const message = typeof error.message === 'string' ? error.message : 'Unknown error';
    return {
      ...error,
      message,
    };
  }

  return {
    message: 'Unknown error',
    value: error,
  };
}
