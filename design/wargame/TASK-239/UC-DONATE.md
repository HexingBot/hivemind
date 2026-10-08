---
# TASK-240 CU9 pilot: Wrecker spec for TASK-239's approved use cases (CU1-CU5 = AC1-AC5).
# Derived from the approved ACs, not from the code. CU5's docs cleanup is not a flow and is not modelled here.
id: UC-DONATE
name: Donate a chosen amount via PayPal.me
actor: Visitor
level: user_goal
scope: hivemind public site (docs/index.html)
spec_version: donate-v2
trigger: "The visitor clicks ♥ DONATE (footer or top bar)"
preconditions:
  - the site is loaded
  - PayPal user is josematovelle1

fog:
  injects: 4
  success_postcondition: 4
  failure_postcondition: 4

initial_world:
  lang: en
  dialog_open: false
  opener: none
  amount_valid: false
  go_enabled: false
  url_shown: false
  error_shown: false
  focus: page
  paypal_opened: false
  new_tab: false

# CU1-CU3: PayPal opened in a new tab with a valid amount, dialog closed, focus back on the opener.
success_postcondition:
  all:
    - { op: eq, path: paypal_opened, value: true }
    - { op: eq, path: new_tab, value: true }
    - { op: eq, path: amount_valid, value: true }
    - { op: eq, path: dialog_open, value: false }
    - { op: eq, path: focus, value: opener }
# The visitor left without donating: nothing opened, dialog closed, focus back on the opener.
failure_postcondition:
  all:
    - { op: eq, path: paypal_opened, value: false }
    - { op: eq, path: dialog_open, value: false }
    - { op: eq, path: focus, value: opener }

referenced_states:
  - lang
  - dialog_open
  - amount_valid
  - go_enabled

injects:
  # The amount field loses its value (autofill, paste of junk) right before confirming.
  - name: amount_garbled
    family: input
    applies_when: { op: eq, path: dialog_open, value: true }
    effect: { amount_valid: false }
---

## Main flow

1. [click_donate_footer] Visitor: clicks ♥ DONATE in the footer → the dialog opens (showModal) with amount 5 and the line https://paypal.me/josematovelle1/5USD.
   - effect: { dialog_open: true, opener: footer, amount_valid: true, go_enabled: true, url_shown: true, error_shown: false, focus: dialog }
   - goto: 2
2. [type_valid_amount] Visitor: types an amount of 1 or more (7.9 → 7USD) → the URL line updates and Go to PayPal is enabled.
   - requires: { op: eq, path: dialog_open, value: true }
   - input: a number >= 1, rounded down
   - effect: { amount_valid: true, go_enabled: true, url_shown: true, error_shown: false }
   - goto: 3
3. [click_go_to_paypal] Visitor: clicks Go to PayPal → PayPal opens in a new tab (noopener,noreferrer), the dialog closes, focus returns to the donate button that opened it.
   - requires: { all: [ { op: eq, path: dialog_open, value: true }, { op: eq, path: go_enabled, value: true }, { op: eq, path: amount_valid, value: true } ] }
   - effect: { paypal_opened: true, new_tab: true, dialog_open: false, focus: opener }
   - goto: end_success

## Alternate flows

- 1a. condition: the visitor uses the ♥ DONATE button in the top bar (EN/ES bar) instead of the footer
  - anchor: 1
  - 1a1. [click_donate_top] Visitor: clicks ♥ DONATE in the top bar → the same dialog opens with amount 5.
    - effect: { dialog_open: true, opener: top, amount_valid: true, go_enabled: true, url_shown: true, error_shown: false, focus: dialog }
    - goto: 2
- 1b. condition: the visitor switches the site to Spanish before donating
  - anchor: 1
  - applies_when: { op: eq, path: lang, value: en }
  - 1b1. [switch_to_es] Visitor: clicks ES → every text, the donate buttons and the dialog texts are in Spanish.
    - effect: { lang: es }
    - goto: 1
- 2a. condition: the amount is empty, 0, negative or not a number
  - anchor: 2
  - 2a1. [type_invalid_amount] Visitor: types an invalid amount → the error "Enter an amount of 1 USD or more" shows and Go to PayPal is disabled.
    - effect: { amount_valid: false, go_enabled: false, url_shown: false, error_shown: true }
    - goto: 2
- 2b. condition: the visitor presses Tab while the dialog is open
  - anchor: 2
  - 2b1. [press_tab] Visitor: presses Tab → focus stays inside the dialog.
    - effect: { focus: dialog }
    - goto: 2
- 2g. condition: the visitor keeps the initial amount of 5 and confirms right away
  - anchor: 2
  - applies_when: { op: eq, path: amount_valid, value: true }
  - 2g1. [go_with_default_amount] Visitor: clicks Go to PayPal without editing → https://paypal.me/josematovelle1/5USD opens in a new tab, the dialog closes, focus returns to the opener.
    - effect: { paypal_opened: true, new_tab: true, dialog_open: false, focus: opener }
    - goto: end_success
- 2c. condition: the visitor clicks outside the dialog (for example after drag-selecting the amount)
  - anchor: 2
  - 2c1. [click_outside] Visitor: clicks or releases the mouse on the backdrop → the dialog stays open.
    - effect: { dialog_open: true }
    - goto: 2

## Exception flows

- 3a. condition: the amount is no longer valid when Go to PayPal is clicked
  - anchor: 3
  - applies_when: { op: eq, path: amount_valid, value: false }
  - recovery: the visitor fixes the amount or closes the dialog
  - 3a1. [confirm_with_invalid_amount] Visitor: clicks Go to PayPal → nothing opens, the error shows, Go to PayPal is disabled and the dialog stays open.
    - effect: { go_enabled: false, url_shown: false, error_shown: true, dialog_open: true }
    - goto: 2

- 2d. condition: the visitor closes the dialog with ✕
  - anchor: 2
  - recovery: the visitor can click ♥ DONATE again
  - 2d1. [close_with_x] Visitor: clicks ✕ → the dialog closes, nothing opens, focus returns to the opener.
    - effect: { dialog_open: false, focus: opener }
    - goto: end_failure
- 2e. condition: the visitor clicks Cancel
  - anchor: 2
  - recovery: the visitor can click ♥ DONATE again
  - 2e1. [click_cancel] Visitor: clicks Cancel → the dialog closes, nothing opens, focus returns to the opener.
    - effect: { dialog_open: false, focus: opener }
    - goto: end_failure
- 2f. condition: the visitor presses Escape
  - anchor: 2
  - recovery: the visitor can click ♥ DONATE again
  - 2f1. [press_escape] Visitor: presses Escape → the dialog closes, nothing opens, focus returns to the opener.
    - effect: { dialog_open: false, focus: opener }
    - goto: end_failure
