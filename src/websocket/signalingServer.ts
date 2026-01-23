import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { clientManager } from './clientManager';
import { callRouter } from '../routing/callRouter';
import { urgencyDetector } from '../routing/urgencyDetector';
import { transcriptLogger } from '../transcription/transcriptLogger';
import { CallSession, WebSocketMessage } from '../models/types';
import pino from 'pino';
import { config } from '../config';
import { sendPushNotification } from '../services/firebaseService';
import PermissionService from '../services/PermissionService';
import AgentProxyService from '../services/AgentProxyService';

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

    // Send socket event if user is online
    if (recipient.socket) {
        recipient.socket.emit('incoming-call', { from: callerId, callId, callerName });
        logger.info({ recipientId, status: 'online' }, 'Sent socket notification');
    }

    // Always send FCM push notification (works for both online and offline)
    if (recipient.fcmToken) {
        try {
            await sendPushNotification(recipient.fcmToken, callerId, callerName, callId);
            logger.info({ recipientId, status: recipient.isOnline ? 'online' : 'offline' }, 'Sent push notification');
        } catch (error) {
            logger.error({ error }, 'Failed to send FCM notification');
        }
    } else if (!recipient.socket) {
        // User is offline and has no FCM token - can't reach them
        logger.warn({ recipientId }, 'User is offline and has no FCM token');
        return { success: false, reason: 'User is offline and unreachable' };
    }

    return { success: true };
}

