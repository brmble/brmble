// Utility functions for generating Matrix reply fallbacks

import { MsgType } from 'matrix-js-sdk';

export function stripReplyFallback(body: string): string {
  return body.split('\n').filter(line => !/^> ?/.test(line)).join('\n').trim();
}

/**
 * Generate plain text fallback for a reply
 * Format: "> <sender> first line\n> subsequent lines\n\nreply text"
 */
export function makeReplyFallback(parent: { sender: string; body: string }, replyText: string): string {
  const cleanBody = stripReplyFallback(parent.body);
  const lines = cleanBody.split('\n');
  let fallback = `> <${parent.sender}> ${lines[0]}`;
  for (let i = 1; i < lines.length; ++i) {
    fallback += `\n> ${lines[i]}`;
  }
  return fallback + '\n\n' + replyText;
}

/**
 * Generate HTML fallback for a reply with proper <mx-reply> wrapper
 */
export function makeReplyHtml(
  roomId: string,
  parentEventId: string,
  sender: string,
  senderMatrixUserId: string,
  body: string
): string {
  const senderId = senderMatrixUserId || `@${sender}:unknown`;
  const parentLink = `https://matrix.to/#/${roomId}/${parentEventId}`;
  const senderLink = `https://matrix.to/#/${senderId}`;
  
  // Strip any existing reply fallbacks from body for the preview
  const cleanBody = stripReplyFallback(body);
  // Truncate long content in preview
  const truncatedBody = cleanBody.length > 150 ? cleanBody.slice(0, 150).trim() + '...' : cleanBody;
  
  return `<mx-reply><a href="${parentLink}">In reply to</a><blockquote><a href="${senderLink}">${senderId}</a>${truncatedBody}</blockquote></mx-reply>`;
}

/**
 * Build complete Matrix reply content object
 */
export function buildReplyContent(
  roomId: string,
  parentEventId: string,
  parentSender: string,
  parentSenderMatrixId: string | undefined,
  parentBody: string,
  replyText: string
) {
  const senderId = parentSenderMatrixId || `@${parentSender}:unknown`;
  
  return {
    msgtype: MsgType.Text,
    body: makeReplyFallback({ sender: senderId, body: parentBody }, replyText),
    format: 'org.matrix.custom.html',
    formatted_body: makeReplyHtml(roomId, parentEventId, parentSender, senderId, parentBody) + replyText,
    'm.relates_to': {
      'm.in_reply_to': {
        event_id: parentEventId,
      },
    },
  } as const;
}