# Remove Connection Dots

## Scope

Remove the environment and last-connection-status dots displayed before connection names in the navigation tree.

## Design

- Remove the two dot elements from the connection-row template in `TreeItem.vue`.
- Remove their now-unused CSS and imports.
- Keep environment configuration, connection status tracking, and all non-navigation displays unchanged.

## Verification

- Add a regression test asserting that the connection tree item no longer renders either dot.
- Run the focused test, UI typecheck, and lint checks.