export function setupSocketIOServer(io: SocketIOServer): void {
    io.on('connection', (socket: Socket) => {
        let userId: string | null = null;

        logger.info('New Socket.IO connection');

        // Mobile App - Register User
        socket.on('register-user', async (data: { userId: string; displayName: string; fcmToken?: string }) => {
            userId = data.userId;
            const { displayName, fcmToken } = data;

            // Store socket for this user
            clientManager.addMobileUser(userId, displayName, socket as any, fcmToken);

            logger.info({ userId, displayName }, 'Mobile user registered');

            socket.emit('registered', { userId });

            // Broadcast to all other users that a new user came online
            socket.broadcast.emit('user-connected', { id: userId, name: displayName });
        });

        // Mobile App - Get All Users (online and offline)
        socket.on('get-online-users', () => {
            const users = clientManager.getAllUsers(); // Returns all users with online status
            socket.emit('online-users', { users });
        });

        // Mobile App - Initiate Call (with permission check)
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
                        socket.emit('call-failed', { reason: result.reason });
                    }
                } else {
                    // Calls blocked → Route to agent
                    logger.info({ callId }, 'Routing to agent (calls blocked)');

                    // Notify caller they're being routed to agent
                    socket.emit('route-to-agent', {
                        callId,
                        recipientId: to,
                        agentUrl: config.agentServerUrl,
                    });

                    // Create proxy to agent server
                    await AgentProxyService.createProxy(socket, { from, to, callId, callerName });
                }
            } catch (error) {
                logger.error({ error }, 'Error in call-user handler');
                socket.emit('call-failed', { reason: 'Internal server error' });
            }
        });

        // Mobile App - WebRTC Offer
        socket.on('webrtc-offer', async (data: { to: string; from: string; callId: string; offer: any }, ack) => {
            const { to, from, callId, offer } = data;

            logger.info({ from, to, callId }, 'WebRTC offer received from sender');

            // Use getUserFromDirectory for more reliable lookup (works even if socket map is stale)
            const recipient = clientManager.getUserFromDirectory(to);

            if (!recipient) {
                logger.error({ to, from, callId }, 'WebRTC offer FAILED: recipient not found in directory');
                socket.emit('call-failed', { callId, reason: 'Recipient not found' });
                if (ack) ack({ success: false, error: 'Recipient not found' });
                return;
            }

            if (!recipient.socket) {
                logger.error({ to, from, callId, isOnline: recipient.isOnline }, 'WebRTC offer FAILED: recipient socket not available');
                socket.emit('call-failed', { callId, reason: 'Recipient offline or disconnected' });
                if (ack) ack({ success: false, error: 'Recipient offline' });
                return;
            }

            // Forward offer to recipient
            recipient.socket.emit('webrtc-offer-received', { from, callId, offer });
            logger.info({ to, from, callId }, 'WebRTC offer successfully forwarded to recipient');
            if (ack) ack({ success: true });
        });

        // Mobile App - WebRTC Answer
        socket.on('webrtc-answer', async (data: { to: string; from: string; callId: string; answer: any }, ack) => {
            const { to, from, callId, answer } = data;

            logger.info({ from, to, callId }, 'WebRTC answer received from sender');

            const recipient = clientManager.getUserFromDirectory(to);

            if (!recipient) {
                logger.error({ to, from, callId }, 'WebRTC answer FAILED: recipient not found');
                socket.emit('call-failed', { callId, reason: 'Recipient not found' });
                if (ack) ack({ success: false, error: 'Recipient not found' });
                return;
            }

            if (!recipient.socket) {
                logger.error({ to, from, callId }, 'WebRTC answer FAILED: recipient offline');
                socket.emit('call-failed', { callId, reason: 'Recipient offline' });
                if (ack) ack({ success: false, error: 'Recipient offline' });
                return;
            }

            recipient.socket.emit('webrtc-answer-received', { from, callId, answer });
            logger.info({ to, from, callId }, 'WebRTC answer successfully forwarded');
            if (ack) ack({ success: true });
        });

        // Mobile App - Call Accepted (receiver is ready for offer)
        socket.on('call-accepted', async (data: { to: string; from: string; callId: string }) => {
            const { to, from, callId } = data;

            logger.info({ from, to, callId }, 'Call accepted');

            const recipient = clientManager.getMobileUser(to);
            if (recipient?.socket) {
                recipient.socket.emit('call-accepted', { from, callId });
            }
        });

        // Mobile App - ICE Candidate
        socket.on('webrtc-ice-candidate', async (data: { to: string; from: string; callId: string; candidate: any }, ack) => {
            const { to, from, callId, candidate } = data;

            logger.info({ from, to, callId, candidateType: candidate?.type }, 'ICE candidate received from sender');

            const recipient = clientManager.getUserFromDirectory(to);

            if (!recipient) {
                logger.error({ to, from, callId }, 'ICE candidate FAILED: recipient not found - WILL CAUSE ONE-WAY AUDIO');
                if (ack) ack({ success: false, error: 'Recipient not found' });
                return;
            }

            if (!recipient.socket) {
                logger.error({ to, from, callId }, 'ICE candidate FAILED: recipient offline - WILL CAUSE ONE-WAY AUDIO');
                if (ack) ack({ success: false, error: 'Recipient offline' });
                return;
            }

            recipient.socket.emit('webrtc-ice-candidate-received', { from, callId, candidate });
            logger.info({ to, from, callId, candidateType: candidate?.type }, 'ICE candidate successfully forwarded');
            if (ack) ack({ success: true });
        });

        // Mobile App - Reject Call
        socket.on('reject-call', async (data: { to: string; from: string; callId: string }) => {
            const { to, from, callId } = data;

            logger.info({ from, to, callId }, 'Mobile call rejected');

            const recipient = clientManager.getMobileUser(to);
            if (recipient?.socket) {
                recipient.socket.emit('call-rejected', { from, callId });
            }
        });

        // Mobile App - End Call
        socket.on('end-call', async (data: { to: string; from: string; callId: string }) => {
            const { to, from, callId } = data;

            logger.info({ from, to, callId }, 'Mobile call ended');

            const recipient = clientManager.getMobileUser(to);
            if (recipient?.socket) {
                recipient.socket.emit('call-ended', { from, callId });
            }
        });

        // Mobile App - Send Message
        socket.on('send-message', async (data: { to: string; from: string; message: string; messageId: string; senderName: string }, ack) => {
            const { to, from, message, messageId, senderName } = data;

            logger.info({ from, to, messageId }, 'Message received from sender');

            const recipient = clientManager.getUserFromDirectory(to);

            if (!recipient) {
                logger.error({ to, from, messageId }, 'Message FAILED: recipient not found');
                if (ack) ack({ success: false, error: 'Recipient not found' });
                return;
            }

            if (recipient.socket) {
                // Recipient is online - deliver via WebSocket
                recipient.socket.emit('receive-message', {
                    from,
                    senderName,
                    message,
                    messageId,
                    timestamp: Date.now(),
                });
                logger.info({ to, status: 'online', messageId }, 'Message delivered via socket');
                if (ack) ack({ success: true, delivered: 'socket' });
            } else {
                // User is offline, send push notification
                if (recipient.fcmToken) {
                    try {
                        const { sendMessageNotification } = require('../services/firebaseService');
                        await sendMessageNotification(
                            recipient.fcmToken,
                            from,
                            senderName,
                            message,
                            messageId
                        );
                        logger.info({ to, status: 'offline', messageId }, 'Message notification sent via FCM');
                        if (ack) ack({ success: true, delivered: 'fcm' });
                    } catch (error) {
                        logger.error({ error, messageId }, 'Failed to send message notification');
                        if (ack) ack({ success: false, error: 'FCM delivery failed' });
                    }
                } else {
                    logger.error({ to, status: 'offline', messageId }, 'Message FAILED: recipient offline, no FCM token');
                    if (ack) ack({ success: false, error: 'Recipient offline and unreachable' });
                }
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            if (userId) {
                clientManager.removeMobileUser(userId);
                logger.info({ userId }, 'Socket.IO connection closed');

                // Broadcast to all users that this user went offline
                socket.broadcast.emit('user-disconnected', { userId });
                // Also emit user-offline for backward compatibility
                socket.broadcast.emit('user-offline', { userId });
            }
        });
    });
}
