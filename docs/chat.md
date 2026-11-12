# Job chat

Chat rooms are created automatically when a technician accepts a job offer.
Each assignment gets a separate room, so a later technician cannot access a
previous assignment's conversation. Existing active assignments receive a room
when the chat migration is applied.

All REST routes use `{{baseUrl}}/api/v1`. Member routes accept a customer or
technician bearer token, but the account must be a participant in that room.
Admin routes require an admin session cookie or administrator bearer token.

## Member room and message endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| GET | `/chat/rooms` | List the signed-in member's unarchived rooms |
| GET | `/chat/rooms/{{chatRoomId}}` | Read room/job details |
| GET | `/chat/rooms/{{chatRoomId}}/messages?limit=50` | List messages; older-page requests may include `beforeMessageId` |
| POST | `/chat/rooms/{{chatRoomId}}/messages` | Send a text message |
| POST | `/chat/rooms/{{chatRoomId}}/messages/media` | Send a voice note, image, document, or short video |
| GET | `/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}/media` | Download a message attachment |
| POST | `/chat/rooms/{{chatRoomId}}/read` | Mark messages through a message ID as read |
| PATCH | `/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}` | Edit the sender's unread text message |
| DELETE | `/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}` | Delete/tombstone the sender's unread message |
| DELETE | `/chat/rooms/{{chatRoomId}}` | Archive this room for the member after the job is terminal |

### Send text

**POST** `{{baseUrl}}/api/v1/chat/rooms/{{chatRoomId}}/messages`

```json
{
  "text": "I can come by at 10:00 tomorrow."
}
```

Text is limited to 4,000 characters. Members cannot send when their room is
disabled, their membership is blocked, or the job is no longer active.

### Send an attachment

**POST** `{{baseUrl}}/api/v1/chat/rooms/{{chatRoomId}}/messages/media`

In Postman, choose **Body → form-data** and add:

| Key | Type | Example |
| --- | --- | --- |
| `type` | Text | `IMAGE` |
| `file` | File | Select a local file |
| `durationSeconds` | Text (optional) | `90` for a voice note |

Allowed types and limits:

- Images: 10 MiB.
- PDF, DOC, or DOCX files: 20 MiB.
- Voice notes: 20 MiB and at most 5 minutes. Supply `durationSeconds` for
  voice notes.
- MP4 or WebM videos: 50 MiB and at most 60 seconds. Duration is checked from
  the media container.

The server checks file signatures and MIME/extension consistency. Attachment
content is stored in private object storage; use the authenticated download
endpoint rather than exposing storage URLs.

### Mark messages read

**POST** `{{baseUrl}}/api/v1/chat/rooms/{{chatRoomId}}/read`

```json
{
  "messageId": "{{chatMessageId}}"
}
```

This records a read receipt for messages up to the selected message. An
administrator inspecting a conversation does not create member read receipts.

### Edit or delete a message

Edit an unread text message with **PATCH**
`{{baseUrl}}/api/v1/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}`:

```json
{
  "text": "Updated: I can come by at 11:00 tomorrow."
}
```

Use **DELETE**
`{{baseUrl}}/api/v1/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}` to
remove an unread message. Once the other member has read it, member edit/delete
is unavailable. Deletion leaves a tombstone in the conversation.

## Job actions from the room

These endpoints reuse the existing job lifecycle and payment rules:

| Method | URL | Body |
| --- | --- | --- |
| POST | `/chat/rooms/{{chatRoomId}}/cooperation/confirm` | None |
| POST | `/chat/rooms/{{chatRoomId}}/cooperation/deny` | `{"reason":"We could not agree on the terms."}` |
| POST | `/chat/rooms/{{chatRoomId}}/cancel` | `{"reason":"The customer no longer needs the repair."}` |
| PATCH | `/chat/rooms/{{chatRoomId}}/progress` | `{"status":"COMPLETED"}` |
| POST | `/chat/rooms/{{chatRoomId}}/pause` | None |
| POST | `/chat/rooms/{{chatRoomId}}/resume` | None |

Both job participants must confirm cooperation before the job/payment follows
the agreed confirmed flow. A pre-confirmation denial releases the assignment;
normal jobs return for reassignment and SOS jobs resume dispatch. The room is
disabled when the assignment ends. Once both participants confirm job
completion, the room is completed and members can no longer send messages.

## Administrator moderation

Admin requests use the `/api/v1/admin/chat/rooms` prefix:

| Method | URL | Purpose |
| --- | --- | --- |
| GET | `/admin/chat/rooms` | List rooms |
| GET | `/admin/chat/rooms/{{chatRoomId}}` | Inspect room details |
| GET | `/admin/chat/rooms/{{chatRoomId}}/messages?limit=50` | Inspect messages without marking them read |
| POST | `/admin/chat/rooms/{{chatRoomId}}/messages` | Send an administrative text message |
| POST | `/admin/chat/rooms/{{chatRoomId}}/messages/media` | Send an attachment |
| GET | `/admin/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}/media` | Download an attachment |
| PATCH | `/admin/chat/rooms/{{chatRoomId}}/status` | Disable or enable a room |
| PATCH | `/admin/chat/rooms/{{chatRoomId}}/members/{{userId}}` | Block/unblock a member |
| PATCH | `/admin/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}/block` | Block/unblock a message |
| DELETE | `/admin/chat/rooms/{{chatRoomId}}/messages/{{chatMessageId}}` | Permanently delete a message |

Example administrative room disable request:

```json
{
  "disabled": true,
  "reason": "Under review"
}
```

Member block/unblock and message block/unblock use `{"blocked":true,"reason":"..."}`.
Admins may send to disabled rooms. A completed room cannot be re-enabled.
Administrative message deletion and moderation are audited.

## Realtime Socket.IO

Connect to the Socket.IO namespace `{{baseUrl}}/chat` with the same access
token:

```javascript
const socket = io(`${baseUrl}/chat`, {
  auth: { accessToken }
});
```

Client events:

| Event | Payload |
| --- | --- |
| `chat:join` | `{"roomId":"{{chatRoomId}}"}` |
| `chat:leave` | `{"roomId":"{{chatRoomId}}"}` |
| `chat:message:send` | `{"roomId":"{{chatRoomId}}","text":"Hello"}` |
| `chat:message:read` | `{"roomId":"{{chatRoomId}}","messageId":"{{chatMessageId}}"}` |
| `chat:typing` | `{"roomId":"{{chatRoomId}}","active":true}` |

The server emits `chat:message:new`, `chat:message:updated`,
`chat:message:deleted`, `chat:message:read`, `chat:message:moderated`,
`chat:member:moderated`, `chat:room:updated`, `chat:job:updated`, and
`chat:typing` to room members. A blocked or archived member's connected
sockets are removed from the room. Upload attachments over REST; only message
metadata is broadcast over Socket.IO. Redis is used by the Socket.IO adapter to
distribute events across API instances.
