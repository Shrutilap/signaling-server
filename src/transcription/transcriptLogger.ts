import { CallSession } from '../models/types';
import { aiServerClient } from '../services/aiServerClient';
import { urgencyDetector } from '../routing/urgencyDetector';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export class TranscriptLogger {
    async logTranscript(
        callSession: CallSession,
        speaker: 'caller' | 'recipient' | 'bot',
        text: string
    ): Promise<void> {
        const timestamp = Date.now();

        // Log to AI server
        await aiServerClient.logTranscript(
            callSession.id,
            timestamp,
            speaker,
            text
        );

        // If still in detection phase, add to buffer
        if (callSession.status === 'detecting_urgency') {
            urgencyDetector.addTranscriptChunk(callSession.id, text);
        }

        logger.debug(
            { callId: callSession.id, speaker, textLength: text.length },
            'Transcript logged'
        );
    }

    async startContinuousLogging(callSession: CallSession): Promise<void> {
        logger.info({ callId: callSession.id }, 'Started continuous transcript logging');

        // In production, this would set up STT streaming
        // For now, this is a placeholder
    }
}

export const transcriptLogger = new TranscriptLogger();
