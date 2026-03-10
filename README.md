# n8n-nodes-imessage

This is an n8n community node for [Photon iMessage](https://github.com/photon-hq/advanced-imessage-kit). It lets you send, receive, search, and automate iMessage conversations directly from your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Prerequisites

You need a running **Photon iMessage server** on a Mac. The server exposes a REST API that this node communicates with over HTTP.

- Install and run the [advanced-imessage-kit](https://github.com/photon-hq/advanced-imessage-kit) server on your Mac
- Note your **Server URL** (e.g. `https://your-server.example.com`) and **API Key**

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) to install `n8n-nodes-imessage` in your n8n instance.

## Credentials

1. In n8n, go to **Credentials** and create a new **Photon iMessage API** credential
2. Enter your **Server URL** — the base URL of your Photon server (no trailing slash)
3. Enter your **API Key** — the key is sent as an `X-API-Key` header on every request
4. Click **Test** to verify the connection (calls `GET /api/v1/server/info`)

## Nodes

### Photon iMessage (Action Node)

Perform operations on your iMessage account.

#### Message

| Operation | Description |
|-----------|-------------|
| **Send Message** | Send a text message to a chat. Supports reply-to, message effects (confetti, fireworks, etc.), and subject lines. |
| **Send Attachment** | Send a file from the server Mac to a chat. Supports voice messages. |
| **React to Message** | Send a tapback reaction (love, like, dislike, laugh, emphasize, question). |
| **Search Messages** | Search messages by text content across all chats or a specific chat. |
| **Get Messages** | Retrieve messages from a chat with date range and sort options. |

#### Chat

| Operation | Description |
|-----------|-------------|
| **List Chats** | List all conversations with optional last message preview. |
| **Create Chat** | Start a new conversation with one or more participants. |
| **Mark Chat Read** | Mark all messages in a chat as read. |

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

The trigger polls for new messages and automatically deduplicates using message GUIDs.

## Chat GUID Format

The Chat GUID identifies a conversation:

- **iMessage DM**: `iMessage;-;+1234567890` or `iMessage;-;email@example.com`
- **SMS DM**: `SMS;-;+1234567890`
- **Group chat**: `iMessage;+;chat123456789`

## Resources

- [Photon advanced-imessage-kit](https://github.com/photon-hq/advanced-imessage-kit) — The iMessage server SDK
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
