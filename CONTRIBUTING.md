# Contributing

Keep a change focused on the problem it fixes. Explain why it's needed and list
the checks you actually ran. Include the app version, TV model and firmware in
bug reports. Don't post credentials or captured HDMI pictures.

## Code and text

Use the existing plain JavaScript modules and follow `.editorconfig`. Don't mix
a formatting pass with behaviour changes. Add a dependency only when the code
needs it.

Comments should explain a constraint or a non-obvious decision. Remove notes
about abandoned implementations instead of adding another update underneath.
Write documentation from the current code, not from a development conversation.
Use direct instructions, exact paths and the labels shown in the app. Keep test
results separate from claims about TV compatibility.

Preserve application IDs, stored preference keys and recovery fixtures unless
the change includes a migration. Some identifiers still use the old project
name because installed TVs depend on them.

## Native services

Optional services must fail independently. A root-shell command working doesn't
prove the packaged app has permission to call it.

Keep the helper's ownership, path and manifest checks. Don't weaken them to make
an unsupported TV look compatible. `app/appinfo.json` is hashed by the helper;
changes require updating its pin in `tv-helper/thumbnail_cache.py`.

Never test recovery or ownership checks against a real TV's files from a desktop
test runner. The Python tests use temporary directories. Some require a Linux
root test environment and skip elsewhere.

## Checks

Use [Building and testing](docs/BUILDING.md). Run the relevant unit and browser
tests, then build and inspect the IPK. Record failures and skipped tests rather
than describing a partial run as the whole suite.

For a native change, test the packaged app on the TV. Check install, upgrade,
app and HDMI return, standby, removal and the recovery path affected by the
change. Keep a separate way to reach the TV when testing Home replacement.

## Releases

Build from the commit being released. Upload the verified IPK, `SHA256SUMS` and
matching source. Add a short version note under `docs/releases/` with changes
and known limitations. Old notes describe those versions, not the current app.

This checkout has no GitHub Actions publishing workflow. Pushing a commit
doesn't build or publish a release.

Keep licence notices with the code and data they cover. Document where new
assets came from and whether they can be redistributed. A file being committed
doesn't give it the project's licence automatically.

