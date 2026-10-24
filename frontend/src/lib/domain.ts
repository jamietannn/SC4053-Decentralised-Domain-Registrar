// Pure helpers (no Vite-specific globals) so they can also be imported by the Hardhat tests.
import { AbiCoder, ZeroHash, getBytes, hexlify, keccak256, parseEther, toUtf8Bytes } from "ethers";

export const MIN_LEN = 3;
export const MAX_LEN = 32;

/** Lowercase, trim and strip a trailing ".ntu". */
export function normalise(input: string): string {
  let d = input.trim().toLowerCase();
  if (d.endsWith(".ntu")) d = d.slice(0, -4);
  return d;
}

/** Returns an error message, or null when the (already normalised) label is valid. */
export function validateDomain(d: string): string | null {
  if (d.length < MIN_LEN || d.length > MAX_LEN) return `Names must be ${MIN_LEN}–${MAX_LEN} characters long.`;
  if (!/^[a-z0-9]+$/.test(d)) return "Only lowercase letters a–z and digits 0–9 are allowed (no hyphens or symbols).";
  return null;
}

export const nameHash = (domain: string): string => keccak256(toUtf8Bytes(domain));

/** keccak256(abi.encode(string domain, uint256 bid, bytes32 salt)) — must match NtuNames.revealBid. */
export function commitmentOf(domain: string, bidWei: bigint, salt: string): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["string", "uint256", "bytes32"], [domain, bidWei, salt]));
}

/** 32 random bytes from the Web Crypto API. */
export function randomSalt(): string {
  return hexlify(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export function isSalt(s: string): boolean {
  try {
    return /^0x[0-9a-fA-F]{64}$/.test(s.trim()) && getBytes(s.trim()).length === 32;
  } catch {
    return false;
  }
}

/** Parses a decimal ETH string; returns null for empty/invalid/negative input. */
export function parseEthAmount(s: string): bigint | null {
  const t = s.trim().replace(/\s*ETH$/i, "");
  if (!/^\d*\.?\d+$|^\d+\.?$/.test(t)) return null;
  try {
    return parseEther(t);
  } catch {
    return null;
  }
}

/** True when a stored bid commitment (bytes32) is non-empty, i.e. the address committed in that auction. */
export const hasCommitment = (commitment: string): boolean => commitment !== ZeroHash;
