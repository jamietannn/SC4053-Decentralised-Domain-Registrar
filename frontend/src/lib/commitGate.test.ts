import { describe, expect, it } from "vitest";
import { commitBlocker } from "./commitGate";

const ready = {
  canTransact: true,
  inCommitPhase: true,
  alreadyCommitted: false,
  bidWei: 10n ** 16n,
  salt: "0x" + "11".repeat(32),
  acknowledged: true,
};

describe("commit button gating (AC53)", () => {
  it("is enabled only when everything is ready, including the save acknowledgement", () => {
    expect(commitBlocker(ready)).toBeNull();
    expect(commitBlocker({ ...ready, acknowledged: false })).toMatch(/saved/);
  });

  it("explains each other blocker", () => {
    expect(commitBlocker({ ...ready, salt: null })).toMatch(/salt/);
    expect(commitBlocker({ ...ready, bidWei: null })).toMatch(/bid/);
    expect(commitBlocker({ ...ready, bidWei: 0n })).toMatch(/bid/);
    expect(commitBlocker({ ...ready, canTransact: false })).toMatch(/wallet/);
    expect(commitBlocker({ ...ready, inCommitPhase: false })).toMatch(/over/);
    expect(commitBlocker({ ...ready, alreadyCommitted: true })).toMatch(/already/);
  });
});
