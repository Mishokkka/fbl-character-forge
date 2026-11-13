import { MODULE_ID } from "../constants.js";

const CHANNEL = `module.${MODULE_ID}`;
const REQUEST_TIMEOUT = 60_000;
const requests = new Map();
const handledRequests = new Map();
let operations = {};
let queue = Promise.resolve();

export function registerWorldOperations(handlers, initialize) {
  operations = handlers;
  game.socket.on(CHANNEL, (message, senderId) => {
    const sender = game.users.get(senderId);
    if (!sender?.isGM || !message) return;
    if (message.reply) {
      const request = requests.get(message.id);
      if (request?.recipient === senderId) request.finish(message);
      return;
    }
    if (!game.user.isActiveGM || typeof message.id !== "string" || !Object.hasOwn(operations, message.operation)) return;
    const key = senderId + ":" + message.id;
    if (handledRequests.has(key)) return;
    handledRequests.set(key, true);
    void (async () => {
      try {
        const value = await execute(message.operation, message.data, sender);
        reply(senderId, { id: message.id, reply: true, value });
      } catch (error) {
        reply(senderId, { id: message.id, reply: true, error: error?.message || String(error) });
      } finally {
        setTimeout(() => handledRequests.delete(key), REQUEST_TIMEOUT);
      }
    })();
  });
  Hooks.on("userConnected", () => {
    if (game.user.isActiveGM) {
      void runOnActiveGM(initialize).catch(error => {
        console.warn(MODULE_ID + " | Active GM initialization failed", error);
      });
    }
  });
  return game.user.isActiveGM ? runOnActiveGM(initialize) : Promise.resolve();
}

function reply(userId, message) {
  game.socket.emit(CHANNEL, message, { recipients: [userId] });
}

function execute(operation, data, user) {
  return runOnActiveGM(() => {
    const permission = operation === "createActor" ? "ACTOR_CREATE" : "SETTINGS_MODIFY";
    if (!user?.isGM || !user.can(permission)) throw new Error(game.i18n.localize("FBL_CF.Status.OperationDenied"));
    return operations[operation](data, user);
  });
}

export function runOnActiveGM(action) {
  const run = queue.then(() => {
    requireActiveGM();
    return action();
  });
  queue = run.catch(() => undefined);
  return run;
}

export function requireActiveGM() {
  if (!game.user.isActiveGM || game.socket.connected === false) {
    throw new Error(game.i18n.localize("FBL_CF.Status.NoActiveGM"));
  }
}

export async function runWorldOperation(operation, data = {}) {
  const gm = game.users.activeGM;
  if (!game.user?.isGM || !gm || game.socket.connected === false) {
    throw new Error(game.i18n.localize("FBL_CF.Status.NoActiveGM"));
  }
  if (!Object.hasOwn(operations, operation)) throw new Error(`Unknown Character Forge operation: ${operation}`);
  if (gm.id === game.user.id) return execute(operation, data, game.user);

  const id = foundry.utils.randomID();
  return new Promise((resolve, reject) => {
    const finish = ({ error, value }) => {
      clearTimeout(timer);
      requests.delete(id);
      if (error) reject(new Error(error));
      else resolve(value);
    };
    const timer = setTimeout(() => finish({ error: game.i18n.localize("FBL_CF.Status.GMTimeout") }), REQUEST_TIMEOUT);
    requests.set(id, { recipient: gm.id, finish });
    reply(gm.id, { id, operation, data });
  });
}
