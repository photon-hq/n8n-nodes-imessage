# n8n-nodes-imessage

[![npm version](https://img.shields.io/npm/v/n8n-nodes-imessage.svg)](https://www.npmjs.com/package/n8n-nodes-imessage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

n8n community node for **iMessage by Photon**, built on [Spectrum](https://github.com/photon-hq/spectrum-ts) — Photon's managed iMessage runtime. Send, receive, and automate iMessages from your n8n workflows. No self-hosted Mac, no API key, no server URL.

## What you get

- **Action node — `iMessage by Photon`**: text, attachments, voice notes, rich links, group albums, reactions (built-in tapbacks **or any custom emoji**), threaded replies (text and/or attachment), edits, contact cards, polls, chat backgrounds, screen/bubble effects, message lookup, custom platform payloads, user resolution, and a typing-wrapped "send with typing indicator" helper.
- **Trigger node — `iMessage by Photon Trigger`**: real-time inbound events via Spectrum-managed webhooks with HMAC-SHA256 verification. Webhook registration and tear-down happen automatically when you activate / deactivate the workflow.
- **Full `spectrum-ts` outbound stack** (no proprietary HTTP shims) inlined into the published artifact — n8n installs zero extra runtime dependencies.
- **Inbound-first policy** on by default, gating outbound to contacts who have written to your project at least once, matching Photon's [iMessage deliverability guidance](https://docs.photon.codes/best-practices/imessage-deliverability).

## Prerequisites

A Photon project. Sign up at [app.photon.codes](https://app.photon.codes) and create one — that's the whole onboarding.

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/):

```bash
npm install n8n-nodes-imessage
```

## Credentials

Create a **Photon iMessage** credential in n8n. Most users only use browser sign-in; Project ID and Secret are under **Troubleshooting** if you need them.

### Sign in with Photon (default)

1. Click **Save** on a new credential.
2. On the next screen, open **Approval Link**, confirm **Approval Code** in the browser.
3. Click **Retry** at the top of the panel (not Save again).
4. **Your iMessage Line** appears when Spectrum has assigned a number.

Optional: add **Your Mobile (E.164)** before the first Save on shared plans so your line is provisioned on the first Retry.

**Projects:** we bind to an existing Photon project when possible (`n8n…` name, single Spectrum project, or the project from a previous connect). Enable **Show Project Options → Create project if none exists** only if your account has zero projects and you want one created automatically.

> Browser sign-in rotates the project secret. Update any other tools that still use the old secret.

### Troubleshooting: Project ID & Secret

Enable **Troubleshooting: Use Project ID & Secret**, paste values from [app.photon.codes](https://app.photon.codes) → Settings, then **Save**. For CI or when device sign-in is unavailable.

### Terminal login

```bash
npx n8n-nodes-imessage login
```

Paste the printed credentials under **Troubleshooting**. Flags: `--api-host`, `--project`, `--no-browser`, `--json`.

### After you are connected

| Field | Description |
|---|---|
| Your iMessage Line | Number people text to trigger workflows. |
| Your Mobile (E.164) | Shared plans — assign or refresh your line, then Retry. |
| Pre-Approved Recipients | Optional outbound allowlist before first inbound. |
| Show Technical Details | Reveals Project ID for dashboard support. |

## Action node

The node exposes five resources. Pick a resource, then an operation. Every outbound operation goes through the [`spectrum-ts`](https://docs.photon.codes/spectrum-ts/providers/imessage) SDK.

### Message

| Operation | What it does |
|---|---|
| **Send Message** | Text + optional [iMessage effect](https://docs.photon.codes/spectrum-ts/providers/imessage#message-effects) (4 bubble effects, 9 screen effects). |
| **Send Attachment** | File from a path or n8n binary input. MIME type auto-detected; override available. |
| **Send Voice Note** | Audio file rendered as an iMessage voice bubble (with optional duration for waveform UI). |
| **Send Rich Link** | URL rendered as a rich card with auto-fetched Open Graph metadata. |
| **Send Group (Album)** | Bundle multiple attachments and/or text into one logical unit. |
| **Send Custom Payload** | Raw provider-specific JSON forwarded through Spectrum's `custom()` builder. Advanced — iMessage gracefully no-ops unsupported variants. |
| **Reply to Message** | Threaded reply to a target message ID (e.g. from the Trigger payload). Optional text + optional attachment (path or binary). |
| **React to Message** | Built-in tapback (love / like / dislike / laugh / emphasize / question) **or** any custom emoji / string. |
| **Edit Message** | Edit the text of a previously-sent message you own. |
| **Get Message** | Look up a message by ID in a space. Returns content type, text, sender, timestamp, direction. |

### Space

| Operation | What it does |
|---|---|
| **Create / Resolve Space** | Resolve recipients into a Space. One address → DM, multiple → group. Returns a `spaceId` you can reuse downstream. |
| **Send With Typing** | Show the typing indicator, wait a configurable delay, then send a text. Uses Spectrum's `space.responding(fn)` so the indicator always clears, even on error. |
| **Set Background** | Set the chat's background image from a path, n8n binary, or clear it. |
| **Start Typing** | Show the typing indicator. |
| **Stop Typing** | Hide the typing indicator. |

### Poll

| Operation | What it does |
|---|---|
| **Create Poll** | Send an interactive poll. Votes arrive on the Trigger as `contentType: "poll_option"`. |

> Casting votes programmatically isn't a `spectrum-ts` capability today — `poll_option` content is inbound-only on the SDK. Poll voting requires the low-level [Advanced iMessage Kit](https://docs.photon.codes/advanced-kits/imessage/polls), which is intentionally out of scope for this node.

### Contact

| Operation | What it does |
|---|---|
| **Share Contact Card** | Send a structured contact (first/last/phones/emails/org) or a vCard string. |

### User

| Operation | What it does |
|---|---|
| **Resolve User** | Resolve a phone/email into a Spectrum `User` reference. Useful as a probe step before a downstream send. |

### Dedicated lines

On Business plans with dedicated phone lines, every operation that touches a Space has an optional **Send From Phone** field that pins the conversation to a specific line. Leave blank on shared-pool plans — Spectrum routes automatically.

## Trigger node

When you activate the Trigger, n8n calls Spectrum to register the node's webhook URL and store a fresh 64-char signing secret. Spectrum signs each delivery with HMAC-SHA256; verification is built in.

Filters:

- **Content Types**: pick any of `*`, `text`, `photo`, `voice`, `video`, `document`, `attachment-other`, plus forward-compat slots (`reaction`, `reply`, `edit`, `richlink`, `poll`, `poll_option`, `contact`, `group`, `custom`). Spectrum currently delivers `text` and `attachment` over webhooks; the remaining slots are reserved per [their docs](https://docs.photon.codes/webhooks/events) and will route automatically once Spectrum starts emitting them.
- **Sender Address**: trigger only for a specific phone/email.
- **Space Type**: DM only, group only, or any.
- **Space ID**: pin to one exact conversation.

Output for `event: messages`:

| Field | Type |
|---|---|
| `event` | `"messages"` |
| `messageId` | `string` — stable, dedup-safe |
| `webhookId` | `string` — from `X-Spectrum-Webhook-Id` |
| `platform` | `"iMessage"` |
| `direction` | `"inbound"` |
| `spaceId` | `string` |
| `spaceType` | `"dm" \| "group" \| null` — inferred from the space ID shape |
| `sender` | `string` (E.164 phone or email) |
| `senderPlatform` | `string` — platform the sender belongs to |
| `timestamp` | ISO 8601 |
| `contentType` | One of `text`, `attachment`, `voice`, `reaction`, `reply`, `edit`, `richlink`, `poll`, `poll_option`, `contact`, `group`, `custom` |
| `attachmentKind` | `"photo" \| "voice" \| "video" \| "document" \| "attachment-other"` (when applicable) |
| `text` | Present for `text` |
| `attachment` | `{ kind, name, mimeType, size }` for any attachment (photo / voice / video / document / other) |
| `reaction` | `{ emoji, targetId }` for reactions |
| `reply` | `{ targetId, innerType }` for threaded replies |
| `edit` | `{ targetId, innerType }` for edits |
| `richlink` | `{ url }` for rich link previews |
| `poll` | `{ title, options }` for new polls |
| `pollVote` | `{ selected, title, pollId }` for votes |
| `contact` | `{ name, phones, emails, org }` for shared contact cards |
| `group` | `{ itemCount }` for grouped bundles |
| `custom` | Raw provider-defined payload |
| `raw` | Full Spectrum payload (always present for debugging) |

Every inbound sender is also written into a shared allowlist that the action node reads to enforce the inbound-first policy — once a contact writes to the project, outbound to that address unlocks automatically.

## Inbound-first policy

Per Photon's [iMessage deliverability docs](https://docs.photon.codes/best-practices/imessage-deliverability), Apple filters iMessage lines on behaviour. Lines that cold-send get flagged; lines that respond to inbound traffic stay healthy. There is no soft-deliverability dial — get this wrong once and the line is burnt.

The node enforces inbound-first unconditionally. Every outbound operation (send, react, reply, attachment, voice, rich link, group, contact, poll, typing, background) requires the recipient to have either messaged your line at least once, or to be on the **Pre-Approved Recipients** allowlist on the credential. Once a contact writes to your line, the trigger node records them automatically and they unlock for outbound forever after.

There is no "off" switch by design — letting it be one would be a foot-gun that ends with a flagged line.

## Deep links

For "tap to message" CTAs on a landing page or email, Spectrum exposes a public deep-link redirect that hands the user off to Messages with a draft already populated:

```text
https://spectrum.photon.codes/users/{userId}/redirect?msg=Hi%20there
```

It returns `302` with a `sms:` URL targeted at the user's assigned line, so the receiving phone opens straight into the conversation. Useful outside n8n — not an operation on the node itself.

## Resources

- [Spectrum iMessage provider docs](https://docs.photon.codes/spectrum-ts/providers/imessage)
- [iMessage deliverability guidance](https://docs.photon.codes/best-practices/imessage-deliverability)
- [Architecture best practices](https://docs.photon.codes/best-practices/architecture)
- [`spectrum-ts` on GitHub](https://github.com/photon-hq/spectrum-ts)

## License

[MIT](LICENSE)
