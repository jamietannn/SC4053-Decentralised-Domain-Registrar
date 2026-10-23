import { getAddress, isAddress } from "ethers";

export type AddressCheck = { ok: true; address: string } | { ok: false; error: string };

/** Strict address input for reverse lookup (SPEC §7): 0x + 40 hex; a mixed-case address must have a valid checksum. */
export function checkAddress(input: string): AddressCheck {
  const value = input.trim();
  if (value.length === 0) return { ok: false, error: "Enter an Ethereum address." };
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    return { ok: false, error: "Enter a valid Ethereum address (0x followed by 40 hex characters)." };
  if (!isAddress(value)) return { ok: false, error: "This address has an invalid checksum. Check for typos." };
  return { ok: true, address: getAddress(value) };
}
