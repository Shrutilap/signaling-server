import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { clientManager } from './clientManager';
import { callRoutingService } from '../routing/CallRoutingService';
import { urgencyDetector } from '../routing/urgencyDetector';
import { transcriptLogger } from '../transcription/transcriptLogger';
import { CallSession, WebSocketMessage } from '../models/types';
import pino from 'pino';
import { config } from '../config';
import { sendPushNotification } from '../services/firebaseService';
import PermissionService from '../services/PermissionService';

import UpdatesService from '../services/UpdatesService';
import ConversationService from '../services/ConversationService';
import WhisperTranscriptionService from '../services/WhisperTranscriptionService';

const logger = pino({ level: config.logLevel });

/**
 * Reusable function to ring a user with an incoming call
 * Can be called from WebSocket handlers or HTTP endpoints
 */
export async function ringUser(
    recipientId: string,
    callerId: string,
    callId: string,
    callerName: string
): Promise<{ success: boolean; reason?: string }> {
    logger.info({ callerId, recipientId, callId }, 'Attempting to ring user');

    // Check directory first (includes both online and offline users)
    const recipient = clientManager.getUserFromDirectory(recipientId);
    if (!recipient) {
        logger.warn({ recipientId }, 'Recipient not found');
        return { success: false, reason: 'User not found' };
    }

    // Send socket event if user is online, otherwise it will be buffered by sendToClient
    const message: WebSocketMessage = {
        type: 'incoming-call',
        payload: { from: callerId, callId, callerName }
    };

    let socketMessageSent = false;
    // clientManager.sendToClient will handle if the user is truly connected or needs buffering
    socketMessageSent = clientManager.sendToClient(recipientId, message);

    if (socketMessageSent) {
        logger.info({ recipientId, status: recipient.isOnline ? 'online' : 'buffered' }, 'Sent socket notification (or buffered)');
    } else {
        // This case should ideally not happen if user exists in directory and sendToClient handles buffering.
        // It would mean user not found at all, which is already handled by !recipient check.
        logger.warn({ recipientId }, 'Failed to send socket notification or buffer message (user not in directory).');
    }

    // Always send FCM push notification (works for both online and offline)
    if (recipient.fcmToken) {
        try {
            await sendPushNotification(recipient.fcmToken, callerId, callerName, callId);
            logger.info({ recipientId, status: recipient.isOnline ? 'online' : 'offline' }, 'Sent push notification');
        } catch (error) {
            logger.error({ error }, 'Failed to send FCM notification');
        }
    } else if (!socketMessageSent) {
        // User is offline and has no FCM token and no socket message could be sent/buffered
        logger.warn({ recipientId }, 'User is offline and unreachable (no FCM, no active socket, no buffer possible)');
        return { success: false, reason: 'User is offline and unreachable' };
    }

    return { success: true };
}

/**
 * Ring a specific web user
 */
export async function ringWebUser(
    recipientId: string,
    callerId: string,
    callId: string,
    callerName: string
): Promise<{ success: boolean; reason?: string }> {
    logger.info({ callerId, recipientId, callId }, 'Attempting to ring WEB user');

    const webRecipient = clientManager.getWebUser(recipientId);

    if (!webRecipient) {
        logger.warn({ recipientId }, 'Web recipient not found');
        return { success: false, reason: 'Web user not found or offline' };
    }

    const message: WebSocketMessage = {
        type: 'incoming-call',
        payload: { from: callerId, callId, callerName }
    };

    // Use sendToClient, which will buffer if the web user is temporarily disconnected but known.
    const sentOrBuffered = clientManager.sendToClient(recipientId, message);

    if (sentOrBuffered) {
        logger.info({ recipientId, status: webRecipient.socket ? 'online' : 'buffered' }, 'Sent socket notification to WEB client (or buffered)');
        return { success: true };
    } else {
        // This path should ideally be unreachable if webRecipient check passes, as sendToClient buffers for known users.
        logger.warn({ recipientId }, 'Web socket not available or message not buffered (user not in directory).');
        return { success: false, reason: 'Web socket not available or message not buffered' };
    }
}

