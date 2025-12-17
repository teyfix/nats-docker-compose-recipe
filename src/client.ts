import { encodeUser } from "@nats-io/jwt";
import { config } from "dotenv";
import { createUser, fromSeed } from "nkeys.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

type NativeClient = typeof import("nats");
type WebSocketClient = typeof import("nats.ws");

type NATSClient = NativeClient | WebSocketClient;

const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);
const decodeText = (text: Uint8Array): string => new TextDecoder().decode(text);

const WORKDIR = process.cwd();

const ENV_FILE = resolve(WORKDIR, ".env");
const ACCOUNT_ENV_FILE = resolve(
  WORKDIR,
  "fs/nats-export/secrets/.env.account"
);

const relativePath = (path: string): string => path.replace(WORKDIR, ".");

/**
 * Import which NATS client to use
 * based on the `USE_WEBSOCKET` environment variable.
 *
 * We prefer to use `nats.ws` if `USE_WEBSOCKET` is not set.
 *
 * @returns {Promise<NATSClient>}
 */
const importNATS = async (): Promise<NATSClient> => {
  const useWebSocket = process.env.USE_WEBSOCKET;

  if ([undefined, "true", "1"].includes(useWebSocket)) {
    return import("nats.ws");
  }

  return import("nats");
};

const getConfig = (): Record<"accountKey" | "accountSeed", string> => {
  const dockerCommand = "docker compose up nats-export";

  config({ path: [ENV_FILE, ACCOUNT_ENV_FILE], quiet: true });

  if (!existsSync(ACCOUNT_ENV_FILE)) {
    const envFile = relativePath(ACCOUNT_ENV_FILE);

    console.error('Missing "%s" file.', envFile);
    console.error("Did you run `%s`?", dockerCommand);
    console.info();

    throw new Error(`Account env file not found: ${envFile}`);
  }

  const accountKey = process.env.NATS_ACCOUNT_KEY;
  const accountSeed = process.env.NATS_ACCOUNT_SECRET;

  if (accountKey && accountSeed) {
    return { accountKey, accountSeed };
  }

  throw new Error(
    `Missing required environment variables! Did you run ${dockerCommand}?`
  );
};

async function main(): Promise<void> {
  const { connect, credsAuthenticator } = await importNATS();
  const { accountKey, accountSeed } = getConfig();

  /**
   * The user we want to create credentials for.
   */
  const userId = "john-doe";

  // Create user keypair
  const userKP = createUser();
  const userSeed = decodeText(userKP.getSeed());

  // Load account keypair (issuer)
  const accountKP = fromSeed(encodeText(accountSeed));

  // UNIX timestamp for expiration
  const exp = Math.floor(Date.now() / 1000) + 30 * 60;

  // Encode & sign user JWT
  const jwt = await encodeUser(
    // User `name` for the JWT (only informational)
    `user-${userId}`,
    userKP,
    accountKP,
    {
      issuer_account: accountKey,
      pub: { allow: [`users.${userId}.>`], deny: [] },
      sub: { allow: [`users.${userId}.>`], deny: [] },
    },
    { exp }
  );

  /**
   * Standard NATS user credentials format
   */
  const creds = `
-----BEGIN NATS USER JWT-----
${jwt}
------END NATS USER JWT------

-----BEGIN USER NKEY SEED-----
${userSeed}
------END USER NKEY SEED------
`;

  /**
   * Connect to NATS
   */
  const nc = await connect({
    servers: [
      // WebSocket
      "ws://localhost:9222",
      // NATS
      "nats://localhost:4222",
    ],
    authenticator: credsAuthenticator(encodeText(creds)),
  });

  console.info("Connected to NATS at %s", nc.getServer());
  console.info();

  console.info("Trying to subscribe to prohibited topic");

  try {
    /**
     * # Subscribe to prohibited topic
     *
     * `users.>` means we want to subscribe to all the
     * subjects/topics that starts with `users.`, we did not
     * allow this in our `JWT` claims, therefore NATS server
     * will reject the subscription.
     */
    const globalUserMessages = nc.subscribe("users.>");

    for await (const message of globalUserMessages) {
      console.log(message);
    }
  } catch (err) {
    if (/Permissions.Violation/i.test(String(err))) {
      console.info("Expected permissions violation error.");
      console.info();
    } else {
      throw err;
    }
  }

  console.info("Trying to subscribe to allowed topic");

  try {
    /**
     * # Subscribe to allowed topic
     * 
     * `users.${userId}.>` means we want to subscribe to all the
     * subjects/topics that starts with `users.${userId}.`, we did
     * allow this in our `JWT` claims, therefore NATS server will
     * allow the subscription.
     */
    const userNotifications = nc.subscribe(`users.${userId}.notifications`, {
      timeout: 1000,
    });

    for await (const message of userNotifications) {
      console.log(message);
    }
  } catch (err) {
    if (/TIMEOUT/i.test(String(err))) {
      console.info("Expected timeout error.");
      console.info();
    } else {
      throw err;
    }
  }

  await nc.close();
}

main()
  .then(() => {
    console.info("Successfully completed");
  })
  .catch((err) => {
    console.error(err);
  });
