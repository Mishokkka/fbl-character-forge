import { MODULE_ID } from "../constants.js";

const CHANNEL = `module.${MODULE_ID}`;
const QUEUE_TIMEOUT = 60_000;
const STATUS_INTERVAL = 3_000;
const STATUS_TIMEOUT = 60_000;
const RESULT_TTL = 5 * 60_000;
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
      if (request?.recipient === senderId) request.receive(message);
      return;
    }
    if (typeof message.id === "string") receiveRemoteRequest(message, senderId, sender);
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

function serverNow() {
  const time = game.time?.serverTime;
  return Number.isFinite(time) ? time : Date.now();
}

function receiveRemoteRequest(message, senderId, sender) {
  const { id } = message;
  const { operation, data, deadline } = message.request ?? {};
  const key = `${senderId}:${id}`;
  const existing = handledRequests.get(key);
  const send = response => reply(senderId, { id, reply: true, ...response });
  if (existing) {
    existing.expireIfQueued();
    send(existing.response);
    return;
  }
  if (message.status || !game.user.isActiveGM || !Object.hasOwn(operations, operation) || !Number.isSafeInteger(deadline)) return;
  const finish = result => {
    request.response = { state: "complete", ...result };
    setTimeout(() => handledRequests.delete(key), RESULT_TTL);
  };
  const expiresAt = Math.min(deadline, serverNow() + QUEUE_TIMEOUT);
  const request = {
    response: { state: "queued" },
    expireIfQueued() {
      if (request.response.state !== "queued" || serverNow() < expiresAt) return false;
      finish({ error: game.i18n.localize("FBL_CF.Status.GMQueueExpired") });
      return true;
    }
  };
  handledRequests.set(key, request);
  request.expireIfQueued();
  send(request.response);
  if (request.response.state !== "queued") return;

  void runOnActiveGM(async () => {
    if (request.response.state !== "queued") return;
    if (!request.expireIfQueued()) {
      request.response = { state: "running" };
      send(request.response);
      finish({ value: await execute(operation, data, sender) });
    }
    send(request.response);
  }).catch(error => {
    if (request.response.state === "complete") return;
    finish({ error: error?.message || String(error) });
    send(request.response);
  });
}

function execute(operation, data, user) {
  const permission = operation === "createActor" ? "ACTOR_CREATE" : "SETTINGS_MODIFY";
  if (!user?.isGM || !user.can(permission)) throw new Error(game.i18n.localize("FBL_CF.Status.OperationDenied"));
  return operations[operation](data, user);
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
  if (gm.id === game.user.id) return runOnActiveGM(() => execute(operation, data, game.user));

  const id = foundry.utils.randomID();
  const deadline = Math.floor(serverNow() + QUEUE_TIMEOUT);
  return new Promise((resolve, reject) => {
    let responseDeadline = Date.now() + QUEUE_TIMEOUT + STATUS_TIMEOUT;
    const finish = ({ error, value }) => {
      clearInterval(timer);
      requests.delete(id);
      if (error) reject(new Error(error));
      else resolve(value);
    };
    const timer = setInterval(() => {
      if (Date.now() >= responseDeadline) finish({ error: game.i18n.localize("FBL_CF.Status.GMTimeout") });
      else if (game.socket.connected !== false) reply(gm.id, { id, status: true });
    }, STATUS_INTERVAL);
    const receive = message => {
      if (message.state === "complete") finish(message);
      else if (message.state === "running") responseDeadline = Date.now() + STATUS_TIMEOUT;
    };
    // Poll using the same ID so a missed completion reply can be recovered without repeating the operation.
    requests.set(id, { recipient: gm.id, receive });
    reply(gm.id, { id, request: { operation, data, deadline } });
  });
}
