import { CallSession, WebSocketMessage } from '../models/types';
import { clientManager } from '../websocket/clientManager';
import { aiServerClient } from '../services/aiServerClient';
import { urgencyDetector } from './urgencyDetector';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export class CallRoutingService {
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
            // Use clientManager.sendToClient instead of direct socket.send
            if (callSession.callerId) { // Ensure callerId exists before trying to send
                clientManager.sendToClient(callSession.callerId, {
                    type: 'urgency-detected',
                    payload: {
                        callId: callSession.id,
                        urgency: urgencyResult.urgency,
                        routedTo: callSession.routedTo
                    }
                });
            }

            // Clear detection buffer
            urgencyDetector.clearBuffer(callSession.id);
        } catch (error: any) {
            logger.error({ error: error.message, callId: callSession.id }, 'Error routing call');
            // Default to human for safety, but also notify caller of failure
            if (callSession.callerId) {
                clientManager.sendToClient(callSession.callerId, {
                    type: 'call-failed',
                    payload: {
                        callId: callSession.id,
                        reason: 'Failed to route call due to internal error'
                    }
                });
            }
            await this.bridgeToHuman(callSession);
        }
    }

    private async bridgeToHuman(callSession: CallSession): Promise<void> {
        logger.info({ callId: callSession.id }, 'Routing to HUMAN');

        callSession.routedTo = 'HUMAN';
        callSession.status = 'connected';
        clientManager.updateCallSession(callSession.id, callSession);

        // Notify target user of incoming call using sendToClient
        const messageToTarget: WebSocketMessage = {
            type: 'incoming-call',
            payload: {
                callId: callSession.id,
                callerId: callSession.callerId,
                urgency: callSession.urgency
            }
        };
        const sentToTarget = clientManager.sendToClient(callSession.targetUserId, messageToTarget);

        if (sentToTarget) {
            // If sent or buffered, we consider the recipient reachable for the purpose of the call session.
            // The actual recipientSocket in callSession might still be null if they are buffered.
            // The plan doesn't explicitly state to populate `callSession.recipientSocket` with a buffered state.
            // For now, if sendToClient succeeds (sends or buffers), we consider the target reachable.
            // If a `recipientSocket` reference is strictly needed for *active* connections later,
            // `clientManager.getClient(callSession.targetUserId)` should be used to retrieve it.
        } else {
            logger.warn({ userId: callSession.targetUserId, callId: callSession.id }, 'Target user not found or unreachable for incoming-call notification.');

            // Notify caller that user is unavailable
            if (callSession.callerId) {
                clientManager.sendToClient(callSession.callerId, {
                    type: 'call-failed',
                    payload: {
                        callId: callSession.id,
                        reason: 'User unavailable'
                    }
                });
            }
        }
    }

    private async bridgeToBot(callSession: CallSession): Promise<void> {
        logger.info({ callId: callSession.id }, 'Routing to BOT');

        callSession.routedTo = 'BOT';
        callSession.status = 'connected';
        clientManager.updateCallSession(callSession.id, callSession);

        // In production, this would connect to the personal bot service
        // For now, send notification to caller using sendToClient
        if (callSession.callerId) {
            clientManager.sendToClient(callSession.callerId, {
                type: 'connected-to-bot',
                payload: {
                    callId: callSession.id,
                    botName: 'Personal Assistant'
                }
            });
        }

        // TODO: Actually connect to bot WebRTC client
        logger.warn({ callId: callSession.id }, 'Bot connection not yet implemented');
    }
}

export const callRoutingService = new CallRoutingService();
