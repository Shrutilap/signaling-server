import { CallSession } from '../models/types';
import { clientManager } from '../websocket/clientManager';
import { aiServerClient } from '../services/aiServerClient';
import { urgencyDetector } from './urgencyDetector';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export class CallRouter {
    async routeCall(callSession: CallSession): Promise<void> {
        logger.info({ callId: callSession.id }, 'Routing call');

        try {
            // Get initial transcript from buffer
            const initialTranscript = urgencyDetector.getInitialTranscript(callSession.id);

            // Classify urgency
            const urgencyResult = await aiServerClient.classifyUrgency(
                initialTranscript,
                callSession.callerId,
                callSession.targetUserId
            );

            // Update session
            callSession.urgency = urgencyResult.urgency;
            callSession.initialTranscript = initialTranscript;

            logger.info(
                { callId: callSession.id, urgency: urgencyResult.urgency },
                'Urgency detected'
            );

            // Route based on urgency
            if (urgencyResult.urgency === 'HIGH') {
                await this.bridgeToHuman(callSession);
            } else {
                await this.bridgeToBot(callSession);
            }

            // Notify caller of routing
            if (callSession.callerSocket) {
                callSession.callerSocket.send(JSON.stringify({
                    type: 'urgency-detected',
                    payload: {
                        callId: callSession.id,
                        urgency: urgencyResult.urgency,
                        routedTo: callSession.routedTo
                    }
                }));
            }

            // Clear detection buffer
            urgencyDetector.clearBuffer(callSession.id);
        } catch (error: any) {
            logger.error({ error: error.message, callId: callSession.id }, 'Error routing call');
            // Default to human for safety
            await this.bridgeToHuman(callSession);
        }
    }

    private async bridgeToHuman(callSession: CallSession): Promise<void> {
        logger.info({ callId: callSession.id }, 'Routing to HUMAN');

        callSession.routedTo = 'HUMAN';
        callSession.status = 'connected';
        clientManager.updateCallSession(callSession.id, callSession);

        // Find target user's socket
        const targetSocket = clientManager.getClient(callSession.targetUserId);

        if (targetSocket) {
            // Notify target user of incoming call
            targetSocket.send(JSON.stringify({
                type: 'incoming-call',
                payload: {
                    callId: callSession.id,
                    callerId: callSession.callerId,
                    urgency: callSession.urgency
                }
            }));

            callSession.recipientSocket = targetSocket;
        } else {
            logger.warn({ userId: callSession.targetUserId }, 'Target user not connected');

            // Notify caller that user is unavailable
            if (callSession.callerSocket) {
                callSession.callerSocket.send(JSON.stringify({
                    type: 'call-failed',
                    payload: {
                        callId: callSession.id,
                        reason: 'User unavailable'
                    }
                }));
            }
        }
    }

    private async bridgeToBot(callSession: CallSession): Promise<void> {
        logger.info({ callId: callSession.id }, 'Routing to BOT');

        callSession.routedTo = 'BOT';
        callSession.status = 'connected';
        clientManager.updateCallSession(callSession.id, callSession);

        // In production, this would connect to the personal bot service
        // For now, send notification
        if (callSession.callerSocket) {
            callSession.callerSocket.send(JSON.stringify({
                type: 'connected-to-bot',
                payload: {
                    callId: callSession.id,
                    botName: 'Personal Assistant'
                }
            }));
        }

        // TODO: Actually connect to bot WebRTC client
        logger.warn({ callId: callSession.id }, 'Bot connection not yet implemented');
    }
}

export const callRouter = new CallRouter();
