type Args = {
  coordinatorUrl: string;
  loanRecordId: string;
  method: 'GET' | 'POST';
};

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let coordinatorUrl = process.env.COORDINATOR_HTTP_URL ?? 'http://localhost:8080';
  let loanRecordId = '';
  let method: 'GET' | 'POST' = 'POST';

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const next = args[index + 1];

    if (token === '--coordinator-url' && next) {
      coordinatorUrl = next;
      index += 1;
      continue;
    }

    if (token === '--loan-record-id' && next) {
      loanRecordId = next;
      index += 1;
      continue;
    }

    if (token === '--method' && next) {
      const normalized = next.toUpperCase();
      if (normalized === 'GET' || normalized === 'POST') {
        method = normalized;
      }
      index += 1;
      continue;
    }
  }

  if (!loanRecordId) {
    throw new Error('--loan-record-id is required');
  }

  return {
    coordinatorUrl: coordinatorUrl.replace(/\/+$/, ''),
    loanRecordId,
    method,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const url = `${args.coordinatorUrl}/simulate/loan/${encodeURIComponent(
    args.loanRecordId,
  )}/review-ready`;

  const response = await fetch(url, {
    method: args.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  const text = await response.text();
  let parsed: unknown = text;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Simulation request failed (${response.status}): ${
        typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
      }`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        method: args.method,
        coordinatorUrl: args.coordinatorUrl,
        loanRecordId: args.loanRecordId,
        response: parsed,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[workflow-sim] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
