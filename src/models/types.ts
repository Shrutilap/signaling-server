export interface CallSession {
    id: string;
    callerId: string;
    targetUserId: string;
    urgency?: 'HIGH' | 'LOW';
    routedTo?: 'HUMAN' | 'BOT';
    status: 'initiating' | 'detecting_urgency' | 'routing' | 'connected' | 'ended';
    startedAt: number;
    endedAt?: number;
    callerSocket?: any;
    recipientSocket?: any;
    initialTranscript?: string;
}

export interface WebSocketMessage {
    type: string;
    payload: any;
}

export interface CallInitiatePayload {
    callerId: string;
    targetUserId: string;
    timestamp: number;
}

export interface SDPOfferPayload {
    callId: string;
    sdp: string;
}

export interface ICECandidatePayload {
    callId: string;
    candidate: any;
}

export interface UrgencyResponse {
    urgency: 'HIGH' | 'LOW';
    confidence: number;
    reasoning: string;
}