export async function initiateWebCall(
    socket: any, // The caller's socket (used for `from` for sending back failures)
    data: { to: string; from: string; callId: string; callerName: string }
) {
    const { to, from, callId, callerName } = data;
    logger.info({ from, to, callId }, 'Web call initiated via initiateWebCall');

    try {
        // P2P Routing - Permission Bypass as requested
        logger.info({ callId }, 'Routing to P2P (calls allowed) - PERMISSION CHECK BYPASSED');
        const result = await ringUser(to, from, callId, callerName);

        if (!result.success) {
            // Send call-failed back to the initiating client (from)
            clientManager.sendToClient(from, {
                type: 'call-failed',
                payload: { reason: result.reason }
            });
            return { success: false, reason: result.reason };
        }
        return { success: true };
    } catch (error) {
        logger.error({ error }, 'Error in initiateWebCall');
        // Send call-failed to the initiating client (from)
        clientManager.sendToClient(from, {
            type: 'call-failed',
            payload: { reason: 'Internal server error' }
        });
        return { success: false, reason: 'Internal server error' };
    }
}

export function setupSocketIOServer(io: SocketIOServer): void {
    io.on('connection', (socket: Socket) => {
        let userId: string | null = null; // Stored for disconnect handling

        logger.info('New Socket.IO connection');

        // Mobile App / Web Client - Register User
        socket.on('register-user', async (data: { userId: string; displayName: string; fcmToken?: string; source?: string }) => {
            userId = data.userId; // Set userId for this socket's session
            const { displayName, fcmToken, source } = data;

            if (source === 'web') {
                // Register as web user
                clientManager.addWebUser(userId, displayName, socket as any);
                logger.info({ userId, displayName }, 'Web client registered');
            } else {
                // Default to mobile user
                clientManager.addMobileUser(userId, displayName, socket as any, fcmToken);
                logger.info({ userId, displayName }, 'Mobile user registered');
            }

            // Confirm registration back to the client using the new sendToClient method
            if (userId) {
                clientManager.sendToClient(userId, { type: 'registered', payload: { userId } });
            }

            // Broadcast to all other users that a new user came online
            // This is a broadcast mechanism, not a direct message to a specific (potentially disconnected) client,
            // so it remains as a direct socket.io broadcast.
            socket.broadcast.emit('user-connected', { id: userId, name: displayName });
        });

        // Handle disconnect: Remove client and mark offline, which also starts buffering timer
        socket.on('disconnect', () => {
            if (userId) {
                logger.info({ userId }, 'Client disconnected via socket.on(disconnect)');
                clientManager.removeClient(userId); // This now marks offline and prepares for buffering
            } else {
                logger.warn('Disconnected socket had no registered userId.');
            }
        });

        // Mobile App - Get All Users (online and offline)
        socket.on('get-online-users', () => {
            const users = clientManager.getAllUsers(); // Returns all users with online status
            if (userId) {
                clientManager.sendToClient(userId, { type: 'online-users', payload: { users } }); // Send to the requesting client
            }
        });

        // Mobile App - Agent Call Ended (with conversation stored)
        // TODO: Re-enable when ConversationService.logConversation is implemented
        /*
        socket.on('agent-call-ended', async (data: { callId: string; recipientId: string; transcript?: string; summary?: string }) => {
            const { callId, recipientId, transcript, summary } = data;

            logger.info({ callId, recipientId, hasTranscript: !!transcript, hasSummary: !!summary }, 'Agent call ended, storing conversation');

            try {
                // Store the conversation
                await ConversationService.logConversation({
                    callId,
                    recipientId,
                    callerId: userId, // Use the stored userId
                    transcript: transcript || '',
                    summary: summary || 'Agent handled call',
                    timestamp: new Date()
                });

                // Create update for the user
                const callerUser = clientManager.getUserFromDirectory(userId!); // Use the stored userId
                await UpdatesService.createUpdate({
                    userId: recipientId,
                    type: 'agent-call',
                    title: 'Agent handled call',
                    message: summary || `Agent spoke with ${callerUser?.displayName || 'someone'} while you were unavailable`,
                    relatedUserId: userId!,
                    relatedUserName: callerUser?.displayName || userId!,
                    metadata: { callId, transcript, summary }
                });

                logger.info({ callId, recipientId }, 'Conversation stored and update created successfully');
            } catch (error) {
                logger.error({ error, callId, recipientId }, 'Failed to store conversation or create update');
            }
        });
        */

        socket.on('call-user', async (data: { to: string; from: string; callId: string; callerName: string }) => {
            const { to, from, callId, callerName } = data;

            logger.info({ from, to, callId }, 'Mobile call initiated');

            try {
                // Check recipient's permissions
                const permissions = await PermissionService.getUserPermissions(to);
                logger.info({ to, permissions }, 'Checked permissions for recipient');

                if (permissions.calls === true) {
                    // Calls allowed → P2P (existing flow)
                    logger.info({ callId }, 'Routing to P2P (calls allowed)');
                    const result = await ringUser(to, from, callId, callerName);

                    if (!result.success) {
                        if (userId) { // Send to the caller (current socket's user)
                            clientManager.sendToClient(userId, {
                                type: 'call-failed',
                                payload: { reason: result.reason }
                            });
                        }
                    }
                } else {
                    // Calls blocked → Route to agent
                    logger.info({ callId }, 'Routing to agent (calls blocked)');

                    // Construct dynamic agent URL for the client
                    const baseHandlerUrl = config.agentServerUrl;
                    const publicUrl = process.env.PUBLIC_URL || `http://${process.env.HOST || '192.168.1.8'}:${config.port}`;
                    const callbackUrl = `${publicUrl}/api/escalate-call`;
                    const dynamicAgentUrl = `${baseHandlerUrl}?empid=${to}&calleremp=${from}&callbackUrl=${encodeURIComponent(callbackUrl)}`;

                    console.log(`[Signaling] Constructed dynamic agent URL: ${dynamicAgentUrl}`);

                    // Notify caller they\'re being routed to agent
                    if (userId) { // Send to the caller (current socket's user)
                        clientManager.sendToClient(userId, {
                            type: 'route-to-agent',
                            payload: {
                                callId,
                                recipientId: to,
                                agentUrl: dynamicAgentUrl,
                            }
                        });
                    }
                }
            } catch (error) {
                logger.error({ error }, 'Error in call-user handler');
                if (userId) { // Send to the caller (current socket's user)
                    clientManager.sendToClient(userId, {
                        type: 'call-failed',
                        payload: { reason: 'Internal server error' }
                    });
                }
            }
        });

        // Mobile App - Initiate Call (Web / Forced P2P)
        socket.on('call-user-web', async (data: { to: string; from: string; callId: string; callerName: string }) => {
            // initiateWebCall already uses clientManager.sendToClient internally for call-failed
            // No change needed here for the caller's socket, as initiateWebCall handles it.
            await initiateWebCall(socket, data);
        });

        // Mobile App - WebRTC Offer
        socket.on('webrtc-offer', async (data: { to: string; from: string; callId: string; offer: any }, ack) => {
            const { to, from, callId, offer } = data;

            logger.info({ from, to, callId }, 'WebRTC offer received from sender');

            const recipient = clientManager.getUserFromDirectory(to);

            if (!recipient) {
                logger.error({ to, from, callId }, 'WebRTC offer FAILED: recipient not found in directory');
                if (userId) { // Send to the caller (from)
                    clientManager.sendToClient(userId, {
                        type: 'call-failed',
                        payload: { callId, reason: 'Recipient not found' }
                    });
                }
                if (ack) ack({ success: false, error: 'Recipient not found' });
                return;
            }

            // Forward offer to recipient using sendToClient
            const sent = clientManager.sendToClient(to, { type: 'webrtc-offer-received', payload: { from, callId, offer } });
            if (sent) {
                logger.info({ to, from, callId }, 'WebRTC offer successfully forwarded to recipient');
                if (ack) ack({ success: true });
            } else {
                logger.error({ to, from, callId }, 'WebRTC offer FAILED: could not forward to recipient');
                

... [TRUNCATED — file is 24424 chars total]