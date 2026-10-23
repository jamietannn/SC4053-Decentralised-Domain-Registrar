import { keccak256, toUtf8Bytes } from "ethers";

/** Contract rule (SPEC §2.1): 3-32 characters, each a-z or 0-9. */
export const DOMAIN_PATTERN = /^[a-z0-9]{3,32}$/;

export type DomainCheck = { ok: true; domain: string } | { ok: false; domain: string; error: string };

/** Trim, lowercase and strip a trailing ".ntu" before validating or hashing. */
export function normalizeDomainInput(input: string): string {
  let domain = input.trim().toLowerCase();
  if (domain.endsWith(".ntu")) domain = domain.slice(0, -4);
  return domain;
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain);
}

export function checkDomain(input: string): DomainCheck {
  const domain = normalizeDomainInput(input);
  if (domain.length === 0) return { ok: false, domain, error: "Enter a domain name." };
  if (!/^[a-z0-9]+$/.test(domain))
    return { ok: false, domain, error: "Only lowercase letters a–z and digits 0–9 are allowed (no hyphens or dots)." };
  if (domain.length < 3) return { ok: false, domain, error: "Domain must be at least 3 characters." };
  if (domain.length > 32) return { ok: false, domain, error: "Domain must be at most 32 characters." };
  return { ok: true, domain };
}

/** nameHash = keccak256(bytes(domain)); the auction key used on-chain. */
export function nameHash(domain: string): string {
  return keccak256(toUtf8Bytes(domain));
}

export const fqdn = (domain: string) => `${domain}.ntu`;
