import assert from "node:assert/strict";
import { test } from "node:test";
import { registerWorldOperations, runOnActiveGM, runWorldOperation } from "../scripts/services/world-operations.js";

test("remote operations expire in the queue and replay lost results under the same ID", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const gm = { id: "authority", isGM: true, isActiveGM: true, can: () => true };
  const sender = { id: "sender", isGM: true, isActiveGM: false, can: () => true };
  let deliver;
  const sent = [];
  globalThis.Hooks = { on() {} };
  globalThis.foundry = { utils: { randomID: () => "from-sender" } };
  globalThis.game = {
    user: gm,
    users: Object.assign(new Map([[gm.id, gm], [sender.id, sender]]), { activeGM: gm }),
    socket: {
      connected: true,
      on(_channel, handler) { deliver = handler; },
      emit(_channel, message) { sent.push(message); }
    },
    i18n: { localize: key => key }
  };

  const slow = Promise.withResolvers();
  let executions = 0;
  await registerWorldOperations({
    createActor: async () => {
      executions += 1;
      await slow.promise;
      return { actorUuid: "Actor.created" };
    }
  }, () => {});

  const barrier = Promise.withResolvers();
  const blocked = runOnActiveGM(() => barrier.promise);
  deliver({ id: "expired", request: { operation: "createActor", deadline: Date.now() + 60_000 } }, sender.id);
  assert.equal(sent.at(-1).state, "queued");
  t.mock.timers.tick(60_001);
  deliver({ id: "expired", status: true }, sender.id);
  assert.match(sent.at(-1).error, /GMQueueExpired/);
  barrier.resolve();
  await blocked;
  await runOnActiveGM(() => {});
  assert.equal(executions, 0);

  game.user = sender;
  let done = false;
  const result = runWorldOperation("createActor").finally(() => { done = true; });
  const envelope = sent.at(-1);
  assert.equal(envelope.id, "from-sender");
  game.user = gm;
  deliver(envelope, sender.id);
  await Promise.resolve();
  const started = sent.at(-1);
  assert.equal(started.state, "running");

  game.user = sender;
  deliver(started, gm.id);
  for (let elapsed = 0; elapsed < 150_000; elapsed += 30_000) {
    t.mock.timers.tick(30_000);
    const probe = sent.at(-1);
    assert.deepEqual(probe, { id: envelope.id, status: true });
    game.user = gm;
    deliver(probe, sender.id);
    assert.equal(sent.at(-1).state, "running");
    game.user = sender;
    deliver(sent.at(-1), gm.id);
    assert.equal(done, false);
  }

  game.user = gm;
  slow.resolve();
  await runOnActiveGM(() => {});
  const completed = sent.at(-1);
  assert.equal(completed.state, "complete");

  // Drop the completion message and recover the cached outcome with the next status probe.
  game.user = sender;
  t.mock.timers.tick(3_000);
  const probe = sent.at(-1);
  game.user = gm;
  deliver(probe, sender.id);
  const replay = sent.at(-1);
  assert.deepEqual(replay, completed);
  game.user = sender;
  deliver(replay, gm.id);
  assert.deepEqual(await result, { actorUuid: "Actor.created" });
  assert.equal(executions, 1);
});
