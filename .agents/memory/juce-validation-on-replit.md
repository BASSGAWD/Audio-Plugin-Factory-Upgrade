---
name: JUCE validation on Replit
description: Environment-specific requirements for compiling generated JUCE projects in this Replit workspace.
---

When running JUCE compilation from an ad-hoc `nix shell`, export its `NIX_CFLAGS_COMPILE` value through both `CFLAGS` and `CXXFLAGS`. The Replit runtime compiler wrapper may otherwise omit Nix-provided X11 headers even though the dev packages are present.

**Why:** JUCE's `juceaide` configure step failed on `X11/Xlib.h` until the ad-hoc shell's include flags were passed explicitly to CMake's compiler environment.

**How to apply:** The committed Replit package list is enough after a normal environment reload. For one-off `nix shell` validation in an existing session, set `CFLAGS="$NIX_CFLAGS_COMPILE"` and `CXXFLAGS="$NIX_CFLAGS_COMPILE"` before invoking the native control validation command.