# n8n-nodes-imessage

[![npm version](https://img.shields.io/npm/v/n8n-nodes-imessage.svg)](https://www.npmjs.com/package/n8n-nodes-imessage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This is an n8n community node for [Photon iMessage](https://github.com/photon-hq/advanced-imessage-kit). It lets you send, receive, search, and automate iMessage conversations directly from your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Prerequisites

Photon hosts the iMessage server for you — no self-hosting required.

1. Visit [photon.codes](https://photon.codes) to create an account
2. Get your **Server URL** and **API Key** from the Photon dashboard

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) to install `n8n-nodes-imessage` in your n8n instance.

```
npm install n8n-nodes-imessage
```

## Credentials

1. In n8n, go to **Credentials** and create a new **Photon iMessage API** credential
2. Enter your **Server URL** — from your [Photon dashboard](https://photon.codes) (no trailing slash)
3. Enter your **API Key** — from your [Photon dashboard](https://photon.codes), sent as an `X-API-Key` header on every request
4. Click **Test** to verify the connection

## Nodes

### Photon iMessage (Action Node)

Perform operations on your iMessage account.

#### Message

| Operation | Description |
|-----------|-------------|
| **Send Message** | Send a text message to a chat. Supports reply-to, message effects (confetti, fireworks, etc.), and subject lines. |
| **Send Attachment** | Send a file from the server Mac to a chat. Supports voice messages. |
| **Unsend Message** | Retract a sent message. |
| **Edit Message** | Edit the text of a sent message. |
| **React to Message** | Send a tapback reaction (love, like, dislike, laugh, emphasize, question). |
| **Download Attachment** | Download a received file or media attachment. |
| **Search Messages** | Search messages by text content across all chats or a specific chat. |
| **Get Messages** | Retrieve messages from a chat with date range and sort options. |

#### Chat

| Operation | Description |
|-----------|-------------|
| **List Chats** | List all conversations with optional last message preview. |
| **Create Chat** | Start a new conversation with one or more participants. |
| **Mark Chat Read** | Mark all messages in a chat as read. |
| **Start Typing** | Show the typing indicator in a chat. |
| **Stop Typing** | Hide the typing indicator in a chat. |

#### Contact

| Operation | Description |
|-----------|-------------|
| **Share Contact Card** | Share your Name and Photo contact card in a chat. |

#### Poll

| Operation | Description |
|-----------|-------------|
| **Create Poll** | Create an interactive poll in a chat. |
| **Vote** | Vote on a poll option. |
| **Unvote** | Remove your vote from a poll option. |
| **Add Option** | Add a new option to an existing poll. |

#### Scheduled Message

| Operation | Description |
|-----------|-------------|
| **Create Scheduled Message** | Schedule a message to send later. Supports one-time and recurring schedules (hourly, daily, weekly, monthly, yearly). |
| **List Scheduled Messages** | View all pending scheduled messages. |
| **Delete Scheduled Message** | Remove a scheduled message. |

#### Handle

| Operation | Description |
|-----------|-------------|
| **Check iMessage Availability** | Check if a phone number or email address supports iMessage. |

### Photon iMessage Trigger (Polling Trigger)

Triggers your workflow when new iMessages are received.

| Parameter | Description |
|-----------|-------------|
| **Chat GUID** | Only trigger for messages in a specific chat (leave blank for all). |
| **Include Sent Messages** | Also trigger for messages you sent (default: off). |
| **Max Messages Per Poll** | Maximum number of messages to fetch per poll interval (default: 100). |

The trigger polls for new messages and tracks the last message timestamp to avoid duplicates.

## Chat GUID Format

The Chat GUID identifies a conversation:

- **iMessage DM**: `iMessage;-;+1234567890` or `iMessage;-;email@example.com`
- **SMS DM**: `SMS;-;+1234567890`
- **Group chat**: `iMessage;+;chat123456789`

## Resources

- [Photon](https://photon.codes) — Get your API key and server URL
- [Photon advanced-imessage-kit](https://github.com/photon-hq/advanced-imessage-kit) — The iMessage SDK
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
