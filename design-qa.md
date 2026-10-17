# Paper UI design QA — 2026-10-17

final result: passed

Scope: selected third visual direction adapted to the existing React research workspace. This is a visual and isolated interaction pass, not paid-backend acceptance or pixel-identical reproduction of generated sample prose.

## Evidence
- Source visual truth: docs/medical-v01/paper-ui/selected-design.png (1487 × 1058).
- Implemented report: docs/medical-v01/paper-ui/report-desktop.jpg (1440 × 1024 CSS viewport).
- Report delivery / hover: docs/medical-v01/paper-ui/report-download-desktop.jpg (1440 × 1024; earlier wide-container iteration, same components and states).
- Real connected homepage: docs/medical-v01/paper-ui/home-desktop.jpg (native browser viewport).
- Mobile: docs/medical-v01/paper-ui/home-mobile.jpg, docs/medical-v01/paper-ui/error-mobile.jpg (390 × 844).
- Also inspected 320 × 740 and 1024 × 768; no document horizontal overflow, composer bottom inside viewport.
- Normalization: source and desktop report have approximately the same aspect ratio. Source is viewed scaled to the report's CSS width; no exact pixel-difference metric claimed. Both images were opened together in one comparison input; footer/download and mobile views were inspected separately for readable controls.

## Resolved findings
- P2: event-driven auto-scroll hid the title and interrupted report reading. Restrict automatic positioning to newly submitted turns.
- P2: mobile composer initially appeared below the long home content. Separate the scrolling content from the composer, which now occupies its own fixed layout row. Rechecked at 320 and 390px.
- P2: icon-only download differed from the chosen report attachment. Add visible 下载报告 text and restrained olive hover treatment.
- P2: platform font fallback made Chinese typography inconsistent. Bundle small Noto Sans/Serif subsets locally with both OFL notices; unbundled glyphs retain system fallback. Corrected source format to TTF before final capture.

## Required fidelity surfaces
- Fonts / typography: local sans for interface and readable 15px report body; serif display titles, 38px desktop research title, 26px report headings; tabular data. Mobile headings wrap without isolated punctuation. No raster text.
- Spacing / layout: chosen horizontal navigation, centered reading width, right persistent timeline, warm paper surface. Report content scrolls independently while composer remains accessible. Mobile timeline follows the report in the same scrolling region.
- Colors / tokens: #f8f5ef canvas, #302f2b ink, #76736a secondary, #6b7352 olive accent. Ant Design tokens match CSS. Focus, hover and active states share that family; semantic errors retain red.
- Assets: the reference has no photographic/illustrative assets. Retain the product's existing 研 brand mark and installed Ant Design icons. Local font files total about 331KB, no external runtime font requests.
- Copy / content: preserve real current-session, event, Markdown and file behavior. Never infer successful tool completion from a start event. Demo screenshot content is returned only by the isolated fixture server; production source has no seeded answers or pretend file links.

## Accepted differences from generated concept
- Connection details, existing execution details, answer metadata and current-session notice remain available. They add vertical content compared with the image; long reports require scrolling to reach attachments. This is expected dynamic report behavior, not clipped controls.
- Use readable sans body text rather than the generated image's serif-heavy body. Serif titles retain the selected editorial character.
- Real statuses and timestamps replace decorative mock copy. No fabricated metrics, history, or report-delivery claims.

## Validation
- TypeScript build and Vite production bundle passed; git diff --check passed.
- Isolated API/WebSocket fixture: sample prompt fill, submission, response rendering, real Markdown table, attachment selection/upload feedback, cancellation, new-session reset, error alert and report download all verified through the browser.
- The fixture download was saved and compared to the served UTF-8 report bytes.
- Real app on port 5173 opens the updated homepage and reports connected. No paid research request submitted there.
- Existing Ant Design 5 / React 19 compatibility warning remains; no dependency upgrade is part of this work.
- app/tools/db_tools.py unchanged against the recorded baseline hash. API, session hook, database and backend sources unchanged.

## Follow-up polish
- P3: arbitrary Chinese report glyphs outside the bundled UI subset use system fallback; broader font coverage can be added if required.
- Paid full-backend workflow revalidation was intentionally not run. Isolated frontend verification does not establish current production business acceptance.
