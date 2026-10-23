import { getAddress, isAddress, ZeroAddress } from "ethers";
import { checkDomain, fqdn } from "./domain";

export type Recipient = { kind: "address"; address: string } | { kind: "domain"; domain: string; address: string };

export type RecipientResult = { ok: true; recipient: Recipient } | { ok: false; error: string };

/** Turn the Send ETH input into a destination address, resolving .ntu names through `resolve`. */
export async function resolveRecipient(
  input: string,
  resolve: (domain: string) => Promise<string | null>,
): Promise<RecipientResult> {
  const value = input.trim();
  if (value.length === 0) return { ok: false, error: "Enter a .ntu domain or an address." };
  if (/^0x/i.test(value)) {
    if (!isAddress(value)) return { ok: false, error: "That is not a valid Ethereum address." };
    return { ok: true, recipient: { kind: "address", address: getAddress(value) } };
  }
  const check = checkDomain(value);
  if (!check.ok) return { ok: false, error: check.error };
  const address = await resolve(check.domain);
  if (!address || address === ZeroAddress) return { ok: false, error: `${fqdn(check.domain)} is not registered.` };
  return { ok: true, recipient: { kind: "domain", domain: check.domain, address } };
}
