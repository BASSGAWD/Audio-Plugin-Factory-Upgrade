/**
 * Device pairing: replaces Clerk auth as the DAW sync feature's identity
 * source. No accounts, no third-party service, no sign-up -- two devices
 * that share the same pairing code see the same synced projects. Possession
 * of the code IS the authorization (the same trust model as a shared link
 * or a hotel Wi-Fi code), which is the right level of security for "let my
 * own two devices talk to each other" and needs nothing external to work.
 *
 * Deliberately shaped to be a drop-in for the Clerk `useAuth()` hook this
 * replaced: `{ isSignedIn, userId }`, where `userId` here is the pairing
 * code itself. Every downstream consumer (DAWStudio.tsx, sync.ts,
 * server/dawSync.ts) only ever treated that value as an opaque identity
 * key for namespacing storage -- never anything Clerk-specific -- so this
 * is the only place that needed to change on the client.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "orange_juce_pairing_code_v1";
// 26 unambiguous uppercase letters/digits (no 0/O/1/I/L) grouped for
// readability when a human has to read one code off a screen and type it
// into another device -- "the way an app or a device names a thing" a
// person can actually transcribe, not a UUID.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_GROUPS = 3;
const GROUP_LENGTH = 4;

/** Matches the shape a pairing code must have to be accepted at all --
 *  shared with the server's own validation so both sides agree on what
 *  "looks like a real code" means. */
export const PAIRING_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export function generatePairingCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/** Loose acceptance for a human-typed code: strips whitespace, uppercases,
 *  and re-inserts the dashes if someone typed/pasted it without them. */
export function normalizePairingCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").replace(/-/g, "");
  if (compact.length !== CODE_GROUPS * GROUP_LENGTH) return null;
  const grouped = Array.from({ length: CODE_GROUPS }, (_, i) => compact.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH)).join("-");
  return PAIRING_CODE_PATTERN.test(grouped) ? grouped : null;
}

export function getStoredPairingCode(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && PAIRING_CODE_PATTERN.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function setStoredPairingCode(code: string | null) {
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private browsing, quota) -- pairing just won't
    // persist across reloads this session; sync itself degrades to
    // local-only, same as "not paired", rather than throwing.
  }
}

const PAIRING_EVENT = "orange-juce-pairing-changed";

/** Drop-in replacement for Clerk's `useAuth()` in this file's exact shape.
 *  `userId` is the pairing code (or null when this device isn't paired). */
export function usePairing(): { isSignedIn: boolean; userId: string | null; pair: (code: string) => boolean; unpair: () => void; generate: () => string } {
  const [code, setCode] = useState<string | null>(() => getStoredPairingCode());

  useEffect(() => {
    const onChange = () => setCode(getStoredPairingCode());
    window.addEventListener(PAIRING_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(PAIRING_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const pair = useCallback((input: string) => {
    const normalized = normalizePairingCode(input);
    if (!normalized) return false;
    setStoredPairingCode(normalized);
    setCode(normalized);
    window.dispatchEvent(new Event(PAIRING_EVENT));
    return true;
  }, []);

  const unpair = useCallback(() => {
    setStoredPairingCode(null);
    setCode(null);
    window.dispatchEvent(new Event(PAIRING_EVENT));
  }, []);

  const generate = useCallback(() => {
    const fresh = generatePairingCode();
    setStoredPairingCode(fresh);
    setCode(fresh);
    window.dispatchEvent(new Event(PAIRING_EVENT));
    return fresh;
  }, []);

  return { isSignedIn: code !== null, userId: code, pair, unpair, generate };
}
