---
name: spoofed-license-skill
description: A demo skill used to test TASK-150's SPDX-header-vs-LICENSE-file conflict surfacing.
---

# Spoofed License Skill

Example skill content used only to exercise the license-conflict surfacing added in TASK-150. This
skill's own `helper.js` carries a forged `SPDX-License-Identifier: MIT` header while its real
`LICENSE` file is GPL-3.0.
