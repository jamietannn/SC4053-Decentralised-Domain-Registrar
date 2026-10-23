import { AbiCoder, hexlify, keccak256 } from "ethers";

/**
 * commitment = keccak256(abi.encode(string domain, uint256 bidWei, bytes32 salt)) — must match NtuNames.revealBid.
 * Always computed locally: the plaintext never goes to an RPC node.
 */
export function computeCommitment(domain: string, bidWei: bigint, salt: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["string", "uint256", "bytes32"], [domain, bidWei, salt]));
}

/** 32 random bytes from the browser's CSPRNG, as 0x-prefixed hex. */
export function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hexlify(bytes);
}

/** Accepts 64 hex characters with or without 0x; returns lowercase 0x-hex or null. */
export function parseSalt(input: string): string | null {
  const s = input.trim();
  const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? `0x${hex.toLowerCase()}` : null;
}
