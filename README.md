# n8n-nodes-imessage

[![npm version](https://img.shields.io/npm/v/n8n-nodes-imessage.svg)](https://www.npmjs.com/package/n8n-nodes-imessage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

n8n community node for **iMessage by Photon**, built on [Spectrum](https://github.com/photon-hq/spectrum-ts) — Photon's managed iMessage runtime. Send, receive, and automate iMessages from your n8n workflows. No self-hosted Mac, no API key, no server URL.

## What you get

- **Action node — `iMessage by Photon`**: text, attachments, voice notes, rich links, group albums, reactions, threaded replies, edits, contact cards, polls, chat backgrounds, and screen/bubble effects.
- **Trigger node — `iMessage by Photon Trigger`**: real-time inbound events via Spectrum-managed webhooks with HMAC-SHA256 verification. Webhook registration and tear-down happen automatically when you activate / deactivate the workflow.
- **Inbound-first policy** on by default, gating outbound to contacts who have written to your project at least once, matching Photon's [iMessage deliverability guidance](https://docs.photon.codes/best-practices/imessage-deliverability).

## Prerequisites

A Photon project. Sign up at [app.photon.codes](https://app.photon.codes) and create one — that's the whole onboarding.

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/):

```
npm install n8n-nodes-imessage
```

## Credentials

Create a new **iMessage by Photon (Spectrum) API** credential in n8n. Three ways to sign in, all driven by the same form.

### Browser login (recommended)

1. Open the credential form.
2. Leave **Project ID** and **Project Secret** blank and click **Save**. n8n shows *Connection successful* and a one-step approval notice appears in the form, with a clickable link and a verification code.
3. Open the link, sign in to Photon, confirm the code on the approval page matches.
4. Click **Save** again. The credential mints a fresh project secret, hides the notice, and tests against the live Spectrum endpoint.

Two clicks, no leaving the credential dialog. The bearer is stored as an expirable hidden field and n8n silently refreshes the project secret as needed.

> The first browser approval rotates the project secret. If you have other tools using the old secret, update them too.

### Terminal login

For air-gapped n8n instances:

```bash
npx n8n-nodes-imessage login
```

Opens a browser, you approve, prints a `Project ID` + `Project Secret` you paste into the n8n form. Flags: `--api-host`, `--project`, `--no-browser`, `--json`.

### Manual

Open [app.photon.codes](https://app.photon.codes) → project → **Settings** → copy `Project ID` and `Project Secret`. Paste, **Save**.

### Fields

| Field | Description |
|---|---|
| Project ID | Auto-filled by browser login. Set manually only if you own multiple projects and want this credential bound to one of them. |
| Project Secret | Auto-minted by browser login. Paste manually only if you already have one. |
| Spectrum Runtime URL | `https://spectrum.photon.codes`. Override only for staging or self-hosted runtimes. |
| Inbound-First Policy | `Strict` (default, recommended) or `Off`. Strict blocks outbound to contacts who haven't messaged the project yet. |
| Pre-Approved Recipients | Optional comma-separated bootstrap list (E.164 phones or emails) that bypasses strict mode. |
| Dashboard URL *(advanced)* | `https://app.photon.codes`. Override for staging Photon. |
| OAuth Client ID *(advanced)* | `photon-cli`. Only change if instructed. |

## Action node

The node exposes four resources. Pick a resource, then an operation.

### Message

| Operation | What it does |
|---|---|
| **Send Message** | Text + optional [iMessage effect](https://docs.photon.codes/spectrum-ts/providers/imessage#message-effects) (bubble or screen). |
| **Send Attachment** | File from a path or n8n binary input. MIME type auto-detected. |
| **Send Voice Note** | Audio file rendered as an iMessage voice bubble (with optional duration for waveform UI). |
| **Send Rich Link** | URL rendered as a rich card with auto-fetched Open Graph metadata. |
| **Send Group (Album)** | Bundle multiple attachments and/or text into one message. |
| **Reply to Message** | Threaded reply to a target message ID (e.g. from the Trigger payload). |
| **React to Message** | Tapback: love, like, dislike, laugh, emphasize, question. |
| **Edit Message** | Edit the text of a previously-sent message you own. |

### Space

| Operation | What it does |
|---|---|
| **Create / Resolve Space** | Resolve recipients into a Space. One address → DM, multiple → group. Returns a `spaceId` you can reuse downstream. |
| **Set Background** | Set the chat's background image from a path, n8n binary, or clear it. |
| **Start Typing** | Show the typing indicator. |
| **Stop Typing** | Hide the typing indicator. |

### Poll

| Operation | What it does |
|---|---|
| **Create Poll** | Send an interactive poll. Votes arrive on the Trigger as `contentType: "poll_option"`. |

### Contact

| Operation | What it does |
|---|---|
| **Share Contact Card** | Send a structured contact (first/last/phones/emails/org) or a vCard string. |

### Dedicated lines

On Business plans with dedicated phone lines, every operation has an optional **Send From Phone** field that pins the conversation to a specific line. Leave blank on shared-pool plans — Spectrum routes automatically.

## Trigger node

When you activate the Trigger, n8n calls Spectrum to register the node's webhook URL and store a fresh 64-char signing secret. Spectrum signs each delivery with HMAC-SHA256; verification is built in.

Filters:

- **Content Types**: `text`, `attachment`, `voice`, `reaction`, `reply`, `poll`, `poll_option`, `contact`, `richlink`, or `*` for all.
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
| `spaceId` | `string` |
| `sender` | `string` (E.164 phone or email) |
| `timestamp` | ISO 8601 |
| `contentType` | `"text" \| "attachment" \| "voice" \| "reaction" \| ...` |
| `text` | present for text |
| `attachment` | `{ name, mimeType, size }` for attachment / voice |
| `reaction` | `{ emoji, targetId }` for reactions |
| `pollVote` | `{ selected, title }` for poll votes |
| `raw` | full Spectrum payload |

Every inbound sender is also written into a shared allowlist that the action node reads to enforce the inbound-first policy — once a contact writes to the project, outbound to that address unlocks automatically.

## Inbound-first policy

Per Photon's [iMessage deliverability docs](https://docs.photon.codes/best-practices/imessage-deliverability), Apple filters iMessage lines on behaviour, and inbound-first integrations never surface the "Report Junk" banner.

The node defaults to **strict inbound-first**: outbound operations (send, react, reply, attachment, voice, rich link, group, contact, poll, typing, background) require the recipient to have messaged the project at least once.

Bypass paths:

- **Pre-Approved Recipients** field on the credential — comma-separated phones/emails that skip the check (useful for bootstrapping existing contacts).
- Set **Inbound-First Policy** to `Off` (not recommended — Apple may flag the line).

## Resources

- [Spectrum iMessage provider docs](https://docs.photon.codes/spectrum-ts/providers/imessage)
- [iMessage deliverability guidance](https://docs.photon.codes/best-practices/imessage-deliverability)
- [Architecture best practices](https://docs.photon.codes/best-practices/architecture)
- [`spectrum-ts` on GitHub](https://github.com/photon-hq/spectrum-ts)

## License

[MIT](LICENSE)
