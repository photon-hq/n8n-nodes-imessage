# n8n-nodes-imessage

[![npm version](https://img.shields.io/npm/v/n8n-nodes-imessage.svg)](https://www.npmjs.com/package/n8n-nodes-imessage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

n8n community node for **iMessage by Photon**, built on [Spectrum](https://github.com/photon-hq/spectrum-ts) — Photon's managed iMessage runtime. Send, receive, and automate iMessages from your n8n workflows. No self-hosted Mac, no API key, no server URL.

## What you get

- **Action node — `iMessage by Photon`**: text, attachments, voice notes, rich links, group albums, reactions (built-in tapbacks **or any custom emoji**), threaded replies (text and/or attachment), edits, contact cards, polls, chat backgrounds, screen/bubble effects, message lookup, custom platform payloads, user resolution, and a typing-wrapped "send with typing indicator" helper.
- **Trigger node — `iMessage by Photon Trigger`**: real-time inbound events via Spectrum-managed webhooks with HMAC-SHA256 verification. Webhook registration and tear-down happen automatically when you activate / deactivate the workflow.
- **Full `spectrum-ts` outbound stack** (no proprietary HTTP shims) inlined into the published artifact — n8n installs zero extra runtime dependencies.
- **Deliverability error logging** when Spectrum rejects outbound — execution logs show the rejection reason with a link to Photon's [iMessage deliverability guidance](https://docs.photon.codes/best-practices/imessage-deliverability).

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

Two steps:

1. Enter **Your iPhone Number** (E.164, e.g. `+14155550123`) and click **Save**.
2. Open the **Sign-in link**, approve in your browser, then click **Save** again. If the link is blank, close and reopen the credential panel once.

**Your iMessage Line** appears when connected. On the second Save, n8n waits up to ~25 seconds for browser approval.

**Next:** add **iMessage by Photon Trigger** → toggle the workflow **Active** → iMessage your assigned line from your iPhone.

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
| Your Mobile (E.164) | Shared plans — assign or refresh your line, then Save. |
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
| **Create Poll** | Send an interactive poll in a conversation. |
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

### Webhook URL: Cloud vs self-hosted

Spectrum runs in the cloud and **cannot POST to `localhost`**. The webhook URL n8n registers must be reachable from the internet.

| Deployment | What to do |
|---|---|
| **n8n Cloud** | Nothing — n8n uses your cloud instance URL automatically. Toggle the workflow **Active**. |
| **Self-hosted (local machine)** | Expose n8n with a public HTTPS URL before activating the trigger. |
| **Self-hosted (server with public domain)** | Set `WEBHOOK_URL=https://your-domain` when starting n8n. |

**Local development** (recommended):

```bash
# From this repo — starts ngrok, sets WEBHOOK_URL, runs n8n-node dev
npm run dev:tunnel
```

Or manually:

```bash
ngrok http 5678
# Then start n8n with:
WEBHOOK_URL=https://YOUR-SUBDOMAIN.ngrok-free.app n8n start
```

After the tunnel or `WEBHOOK_URL` is in place, toggle the workflow **Active** (or **Test this trigger**). If you restart ngrok, toggle Active off/on so Spectrum gets the new URL.

Spectrum webhooks deliver inbound **text** and **attachment** messages only. See the [webhook events spec](https://docs.photon.codes/webhooks/events).

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
| `senderPlatform` | `string` |
| `timestamp` | ISO 8601 |
| `contentType` | `"text"` or `"attachment"` |
| `attachmentKind` | `"photo" \| "voice" \| "video" \| "document" \| "attachment-other"` when `contentType` is `attachment` |
| `text` | Message body when `contentType` is `text` |
| `attachment` | `{ kind, name, mimeType, size }` when `contentType` is `attachment` (metadata only — no file bytes) |
| `raw` | Full Spectrum payload |

Unsupported webhook events or message content types fail the trigger with an error instead of passing data through.

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
