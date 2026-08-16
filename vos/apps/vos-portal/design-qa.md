# Fluent 2 visual QA

Reference: selected方案 3 “Fluent Learning Journey” visual target.

Checked in the local Demo preview at the desktop default viewport and at 390×844:

- the student journey starts at the current Lab, points to stage detail, and links through runs to evidence;
- the shared shell uses Fluent Provider, Fluent icons, semantic status colors, restrained elevation, and a responsive mobile navigation Drawer;
- student and staff layouts retain the same information hierarchy while staff tables collapse to a readable mobile scan surface;
- the rerun flow opens a focus-managed confirmation Dialog and requires an explicit reason;
- notification and error states retain keyboard focus management and recovery actions.

Dark theme, forced-colors, and reduced-motion are implemented through Fluent Provider and media queries. Automated snapshots cover 1440, 1366, 834, and 390px widths; theme specs cover dark, forced-colors, and reduced-motion variants.

The focused axe suite covers the student workspace and staff operations page, including the
mobile Drawer and notification/Dialog focus paths.

final result: passed
