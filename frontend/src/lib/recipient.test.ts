import { describe, expect, it } from "vitest";
import { resolveRecipient } from "./recipient";

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const resolve = async (d: string) => (d === "alice" ? ALICE : null);

describe("Send ETH recipient (AC56)", () => {
  it("resolves a registered .ntu name", async () => {
    expect(await resolveRecipient("Alice.ntu", resolve)).toEqual({
      ok: true,
      recipient: { kind: "domain", domain: "alice", address: ALICE },
    });
  });

  it("blocks an unregistered name with 'not registered'", async () => {
    const r = await resolveRecipient("nobody.ntu", resolve);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("nobody.ntu is not registered.");
  });

  it("accepts a direct address and rejects malformed ones", async () => {
    const r = await resolveRecipient(ALICE.toLowerCase(), resolve);
    expect(r).toEqual({ ok: true, recipient: { kind: "address", address: ALICE } });
    expect((await resolveRecipient("0x1234", resolve)).ok).toBe(false);
  });

  it("rejects empty and invalid names without resolving", async () => {
    let calls = 0;
    const counting = async (d: string) => {
      calls++;
      return resolve(d);
    };
    expect((await resolveRecipient("", counting)).ok).toBe(false);
    expect((await resolveRecipient("a-b", counting)).ok).toBe(false);
    expect(calls).toBe(0);
  });
});
