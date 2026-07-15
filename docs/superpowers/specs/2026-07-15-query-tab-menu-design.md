# Query Tab Menu and Icon Sizing

## Scope

- Render query-tab database icons at 20 by 20 pixels.
- Render database icons in the connection-form dialect selector at 20 by 20 pixels.
- Hide the query tab bar's visible horizontal scrollbar.
- Add a fixed right-side menu for managing all open tabs.

## Design

The query header becomes a flex row containing a scrollable tab strip and a fixed actions area. The strip keeps horizontal scrolling and the existing active-tab `scrollIntoView` behavior, but hides its scrollbar. The fixed area contains the existing new-query command followed by the all-tabs menu button.

The menu uses the existing ordered tab collection and existing activation, pin, close, and dirty-check flows. It lists every open tab, highlights the active tab, displays the connection dialect icon at 20 pixels, and provides pin and close controls. Clicking outside the menu or pressing Escape closes it.

`DialectSelect.vue` uses 20-pixel icons in both its trigger and option rows. No connection data or tab persistence format changes.

## Verification

- Add focused regression tests for icon sizes, fixed tab actions, hidden scrollbar styling, and menu interaction wiring.
- Run UI typecheck, lint, and the complete test suite.
- Verify the live Electron development UI at desktop width and a narrowed window without overlap.
