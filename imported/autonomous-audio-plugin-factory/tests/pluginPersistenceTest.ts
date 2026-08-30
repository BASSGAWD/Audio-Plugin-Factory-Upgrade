/**
 * Plugin persistence — the two real data-loss bugs this module was extracted
 * to fix, each verified decisive-gap style (CLAUDE.md): the honest behavior
 * versus a faithful reproduction of the OLD broken behavior, asserting a real
 * difference in outcome. A test that passes under both implementations would
 * be proving nothing.
 *
 *  1. Boot verification used to overwrite the user's stored plugin with the
 *     stock default when the cached one failed to compile -- permanent,
 *     unrecoverable, announced only by a console.warn.
 *  2. The save path called localStorage.setItem unguarded, so a quota
 *     exhaustion threw out of savePluginState into a caller whose own catch
 *     called it again (throwing a second time outside any try) -- suppressing
 *     the build's success message while React showed a plugin storage never
 *     received, which silently reverted on the next reload.
 */
import {
  PLUGIN_STORAGE_KEY, PLUGIN_REJECTED_KEY,
  savePersistedPlugin, readPersistedPluginRaw,
  preserveRejectedPlugin, readRejectedPluginRaw,
} from "../src/utils/pluginPersistence";
import { AudioPlugin } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* A localStorage stub whose quota can be turned off at will, so the failure
   path is exercised for real rather than mocked at the module boundary. */
let mem = new Map<string, string>();
let quotaExhausted = false;
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (quotaExhausted) {
      const err: any = new Error("QuotaExceededError: localStorage is full");
      err.name = "QuotaExceededError";
      throw err;
    }
    mem.set(k, v);
  },
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

const mkPlugin = (name: string, dsp = "return inputSample;"): AudioPlugin => ({
  id: name, name, category: "dynamics", description: "",
  parameters: [], dspFunction: dsp, faustCode: "", cppJuceCode: "", createdAt: "",
});

const USER_PLUGIN = mkPlugin("User's Precious Compressor");
const DEFAULT_PLUGIN = mkPlugin("Default Starting Plugin");

/* ---- 1. Boot verification must NOT destroy the stored plugin ---- */
{
  // The cached plugin the user actually built, with DSP that no longer
  // compiles (the exact scenario the boot check exists to survive).
  const broken = JSON.stringify(mkPlugin("User's Precious Compressor", "this is ( not valid javascript"));

  // --- Deliberately-broken counterpart: the OLD behavior, verbatim. ---
  mem = new Map(); quotaExhausted = false;
  mem.set(PLUGIN_STORAGE_KEY, broken);
  // old code path: on compile failure, overwrite storage with the default
  localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(DEFAULT_PLUGIN));
  const afterOldBehavior = readPersistedPluginRaw();
  check(
    "OLD behavior loses the user's plugin (sanity check on the counterpart)",
    afterOldBehavior === JSON.stringify(DEFAULT_PLUGIN) && !afterOldBehavior!.includes("Precious"),
    "the stored plugin was replaced by the default"
  );

  // --- Honest behavior: preserve it, never overwrite. ---
  mem = new Map(); quotaExhausted = false;
  mem.set(PLUGIN_STORAGE_KEY, broken);
  const preserved = preserveRejectedPlugin(broken);
  check("preserveRejectedPlugin reports success", preserved === true);
  check(
    "the user's plugin is STILL in its own slot, untouched",
    readPersistedPluginRaw() === broken && readPersistedPluginRaw()!.includes("Precious"),
    "decisive gap vs. the old behavior above"
  );
  check(
    "the rejected plugin is recoverable from the backup key",
    readRejectedPluginRaw() === broken,
    `key=${PLUGIN_REJECTED_KEY}`
  );
}

/* ---- 2. A full-quota save must report failure, not throw ---- */
{
  mem = new Map(); quotaExhausted = false;
  check("a normal save succeeds and round-trips", savePersistedPlugin(USER_PLUGIN) === true && readPersistedPluginRaw() === JSON.stringify(USER_PLUGIN));

  // --- Deliberately-broken counterpart: unguarded setItem throws. ---
  mem = new Map(); quotaExhausted = true;
  let oldThrew = false;
  try {
    localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(USER_PLUGIN)); // the OLD unguarded line
  } catch {
    oldThrew = true;
  }
  check("OLD unguarded save THROWS on a full quota (sanity check on the counterpart)", oldThrew);

  // --- Honest behavior: returns false, never throws. ---
  mem = new Map(); quotaExhausted = true;
  let newThrew = false;
  let result: boolean | null = null;
  try {
    result = savePersistedPlugin(USER_PLUGIN);
  } catch {
    newThrew = true;
  }
  check("savePersistedPlugin does NOT throw on a full quota", newThrew === false, "decisive gap vs. the old behavior above");
  check("savePersistedPlugin reports the failure honestly (returns false)", result === false);
  check("nothing was silently half-written", readPersistedPluginRaw() === null);

  // Recovery: once space frees up, saving works again with no lingering state.
  quotaExhausted = false;
  check("saving works again once quota frees up", savePersistedPlugin(USER_PLUGIN) === true && readPersistedPluginRaw() === JSON.stringify(USER_PLUGIN));
}

/* ---- 3. Even a failed BACKUP write must never fall back to overwriting the
   real slot -- that would reintroduce bug 1 through the back door. ---- */
{
  mem = new Map();
  mem.set(PLUGIN_STORAGE_KEY, JSON.stringify(USER_PLUGIN));
  quotaExhausted = true;
  const ok = preserveRejectedPlugin("{\"name\":\"whatever\"}");
  quotaExhausted = false;
  check("preserveRejectedPlugin reports failure rather than throwing", ok === false);
  check(
    "the user's stored plugin is STILL intact after a failed backup",
    readPersistedPluginRaw() === JSON.stringify(USER_PLUGIN),
    "a failed backup must never become a reason to overwrite"
  );
}

console.log(failures === 0 ? "\nPLUGIN PERSISTENCE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
